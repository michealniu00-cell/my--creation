import { evaluateBindingHealth } from '@video-agent-studio/providers';
import {
  artifactRepository,
  ensureDb,
  projectRepository,
  settingsRepository,
  shotRepository,
} from '@video-agent-studio/db';
import {
  buildStoryboardImagePrompt,
  shotRegenerationRequestSchema,
} from '@video-agent-studio/shared';
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
    'Locked shot cannot regenerate storyboard',
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
      'Shot 分镜重生成参数不合法',
      400,
      {
        issues: parsed.error.issues,
      },
    );
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
  const [project, shot] = await Promise.all([
    projectRepository.get(storyboardGroup.projectId),
    shotRepository.get(shotId),
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

  try {
    const promptHint = parsed.data.promptHint ?? null;
    const prompt = buildStoryboardImagePrompt(
      project?.title ?? 'Storyboard',
      shot,
      { promptHint },
    );
    const queued = await enqueueShotRegeneration({
      request,
      projectId: storyboardGroup.projectId,
      jobType: 'storyboard',
      groupId: storyboardGroup.id,
      payload: {
        action: 'regenerate_shot_storyboard',
        shotId,
        promptHint,
        referenceAsset: null,
      },
      maxAttempts: 2,
      timeoutMs: 10 * 60_000,
      createPendingVersion: (jobId, expectation) => ({
        groupId: storyboardGroup.id,
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
          jobId,
          promptHint,
          prompt,
          ...expectation,
          queuedAt: new Date().toISOString(),
        },
        metadata: {
          provider: binding?.provider ?? 'mock',
          model: binding?.modelName ?? 'mock',
          queueStatus: 'queued',
        },
        status: 'pending',
        versionNote: promptHint ?? 'Shot 分镜后台重生成排队中',
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
