import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactRepository, jobRepository, settingsRepository } from '@video-agent-studio/db';
import { createWorkflowJobHandlers, DurableJobRunner } from '@video-agent-studio/worker';
import { POST } from './route';
import { createTempApiTestEnv, getDemoProject, getDemoShot } from '../../../../test-helpers';

describe('POST /api/shots/[shotId]/storyboard/regenerate', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-storyboard-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('queues a new storyboard version with a shot-specific prompt in mock mode', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(project.id, 'agent8');
    const before = await artifactRepository.getShotStoryboard(shot.id);
    const beforeCount = before?.versions.length ?? 0;

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ promptHint: 'cinematic refresh' }),
      }),
      {
        params: Promise.resolve({ shotId: shot.id }),
      },
    );

    const payload = (await response.json()) as {
      success: boolean;
      data: { taskId: string; status: string };
    };
    const after = await artifactRepository.getShotStoryboard(shot.id);
    const queuedVersion = after?.versions.find((item) => item.id === payload.data.taskId);

    expect(response.status).toBe(202);
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('queued');
    expect(after?.versions.length).toBe(beforeCount + 1);
    expect(queuedVersion?.metadata?.provider).toBe(binding?.provider ?? 'mock');
    expect(queuedVersion?.metadata?.model).toBe(binding?.modelName ?? 'gpt-image-1');
    expect(queuedVersion?.metadata?.queueStatus).toBe('queued');
    expect(queuedVersion?.generationInput?.promptHint).toBe('cinematic refresh');
    expect(String(queuedVersion?.generationInput?.prompt ?? '')).toContain(String(shot.title ?? ''));
    expect(String(queuedVersion?.generationInput?.prompt ?? '')).toContain(
      '目标: 优先完整还原当前shot的文字、内容、排版、位置与顺序；画面一致性仅为次级约束。',
    );
    expect(String(queuedVersion?.generationInput?.prompt ?? '').length).toBeLessThanOrEqual(1450);
    const jobId = (queuedVersion?.generationInput?.jobId as string | undefined) ?? '';
    expect((await jobRepository.get(jobId))?.status).toBe('queued');

    const outcome = await new DurableJobRunner({
      workerId: 'storyboard-route-test-worker',
      handlers: createWorkflowJobHandlers(),
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
    }).runOnce();
    expect(outcome.state).toBe('succeeded');
    const completedStoryboard = await artifactRepository.getShotStoryboard(shot.id);
    expect(completedStoryboard?.group?.activeVersionId).toBe(queuedVersion?.id);
    expect(completedStoryboard?.versions.find((version) => version.id === queuedVersion?.id)?.status).toBe(
      'generated',
    );
  });

  it('returns a normalized provider config error when openai is selected without credentials', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(project.id, 'agent8');
    expect(binding).toBeTruthy();

    await settingsRepository.updateModelBinding(project.id, binding!.id, {
      provider: 'openai',
      modelName: 'gpt-image-1',
      temperature: binding!.temperature ?? null,
      maxTokens: binding!.maxTokens ?? null,
      timeoutSec: binding!.timeoutSec ?? null,
      retryLimit: binding!.retryLimit ?? null,
      extraConfig: binding!.extraConfig ?? {},
    });

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ promptHint: 'should fail' }),
      }),
      {
        params: Promise.resolve({ shotId: shot.id }),
      },
    );
    const payload = (await response.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };

    expect(response.status).toBe(503);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('PROVIDER_CONFIG_ERROR');
    expect(payload.error.message).toContain('VIDEO_AGENT_STUDIO_IMAGE_API_KEY');
  });
});
