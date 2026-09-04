import { Buffer } from 'node:buffer';
import { persistGeneratedAsset } from '@video-agent-studio/artifact-service';
import { evaluateBindingHealth } from '@video-agent-studio/providers';
import {
  artifactRepository,
  ensureDb,
  jobRepository,
  projectRepository,
  settingsRepository,
  shotRepository,
} from '@video-agent-studio/db';
import {
  buildStoryboardImagePrompt,
  shotUploadRegenerationFieldsSchema,
} from '@video-agent-studio/shared';
import { enqueueShotRegeneration } from '../../../../../../lib/enqueue-shot-regeneration';
import { jsonFail, jsonOk } from '../../../../../../lib/http';
import {
  hasExpectedMediaSignature,
  readSingleFileMultipart,
} from '../../../../../../lib/media-upload';
import { jsonProviderError } from '../../../../../../lib/provider-errors';
import {
  ensureActiveArtifactVersionUnlocked,
  ensureShotUnlocked,
} from '../../../../../../lib/route-guards';
import { resolveWorkflowIdempotencyKey } from '../../../../../../lib/workflow-job-command';

const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const maxUploadBytes = 10 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shotId: string }> },
) {
  await ensureDb();
  const { shotId } = await params;
  const shotConflict = await ensureShotUnlocked(
    shotId,
    'Locked shot cannot regenerate storyboard',
  );
  if (shotConflict) {
    return shotConflict;
  }

  const storyboard = await artifactRepository.getShotStoryboard(shotId);
  if (!storyboard?.group) {
    return jsonFail('NOT_FOUND', 'Storyboard group not found', 404);
  }
  const storyboardGroup = storyboard.group;
  const artifactConflict = await ensureActiveArtifactVersionUnlocked(
    storyboardGroup.id,
    'Locked storyboard version cannot be replaced',
  );
  if (artifactConflict) {
    return artifactConflict;
  }

  const multipart = await readSingleFileMultipart(request);
  if (!multipart.success) {
    return multipart.response;
  }
  const { file } = multipart;
  const fields = shotUploadRegenerationFieldsSchema.safeParse(multipart.fields);
  if (!fields.success) {
    return jsonFail('VALIDATION_ERROR', '上传重生成参数不合法', 400, {
      issues: fields.error.issues,
    });
  }
  if (
    !allowedImageTypes.has(file.type) ||
    file.size <= 0 ||
    file.size > maxUploadBytes
  ) {
    return jsonFail(
      'VALIDATION_ERROR',
      '仅支持不超过 10MB 的 PNG、JPEG 或 WebP 图片',
      400,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedMediaSignature(bytes, file.type)) {
    return jsonFail(
      'INVALID_MEDIA_CONTENT',
      'Uploaded bytes do not match the declared image type',
      400,
    );
  }

  const [shot, project] = await Promise.all([
    shotRepository.get(shotId),
    projectRepository.get(storyboardGroup.projectId),
  ]);
  if (!shot) {
    return jsonFail('NOT_FOUND', 'Shot not found', 404);
  }
  await settingsRepository.ensureDefaults(storyboardGroup.projectId);
  const binding = await settingsRepository.getActiveModelBinding(
    storyboardGroup.projectId,
    'agent8',
  );
  const bindingHealth = evaluateBindingHealth('agent8', binding);
  if (bindingHealth.state !== 'ready' && bindingHealth.state !== 'mock') {
    return jsonFail('PROVIDER_CONFIG_ERROR', bindingHealth.summary, 503);
  }

  let idempotencyKey: string;
  try {
    idempotencyKey = resolveWorkflowIdempotencyKey(request);
  } catch (error) {
    return jsonFail('INVALID_IDEMPOTENCY_KEY', (error as Error).message, 400);
  }
  const existingJob = await jobRepository.findByIdempotencyKey(
    storyboardGroup.projectId,
    'storyboard',
    idempotencyKey,
  );
  if (existingJob) {
    const versions = await artifactRepository.getVersions(storyboardGroup.id);
    const existingVersion = versions.versions.find(
      (version) => version.generationInput.jobId === existingJob.id,
    );
    return jsonOk(
      {
        jobId: existingJob.id,
        taskId: existingVersion?.id ?? existingJob.id,
        status: existingJob.status,
        deduplicated: true,
      },
      { idempotencyKey },
      { headers: { 'idempotency-key': idempotencyKey } },
    );
  }

  try {
    const persisted = await persistGeneratedAsset({
      base64Data: Buffer.from(bytes).toString('base64'),
      mimeType: file.type,
      prefix: `storyboard-${shotId}-reference-upload`,
    });
    const referenceAsset = {
      storagePath: persisted.storagePath,
      mimeType: file.type,
      fileName: file.name,
      fileSizeBytes: persisted.fileSizeBytes,
    };
    const promptHint = fields.data.promptHint ?? null;
    const prompt = buildStoryboardImagePrompt(
      project?.title ?? storyboardGroup.name ?? 'Storyboard',
      shot,
      {
        promptHint,
        hasReferenceImage: true,
      },
    );
    const queued = await enqueueShotRegeneration({
      request,
      idempotencyKey,
      projectId: storyboardGroup.projectId,
      jobType: 'storyboard',
      groupId: storyboardGroup.id,
      payload: {
        action: 'regenerate_shot_storyboard',
        shotId,
        promptHint,
        referenceAsset,
      },
      maxAttempts: 2,
      timeoutMs: 10 * 60_000,
      createPendingVersion: (jobId, expectation) => ({
        groupId: storyboardGroup.id,
        generatedByAgent: 'agent8',
        sourceTaskId: null,
        mimeType: file.type,
        storageBucket: null,
        storagePath: null,
        publicUrl: null,
        fileSizeBytes: null,
        width: 1280,
        height: 720,
        durationMs: null,
        generationInput: {
          jobId,
          promptHint,
          prompt,
          referenceUploadName: file.name,
          ...expectation,
          queuedAt: new Date().toISOString(),
        },
        metadata: {
          provider: binding?.provider ?? 'mock',
          model: binding?.modelName ?? 'mock',
          uploaded: true,
          queueStatus: 'queued',
        },
        status: 'pending',
        versionNote: promptHint || '上传素材后的分镜后台重生成排队中',
        isPlaceholder: false,
      }),
    });
    return jsonOk(
      {
        jobId: queued.job.id,
        taskId: queued.version?.id ?? queued.job.id,
        status: queued.job.status,
        deduplicated: !queued.created,
      },
      { idempotencyKey },
      {
        status: queued.created ? 202 : 200,
        headers: { 'idempotency-key': idempotencyKey },
      },
    );
  } catch (error) {
    return jsonProviderError(error);
  }
}
