import { evaluateBindingHealth } from '@video-agent-studio/providers';
import {
  artifactRepository,
  ensureDb,
  settingsRepository,
} from '@video-agent-studio/db';
import { keyElementRegenerateSchema } from '@video-agent-studio/shared';
import { enqueueShotRegeneration } from '../../../../../lib/enqueue-shot-regeneration';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../../../lib/http';
import { jsonProviderError } from '../../../../../lib/provider-errors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactGroupId: string }> },
) {
  await ensureDb();
  const { artifactGroupId } = await params;
  const body = await readJsonWithSchema(request, keyElementRegenerateSchema, {
    message: 'Invalid key element regenerate payload',
  });
  if (!body.success) {
    return body.response;
  }

  const artifact = await artifactRepository.getVersions(artifactGroupId);
  if (!artifact.group) {
    return jsonFail('NOT_FOUND', 'Key element group not found', 404);
  }
  await settingsRepository.ensureDefaults(artifact.group.projectId);
  const binding = await settingsRepository.getActiveModelBinding(
    artifact.group.projectId,
    'agent8',
  );
  const health = evaluateBindingHealth('agent8', binding);
  if (health.state !== 'ready' && health.state !== 'mock') {
    return jsonFail('PROVIDER_CONFIG_ERROR', health.summary, 503);
  }

  try {
    const queued = await enqueueShotRegeneration({
      request,
      projectId: artifact.group.projectId,
      jobType: 'storyboard',
      groupId: artifact.group.id,
      payload: {
        action: 'regenerate_key_element',
        artifactGroupId: artifact.group.id,
        promptHint: body.data.promptHint,
        basedOnVersionId: body.data.basedOnVersionId,
      },
      maxAttempts: 2,
      timeoutMs: 10 * 60_000,
      createPendingVersion: (jobId, expectation) => ({
        groupId: artifact.group!.id,
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
          jobId,
          promptHint: body.data.promptHint ?? null,
          basedOnVersionId: body.data.basedOnVersionId ?? null,
          ...expectation,
          queuedAt: new Date().toISOString(),
        },
        metadata: {
          provider: binding?.provider ?? 'mock',
          model: binding?.modelName ?? 'mock',
          queueStatus: 'queued',
        },
        status: 'pending',
        versionNote: body.data.promptHint ?? '关键要素图后台重生成排队中',
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
