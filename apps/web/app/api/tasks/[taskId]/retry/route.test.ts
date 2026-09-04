import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('legacy task retry API', () => {
  it('cannot create agent output outside the workflow engine and durable job', async () => {
    const response = await POST(
      new Request('http://localhost/api/tasks/task-1/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: 'DURABLE_JOB_REQUIRED',
        details: {
          canonicalPath: '/api/projects/{projectId}/jobs/{jobId}/resume',
        },
      },
    });
  });
});
