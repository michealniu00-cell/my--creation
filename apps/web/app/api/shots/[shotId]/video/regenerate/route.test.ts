import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactRepository, jobRepository } from '@video-agent-studio/db';
import {
  createWorkflowJobHandlers,
  DurableJobRunner,
} from '@video-agent-studio/worker';
import { POST } from './route';
import {
  createTempApiTestEnv,
  getDemoProject,
  getDemoShot,
} from '../../../../test-helpers';

describe('POST /api/shots/[shotId]/video/regenerate', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-video-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('persists a pending version, enqueues once, and lets the worker publish it', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    const before = await artifactRepository.getShotVideo(shot.id);
    const beforeCount = before?.versions.length ?? 0;
    const command = new Request('http://localhost', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'video-regeneration-command',
      },
      body: JSON.stringify({ promptHint: 'slower cinematic movement' }),
    });

    const response = await POST(command, {
      params: Promise.resolve({ shotId: shot.id }),
    });
    const payload = (await response.json()) as {
      data: { jobId: string; taskId: string; status: string };
    };

    expect(response.status).toBe(202);
    expect(payload.data.status).toBe('queued');
    expect(
      (await jobRepository.get(payload.data.jobId))?.payload,
    ).toMatchObject({
      action: 'regenerate_shot_video',
      shotId: shot.id,
      promptHint: 'slower cinematic movement',
    });
    const pending = await artifactRepository.getShotVideo(shot.id);
    expect(pending?.versions).toHaveLength(beforeCount + 1);
    expect(
      pending?.versions.find((version) => version.id === payload.data.taskId)
        ?.status,
    ).toBe('pending');

    const outcome = await new DurableJobRunner({
      workerId: 'video-route-test-worker',
      handlers: createWorkflowJobHandlers(),
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
    }).runOnce();
    expect(outcome.state).toBe('succeeded');
    const completed = await artifactRepository.getShotVideo(shot.id);
    expect(completed?.group?.activeVersionId).toBe(payload.data.taskId);
    expect(
      completed?.versions.find((version) => version.id === payload.data.taskId)
        ?.status,
    ).toBe('generated');
  });
});
