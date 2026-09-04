import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobRepository } from '@video-agent-studio/db';
import { createTempApiTestEnv, getDemoProject } from '../test-helpers';
import { GET as getProjectJob } from '../projects/[projectId]/jobs/[jobId]/route';
import { POST as cancelProjectJob } from '../projects/[projectId]/jobs/[jobId]/cancel/route';
import { POST as resumeProjectJob } from '../projects/[projectId]/jobs/[jobId]/resume/route';
import { GET as getGlobalJob } from './[jobId]/route';
import { POST as cancelGlobalJob } from './[jobId]/cancel/route';
import { POST as resumeGlobalJob } from './[jobId]/resume/route';

function command(body: unknown) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('durable job API', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-job-routes-');
    cleanup = env.cleanup;
  });

  afterEach(async () => cleanup());

  it('reads, cancels and resumes through the project-scoped routes', async () => {
    const project = await getDemoProject();
    const { job } = await jobRepository.enqueue({
      projectId: project.id,
      jobType: 'script',
      idempotencyKey: 'job-route-command',
      payload: { confirmStageRegeneration: true },
    });
    const context = {
      params: Promise.resolve({ projectId: project.id, jobId: job.id }),
    };

    const initial = await getProjectJob(
      new Request('http://localhost'),
      context,
    );
    expect(initial.status).toBe(200);
    expect((await initial.json()).data.status).toBe('queued');

    const cancelled = await cancelProjectJob(
      command({ reason: '用户暂时停止' }),
      context,
    );
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).data.status).toBe('cancelled');

    const resumed = await resumeProjectJob(
      command({ additionalAttempts: 2 }),
      context,
    );
    expect(resumed.status).toBe(200);
    const resumedPayload = await resumed.json();
    expect(resumedPayload.data.status).toBe('queued');
    expect(resumedPayload.data.resumeCount).toBe(1);
  });

  it('does not expose or mutate a job through a mismatched project scope', async () => {
    const project = await getDemoProject();
    const { job } = await jobRepository.enqueue({
      projectId: project.id,
      jobType: 'storyboard',
      idempotencyKey: 'cross-project-job-command',
      payload: {},
    });
    const wrongScope = {
      params: Promise.resolve({
        projectId: 'another-project',
        jobId: job.id,
      }),
    };

    expect(
      (await getProjectJob(new Request('http://localhost'), wrongScope)).status,
    ).toBe(404);
    expect((await cancelProjectJob(command({}), wrongScope)).status).toBe(404);
    expect(
      (await resumeProjectJob(command({ additionalAttempts: 1 }), wrongScope))
        .status,
    ).toBe(404);
    expect((await jobRepository.get(job.id))?.status).toBe('queued');
  });

  it('rejects malformed resume input on the canonical route', async () => {
    const project = await getDemoProject();
    const { job } = await jobRepository.enqueue({
      projectId: project.id,
      jobType: 'script',
      idempotencyKey: 'invalid-resume-command',
      payload: {},
    });
    await jobRepository.requestCancellation(job.id);

    const response = await resumeProjectJob(
      command({ additionalAttempts: 0 }),
      {
        params: Promise.resolve({ projectId: project.id, jobId: job.id }),
      },
    );
    expect(response.status).toBe(400);
  });

  it('retires global job routes without inferring project authorization from jobId', async () => {
    const project = await getDemoProject();
    const { job } = await jobRepository.enqueue({
      projectId: project.id,
      jobType: 'video',
      idempotencyKey: 'retired-global-job-command',
      payload: { mode: 'missing_only' },
    });
    const context = { params: Promise.resolve({ jobId: job.id }) };

    const responses = await Promise.all([
      getGlobalJob(new Request('http://localhost'), context),
      cancelGlobalJob(command({}), context),
      resumeGlobalJob(command({ additionalAttempts: 1 }), context),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      410, 410, 410,
    ]);
    for (const response of responses) {
      expect((await response.json()).error.code).toBe('PROJECT_SCOPE_REQUIRED');
    }
    expect((await jobRepository.get(job.id))?.status).toBe('queued');
  });
});
