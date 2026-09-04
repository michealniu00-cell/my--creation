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

describe('POST /api/shots/[shotId]/storyboard/regenerate-with-upload', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-storyboard-upload-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns validation error when the uploaded file is missing', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    const formData = new FormData();
    formData.set('promptHint', 'missing file');

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: formData,
      }),
      {
        params: Promise.resolve({ shotId: shot.id }),
      },
    );
    const payload = (await response.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toContain('File is required');
  });

  it('persists the upload reference and queues generation without storing base64 in the job', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    const formData = new FormData();
    formData.set('promptHint', 'preserve the uploaded composition');
    formData.set(
      'file',
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        'reference.png',
        {
          type: 'image/png',
        },
      ),
    );

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'idempotency-key': 'storyboard-upload-command' },
        body: formData,
      }),
      { params: Promise.resolve({ shotId: shot.id }) },
    );
    const payload = (await response.json()) as {
      data: { jobId: string; taskId: string; status: string };
    };

    expect(response.status).toBe(202);
    expect(payload.data.status).toBe('queued');
    const job = await jobRepository.get(payload.data.jobId);
    expect(job?.payload).toMatchObject({
      action: 'regenerate_shot_storyboard',
      shotId: shot.id,
      referenceAsset: {
        fileName: 'reference.png',
        mimeType: 'image/png',
      },
    });
    expect(JSON.stringify(job?.payload)).not.toContain('iVBOR');
    const pending = await artifactRepository.getShotStoryboard(shot.id);
    expect(
      pending?.versions.find((version) => version.id === payload.data.taskId)
        ?.status,
    ).toBe('pending');

    const outcome = await new DurableJobRunner({
      workerId: 'storyboard-upload-test-worker',
      handlers: createWorkflowJobHandlers(),
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
    }).runOnce();
    expect(outcome.state).toBe('succeeded');
    expect(
      (await artifactRepository.getShotStoryboard(shot.id))?.group
        ?.activeVersionId,
    ).toBe(payload.data.taskId);
  });

  it('rejects an upload whose bytes do not match its declared MIME type', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    const formData = new FormData();
    formData.set(
      'file',
      new File(['not actually a png'], 'spoofed.png', { type: 'image/png' }),
    );

    const response = await POST(
      new Request('http://localhost', { method: 'POST', body: formData }),
      { params: Promise.resolve({ shotId: shot.id }) },
    );
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_MEDIA_CONTENT' },
    });
    expect(response.status).toBe(400);
  });
});
