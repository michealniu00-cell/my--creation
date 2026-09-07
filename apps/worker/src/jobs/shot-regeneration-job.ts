import { Buffer } from 'node:buffer';
import {
  materializeMediaOutput,
  readGeneratedAsset,
} from '@video-agent-studio/artifact-service';
import {
  artifactRepository,
  eventRepository,
  lockRepository,
  projectRepository,
  settingsRepository,
  shotRepository,
  type ArtifactActivationExpectation,
  type ArtifactVersionCreateInput,
} from '@video-agent-studio/db';
import {
  createImageProvider,
  createVideoProvider,
  evaluateBindingHealth,
} from '@video-agent-studio/providers';
import {
  buildStoryboardImagePrompt,
  keyElementRegenerationJobSchema,
  shotStoryboardRegenerationJobSchema,
  shotVideoRegenerationJobSchema,
  type ArtifactVersionRecord,
} from '@video-agent-studio/shared';
import { DurableJobError, type DurableJobContext } from './job-runner';
import { remoteVideoTaskControl } from './remote-video-task';
import { remoteVideoTaskScope } from '../workflows/execution-control';

type ReferenceAsset = {
  storagePath: string;
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function activationExpectation(
  version: ArtifactVersionRecord,
): ArtifactActivationExpectation {
  const generationInput = version.generationInput;
  const expectedGroupUpdatedAt = generationInput.expectedGroupUpdatedAt;
  if (typeof expectedGroupUpdatedAt !== 'string' || !expectedGroupUpdatedAt) {
    throw new DurableJobError(
      'ARTIFACT_EXPECTATION_MISSING',
      'Prepared artifact version is missing its group revision expectation',
      { retryable: false },
    );
  }
  const expectedActiveVersionId = generationInput.expectedActiveVersionId;
  if (
    expectedActiveVersionId !== null &&
    typeof expectedActiveVersionId !== 'string'
  ) {
    throw new DurableJobError(
      'ARTIFACT_EXPECTATION_INVALID',
      'Prepared artifact version contains an invalid active-version expectation',
      { retryable: false },
    );
  }
  return {
    expectedActiveVersionId,
    expectedGroupUpdatedAt,
  };
}

async function loadReferenceAsset(referenceAsset?: ReferenceAsset | null) {
  if (!referenceAsset) {
    return null;
  }
  const persisted = await readGeneratedAsset(referenceAsset.storagePath);
  return {
    bytesBase64: Buffer.from(persisted.bytes).toString('base64'),
    mimeType: referenceAsset.mimeType || persisted.mimeType,
    fileName: referenceAsset.fileName,
  };
}

async function rejectLockedShot(
  context: DurableJobContext,
  shotId: string,
  activeVersionId?: string | null,
) {
  const shotLocked = await lockRepository.isLocked('shot', shotId);
  const versionLocked = activeVersionId
    ? await lockRepository.isLocked('artifact_version', activeVersionId)
    : false;
  if (!shotLocked && !versionLocked) {
    return;
  }
  await eventRepository.create({
    projectId: context.job.projectId,
    runId: null,
    taskId: null,
    jobId: context.job.id,
    eventType: 'job_artifact_lock_conflict',
    eventLevel: 'warn',
    userVisible: true,
    summary: '后台生成开始前检测到 Shot 或当前版本已锁定，任务未修改任何版本',
    eventPayload: {
      jobId: context.job.id,
      shotId,
      activeVersionId: activeVersionId ?? null,
      shotLocked,
      versionLocked,
    },
  });
  throw new DurableJobError(
    'ARTIFACT_LOCKED',
    'Shot or active artifact version is locked',
    {
      retryable: false,
    },
  );
}

async function publishGeneratedVersion(input: {
  context: DurableJobContext;
  projectId: string;
  shotId: string;
  groupId: string;
  version: ArtifactVersionRecord;
}) {
  input.context.throwIfAborted();
  const activation = await artifactRepository.activateVersionIfExpected(
    input.groupId,
    input.version.id,
    activationExpectation(input.version),
  );
  if (!activation.ok) {
    await eventRepository.create({
      projectId: input.projectId,
      runId: null,
      taskId: null,
      jobId: input.context.job.id,
      eventType: 'job_artifact_publish_conflict',
      eventLevel: 'warn',
      userVisible: true,
      summary:
        '新版本已保留，但当前生效版本或锁状态已变化，需要用户决定是否切换',
      eventPayload: {
        jobId: input.context.job.id,
        shotId: input.shotId,
        artifactGroupId: input.groupId,
        artifactVersionId: input.version.id,
        conflictReason: activation.reason,
        actualActiveVersionId: activation.actualActiveVersionId,
      },
    });
    throw new DurableJobError(
      'ARTIFACT_PUBLISH_CONFLICT',
      `Generated version was preserved but not activated: ${activation.reason}`,
      { retryable: false },
    );
  }

  const result = {
    action: input.context.job.payload.action,
    shotId: input.shotId,
    artifactGroupId: input.groupId,
    artifactVersionId: input.version.id,
    versionNo: input.version.versionNo,
    activated: true,
  };
  await input.context.saveCheckpoint({
    ...input.context.checkpoint,
    phase: 'local_artifact_completed',
    result,
    completedAt: new Date().toISOString(),
  });
  await eventRepository.create({
    projectId: input.projectId,
    runId: null,
    taskId: null,
    jobId: input.context.job.id,
    eventType: 'artifact_regenerated',
    eventLevel: 'info',
    userVisible: true,
    summary: `Shot 局部${input.context.job.jobType === 'storyboard' ? '分镜' : '视频'}已生成新版本`,
    eventPayload: { jobId: input.context.job.id, ...result },
  });
  return result;
}

function completedLocalResult(context: DurableJobContext) {
  if (context.checkpoint.phase !== 'local_artifact_completed') {
    return null;
  }
  return record(context.checkpoint.result);
}

async function preparedVersionForJob(
  context: DurableJobContext,
  groupId: string,
  createInput: (
    expectation: ArtifactActivationExpectation,
  ) => ArtifactVersionCreateInput,
) {
  const versionsState = await artifactRepository.getVersions(groupId);
  const existing = versionsState.versions.find(
    (version) => version.generationInput.jobId === context.job.id,
  );
  if (existing) {
    return existing;
  }
  if (!versionsState.group) {
    throw new DurableJobError(
      'ARTIFACT_GROUP_NOT_FOUND',
      'Artifact group not found',
      {
        retryable: false,
      },
    );
  }
  const created = await artifactRepository.createNextVersion(
    createInput({
      expectedActiveVersionId: versionsState.group.activeVersionId ?? null,
      expectedGroupUpdatedAt: versionsState.group.updatedAt,
    }),
  );
  if (!created) {
    throw new DurableJobError(
      'ARTIFACT_GROUP_NOT_FOUND',
      'Artifact group disappeared',
      {
        retryable: false,
      },
    );
  }
  return created;
}

async function markGenerationFailed(
  context: DurableJobContext,
  version: ArtifactVersionRecord,
  metadata: Record<string, unknown>,
  error: unknown,
) {
  if (context.signal.aborted) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  await artifactRepository.updateVersion(version.id, {
    status: 'failed',
    metadata: { ...metadata, error: message },
    versionNote: '后台生成失败，可安全重试；此前生效版本保持不变',
  });
}

export async function runShotStoryboardRegenerationJob(
  context: DurableJobContext,
) {
  const completed = completedLocalResult(context);
  if (completed) {
    return completed;
  }
  const parsed = shotStoryboardRegenerationJobSchema.safeParse(
    context.job.payload,
  );
  if (!parsed.success) {
    throw new DurableJobError(
      'WORKFLOW_INPUT_INVALID',
      `Persisted storyboard regeneration payload is invalid: ${JSON.stringify(parsed.error.issues)}`,
      { retryable: false },
    );
  }

  const shot = await shotRepository.get(parsed.data.shotId);
  const storyboard = await artifactRepository.getShotStoryboard(
    parsed.data.shotId,
  );
  if (
    !shot ||
    !storyboard?.group ||
    storyboard.group.projectId !== context.job.projectId
  ) {
    throw new DurableJobError(
      'SHOT_ARTIFACT_NOT_FOUND',
      'Storyboard group or project-owned Shot was not found',
      { retryable: false },
    );
  }
  const group = storyboard.group;
  await rejectLockedShot(context, shot.id, group.activeVersionId);
  await settingsRepository.ensureDefaults(context.job.projectId);
  const binding = await settingsRepository.getActiveModelBinding(
    context.job.projectId,
    'agent8',
  );
  const health = evaluateBindingHealth('agent8', binding);
  if (health.state !== 'ready' && health.state !== 'mock') {
    throw new DurableJobError('PROVIDER_CONFIG_ERROR', health.summary, {
      retryable: false,
    });
  }
  const project = await projectRepository.get(context.job.projectId);
  const prompt = buildStoryboardImagePrompt(
    project?.title ?? group.name ?? 'Storyboard',
    shot,
    {
      promptHint: parsed.data.promptHint,
      hasReferenceImage: Boolean(parsed.data.referenceAsset),
    },
  );
  const baseMetadata = {
    provider: binding?.provider ?? 'mock',
    model: binding?.modelName ?? 'mock',
    uploaded: Boolean(parsed.data.referenceAsset),
    queueStatus: 'queued',
  };
  const version = await preparedVersionForJob(
    context,
    group.id,
    (expectation) => ({
      groupId: group.id,
      generatedByAgent: 'agent8',
      sourceTaskId: null,
      mimeType: 'image/png',
      storageBucket: null,
      storagePath: null,
      publicUrl: null,
      fileSizeBytes: null,
      width: 1280,
      height: 720,
      durationMs: null,
      generationInput: {
        jobId: context.job.id,
        promptHint: parsed.data.promptHint,
        prompt,
        referenceUploadName: parsed.data.referenceAsset?.fileName ?? null,
        ...expectation,
        queuedAt: new Date().toISOString(),
      },
      metadata: baseMetadata,
      status: 'pending',
      versionNote: parsed.data.promptHint || 'Shot 分镜后台重生成排队中',
      isPlaceholder: false,
    }),
  );

  await context.saveCheckpoint({
    ...context.checkpoint,
    phase: 'artifact_version_prepared',
    artifactGroupId: group.id,
    artifactVersionId: version.id,
  });
  if (version.status !== 'generated') {
    try {
      await artifactRepository.updateVersion(version.id, {
        status: 'pending',
        metadata: baseMetadata,
      });
      const referenceImage = await loadReferenceAsset(
        parsed.data.referenceAsset,
      );
      context.throwIfAborted();
      const generated = await createImageProvider(binding).generate({
        prompt,
        width: 1280,
        height: 720,
        referenceImage,
        signal: context.signal,
        idempotencyKey: context.job.id,
      });
      context.throwIfAborted();
      const stored = await materializeMediaOutput({
        output: generated,
        prefix: `storyboard-${shot.id}${referenceImage ? '-reference' : ''}`,
        fallbackMimeType: 'image/png',
        fallbackExtension: 'png',
      });
      context.throwIfAborted();
      const updated = await artifactRepository.updateVersion(version.id, {
        mimeType: generated.mimeType ?? 'image/png',
        storageBucket: stored.storageBucket,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        fileSizeBytes:
          stored.fileSizeBytes ??
          parsed.data.referenceAsset?.fileSizeBytes ??
          null,
        metadata: {
          ...baseMetadata,
          queueStatus: 'generated',
          ...(generated.metadata ?? {}),
        },
        status: 'generated',
        versionNote:
          parsed.data.promptHint || '按当前 Shot 描述生成的新分镜版本',
      });
      if (!updated) {
        throw new DurableJobError(
          'ARTIFACT_LOCKED',
          'Shot or target storyboard version was locked while generation was running',
          { retryable: false },
        );
      }
      Object.assign(version, updated);
    } catch (error) {
      await markGenerationFailed(context, version, baseMetadata, error);
      throw error;
    }
  }
  return publishGeneratedVersion({
    context,
    projectId: context.job.projectId,
    shotId: shot.id,
    groupId: group.id,
    version,
  });
}

export async function runShotVideoRegenerationJob(context: DurableJobContext) {
  const completed = completedLocalResult(context);
  if (completed) {
    return completed;
  }
  const parsed = shotVideoRegenerationJobSchema.safeParse(context.job.payload);
  if (!parsed.success) {
    throw new DurableJobError(
      'WORKFLOW_INPUT_INVALID',
      `Persisted video regeneration payload is invalid: ${JSON.stringify(parsed.error.issues)}`,
      { retryable: false },
    );
  }

  const video = await artifactRepository.getShotVideo(parsed.data.shotId);
  if (!video?.group || video.group.projectId !== context.job.projectId) {
    throw new DurableJobError(
      'SHOT_ARTIFACT_NOT_FOUND',
      'Video group or project-owned Shot was not found',
      { retryable: false },
    );
  }
  const group = video.group;
  await rejectLockedShot(context, parsed.data.shotId, group.activeVersionId);
  await settingsRepository.ensureDefaults(context.job.projectId);
  const binding = await settingsRepository.getActiveModelBinding(
    context.job.projectId,
    'agent9',
  );
  const health = evaluateBindingHealth('agent9', binding);
  if (health.state !== 'ready' && health.state !== 'mock') {
    throw new DurableJobError('PROVIDER_CONFIG_ERROR', health.summary, {
      retryable: false,
    });
  }
  const project = await projectRepository.get(context.job.projectId);
  const prompt = `${project?.title ?? group.name ?? 'Video'} ${parsed.data.promptHint ?? 'regenerate current shot'}`;
  const baseMetadata = {
    provider: binding?.provider ?? 'mock',
    model: binding?.modelName ?? 'mock',
    uploaded: Boolean(parsed.data.referenceAsset),
    queueStatus: 'queued',
  };
  const version = await preparedVersionForJob(
    context,
    group.id,
    (expectation) => ({
      groupId: group.id,
      generatedByAgent: 'agent9',
      sourceTaskId: null,
      mimeType: 'video/mp4',
      storageBucket: null,
      storagePath: null,
      publicUrl: null,
      fileSizeBytes: null,
      width: 1280,
      height: 720,
      durationMs: 4000,
      generationInput: {
        jobId: context.job.id,
        promptHint: parsed.data.promptHint,
        referenceAssetType: parsed.data.referenceAssetType ?? null,
        referenceUploadName: parsed.data.referenceAsset?.fileName ?? null,
        ...expectation,
        queuedAt: new Date().toISOString(),
      },
      metadata: baseMetadata,
      status: 'pending',
      versionNote: parsed.data.promptHint || 'Shot 视频后台重生成排队中',
      isPlaceholder: false,
    }),
  );

  await context.saveCheckpoint({
    ...context.checkpoint,
    phase: 'artifact_version_prepared',
    artifactGroupId: group.id,
    artifactVersionId: version.id,
  });
  if (version.status !== 'generated') {
    try {
      await artifactRepository.updateVersion(version.id, {
        status: 'pending',
        metadata: baseMetadata,
      });
      const referenceAsset = await loadReferenceAsset(
        parsed.data.referenceAsset,
      );
      context.throwIfAborted();
      const generated = await createVideoProvider(binding).generate({
        ...remoteVideoTaskControl(
          context,
          remoteVideoTaskScope(parsed.data.shotId, {
            provider: binding?.provider,
            model: binding?.modelName,
            baseUrl: binding?.baseUrl,
            prompt,
            durationMs: 4000,
            reference: parsed.data.referenceAsset?.storagePath ?? null,
          }),
        ),
        prompt,
        durationMs: 4000,
        referenceAsset,
        signal: context.signal,
        idempotencyKey: context.job.id,
      });
      context.throwIfAborted();
      const stored = await materializeMediaOutput({
        output: generated,
        prefix: `video-${parsed.data.shotId}${referenceAsset ? '-reference' : ''}`,
        fallbackMimeType: 'video/mp4',
        fallbackExtension: 'mp4',
      });
      context.throwIfAborted();
      const updated = await artifactRepository.updateVersion(version.id, {
        mimeType: generated.mimeType ?? 'video/mp4',
        storageBucket: stored.storageBucket,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        fileSizeBytes:
          stored.fileSizeBytes ??
          parsed.data.referenceAsset?.fileSizeBytes ??
          null,
        metadata: {
          ...baseMetadata,
          queueStatus: 'generated',
          remoteTaskId: generated.remoteId ?? null,
          ...(generated.metadata ?? {}),
        },
        status: 'generated',
        versionNote:
          parsed.data.promptHint || '按当前 Shot 描述生成的新视频版本',
      });
      if (!updated) {
        throw new DurableJobError(
          'ARTIFACT_LOCKED',
          'Shot or target video version was locked while generation was running',
          { retryable: false },
        );
      }
      Object.assign(version, updated);
    } catch (error) {
      await markGenerationFailed(context, version, baseMetadata, error);
      throw error;
    }
  }
  return publishGeneratedVersion({
    context,
    projectId: context.job.projectId,
    shotId: parsed.data.shotId,
    groupId: group.id,
    version,
  });
}

export async function runKeyElementRegenerationJob(context: DurableJobContext) {
  const completed = completedLocalResult(context);
  if (completed) {
    return completed;
  }
  const parsed = keyElementRegenerationJobSchema.safeParse(context.job.payload);
  if (!parsed.success) {
    throw new DurableJobError(
      'WORKFLOW_INPUT_INVALID',
      `Persisted key-element regeneration payload is invalid: ${JSON.stringify(parsed.error.issues)}`,
      { retryable: false },
    );
  }
  const versionsState = await artifactRepository.getVersions(
    parsed.data.artifactGroupId,
  );
  const group = versionsState.group;
  if (!group || group.projectId !== context.job.projectId) {
    throw new DurableJobError(
      'ARTIFACT_GROUP_NOT_FOUND',
      'Project-owned key element group not found',
      {
        retryable: false,
      },
    );
  }
  if (
    group.activeVersionId &&
    (await lockRepository.isLocked('artifact_version', group.activeVersionId))
  ) {
    throw new DurableJobError(
      'ARTIFACT_LOCKED',
      'Active key element version is locked',
      {
        retryable: false,
      },
    );
  }
  await settingsRepository.ensureDefaults(group.projectId);
  const binding = await settingsRepository.getActiveModelBinding(
    group.projectId,
    'agent8',
  );
  const health = evaluateBindingHealth('agent8', binding);
  if (health.state !== 'ready' && health.state !== 'mock') {
    throw new DurableJobError('PROVIDER_CONFIG_ERROR', health.summary, {
      retryable: false,
    });
  }
  const prompt = `${group.name ?? 'Key element'} ${parsed.data.promptHint ?? 'regenerated'}`;
  const metadata = {
    provider: binding?.provider ?? 'mock',
    model: binding?.modelName ?? 'mock',
    queueStatus: 'queued',
  };
  const version = await preparedVersionForJob(
    context,
    group.id,
    (expectation) => ({
      groupId: group.id,
      generatedByAgent: 'agent8',
      sourceTaskId: null,
      mimeType: 'image/png',
      storageBucket: null,
      storagePath: null,
      publicUrl: null,
      fileSizeBytes: null,
      width: 1024,
      height: 1024,
      durationMs: null,
      generationInput: {
        jobId: context.job.id,
        promptHint: parsed.data.promptHint ?? null,
        basedOnVersionId: parsed.data.basedOnVersionId ?? null,
        ...expectation,
        queuedAt: new Date().toISOString(),
      },
      metadata,
      status: 'pending',
      versionNote: parsed.data.promptHint ?? '关键要素图后台重生成排队中',
      isPlaceholder: false,
    }),
  );
  await context.saveCheckpoint({
    ...context.checkpoint,
    phase: 'artifact_version_prepared',
    artifactGroupId: group.id,
    artifactVersionId: version.id,
  });
  if (version.status !== 'generated') {
    try {
      const generated = await createImageProvider(binding).generate({
        prompt,
        width: 1024,
        height: 1024,
        signal: context.signal,
        idempotencyKey: context.job.id,
      });
      context.throwIfAborted();
      const stored = await materializeMediaOutput({
        output: generated,
        prefix: `key-element-${group.id}`,
        fallbackMimeType: 'image/png',
        fallbackExtension: 'png',
      });
      context.throwIfAborted();
      const updated = await artifactRepository.updateVersion(version.id, {
        mimeType: generated.mimeType ?? 'image/png',
        storageBucket: stored.storageBucket,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        fileSizeBytes: stored.fileSizeBytes,
        metadata: {
          ...metadata,
          queueStatus: 'generated',
          ...(generated.metadata ?? {}),
        },
        status: 'generated',
        versionNote: parsed.data.promptHint ?? '关键要素图重生成版本',
      });
      if (!updated) {
        throw new DurableJobError(
          'ARTIFACT_LOCKED',
          'Key element version was locked while generation was running',
          { retryable: false },
        );
      }
      Object.assign(version, updated);
    } catch (error) {
      await markGenerationFailed(context, version, metadata, error);
      throw error;
    }
  }

  context.throwIfAborted();
  const activation = await artifactRepository.activateVersionIfExpected(
    group.id,
    version.id,
    activationExpectation(version),
  );
  if (!activation.ok) {
    await eventRepository.create({
      projectId: group.projectId,
      runId: null,
      taskId: null,
      jobId: context.job.id,
      eventType: 'job_artifact_publish_conflict',
      eventLevel: 'warn',
      userVisible: true,
      summary: '关键要素新版本已保留，但生效版本或锁状态已变化，需要用户决定',
      eventPayload: {
        jobId: context.job.id,
        artifactGroupId: group.id,
        artifactVersionId: version.id,
        conflictReason: activation.reason,
      },
    });
    throw new DurableJobError(
      'ARTIFACT_PUBLISH_CONFLICT',
      `Generated key element was preserved but not activated: ${activation.reason}`,
      { retryable: false },
    );
  }
  const result = {
    action: parsed.data.action,
    artifactGroupId: group.id,
    artifactVersionId: version.id,
    versionNo: version.versionNo,
    activated: true,
  };
  await context.saveCheckpoint({
    ...context.checkpoint,
    phase: 'local_artifact_completed',
    result,
    completedAt: new Date().toISOString(),
  });
  return result;
}
