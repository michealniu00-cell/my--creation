import { evaluateBindingHealth } from '@video-agent-studio/providers';
import {
  artifactRepository,
  ensureDb,
  projectRepository,
  settingsRepository,
} from '@video-agent-studio/db';
import { shotRegenerationRequestSchema } from '@video-agent-studio/shared';
import { enqueueShotRegeneration } from '../../../../../../lib/enqueue-shot-regeneration';
import { jsonFail, jsonOk, readJsonStrict } from '../../../../../../lib/http';
import { jsonProviderError } from '../../../../../../lib/provider-errors';
import {
  ensureActiveArtifactVersionUnlocked,
  ensureShotUnlocked,
} from '../../../../../../lib/route-guards';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shotId: string }> },
) {
  await ensureDb();
  const { shotId } = await params;
  const shotConflict = await ensureShotUnlocked(
    shotId,
    'Locked shot cannot regenerate video',
  );
  if (shotConflict) {
    return shotConflict;
  }
  const body = await readJsonStrict(request);
  if (!body.success) {
    return body.response;
  }
  const parsed = shotRegenerationRequestSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonFail(
      'INVALID_REGENERATION_INPUT',
      'Shot 视频重生成参数不合法',
      400,
      {
        issues: parsed.error.issues,
      },
    );
  }

  const video = await artifactRepository.getShotVideo(shotId);
  if (!video?.group) {
    return jsonFail('NOT_FOUND', 'Video group not found', 404);
  }
  const videoGroup = video.group;
  const artifactConflict = await ensureActiveArtifactVersionUnlocked(
    videoGroup.id,
    'Locked video version cannot be replaced',
  );
  if (artifactConflict) {
    return artifactConflict;
  }
  await settingsRepository.ensureDefaults(videoGroup.projectId);
  const binding = await settingsRepository.getActiveModelBinding(
    videoGroup.projectId,
    'agent9',
  );
  const bindingHealth = evaluateBindingHealth('agent9', binding);
  if (bindingHealth.state !== 'ready' && bindingHealth.state !== 'mock') {
    return jsonFail('PROVIDER_CONFIG_ERROR', bindingHealth.summary, 503);
  }
  const project = await projectRepository.get(videoGroup.projectId);

  try {
    const promptHint = parsed.data.promptHint ?? null;
    const queued = await enqueueShotRegeneration({
      request,
      projectId: videoGroup.projectId,
      jobType: 'video',
      groupId: videoGroup.id,
      payload: {
        action: 'regenerate_shot_video',
        shotId,
        promptHint,
        referenceAsset: null,
        referenceAssetType: null,
      },
      maxAttempts: 2,
      timeoutMs: 30 * 60_000,
      createPendingVersion: (jobId, expectation) => ({
        groupId: videoGroup.id,
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
          jobId,
          promptHint,
          ...expectation,
          queuedAt: new Date().toISOString(),
        },
        metadata: {
          provider: binding?.provider ?? 'mock',
          model: binding?.modelName ?? 'mock',
          queueStatus: 'queued',
        },
        status: 'pending',
        versionNote:
          promptHint ?? `${project?.title ?? 'Shot'} 视频后台重生成排队中`,
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
      { idempotencyKey: queued.idempotencyKey },
      {
        status: queued.created ? 202 : 200,
        headers: { 'idempotency-key': queued.idempotencyKey },
      },
    );
  } catch (error) {
    return jsonProviderError(error);
  }
}
