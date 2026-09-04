import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDb, readDb } from '../dev-file-db';
import { jobRepository } from './job.repository';
import { runRepository } from './run.repository';

const at = (seconds: number) =>
  new Date(Date.UTC(2026, 8, 3, 0, 0, seconds)).toISOString();

describe('jobRepository', () => {
  let tempDirectory = '';
  let projectId = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'vas-job-repository-'),
    );
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(
      tempDirectory,
      'db.json',
    );
    const db = await ensureDb();
    projectId = db.projects[0].id;
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('deduplicates enqueue and atomically appends a lifecycle event plus outbox record', async () => {
    const first = await jobRepository.enqueue(
      {
        projectId,
        jobType: 'script',
        idempotencyKey: 'same-command',
        payload: { startFromNode: 'agent2' },
      },
      at(0),
    );
    const replay = await jobRepository.enqueue(
      {
        projectId,
        jobType: 'script',
        idempotencyKey: 'same-command',
        payload: { startFromNode: 'agent2' },
      },
      at(1),
    );

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.job.id).toBe(first.job.id);
    const db = await readDb();
    expect(
      db.workflowJobs.filter((job) => job.idempotencyKey === 'same-command'),
    ).toHaveLength(1);
    expect(
      db.taskEvents.filter(
        (event) =>
          event.eventType === 'job_queued' &&
          event.jobId === first.job.id &&
          event.eventPayload.jobId === first.job.id,
      ),
    ).toHaveLength(1);
    expect(
      db.outboxEvents.filter(
        (event) =>
          event.eventType === 'job_queued' &&
          event.aggregateId === first.job.id,
      ),
    ).toHaveLength(1);
  });

  it('binds one and only one workflow run to a durable job', async () => {
    const { job } = await jobRepository.enqueue({
      projectId,
      jobType: 'script',
      idempotencyKey: 'stable-workflow-run-binding',
      payload: {},
    });
    const input = {
      workflowType: 'script' as const,
      triggerMode: 'manual' as const,
      startFromNode: 'agent2' as const,
      endAtNode: 'script_user_confirm' as const,
      currentNode: 'agent2' as const,
      runReason: 'stable durable binding test',
    };

    const first = await runRepository.createOnceForJob(
      projectId,
      job.id,
      input,
    );
    const replay = await runRepository.createOnceForJob(
      projectId,
      job.id,
      input,
    );

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.run.id).toBe(first.run.id);
    expect((await runRepository.getByOriginJobId(job.id))?.id).toBe(
      first.run.id,
    );
    expect(
      (await readDb()).workflowRuns.filter(
        (run) => run.originJobId === job.id && !run.deletedAt,
      ),
    ).toHaveLength(1);
  });

  it('enforces lease ownership while heartbeating, checkpointing and completing', async () => {
    const { job } = await jobRepository.enqueue(
      {
        projectId,
        jobType: 'script',
        idempotencyKey: 'lease-owner',
        payload: {},
      },
      at(0),
    );
    const leased = await jobRepository.leaseNext({
      workerId: 'worker-a',
      leaseDurationMs: 10_000,
      now: at(1),
    });
    expect(leased?.id).toBe(job.id);

    const heartbeat = await jobRepository.heartbeat(
      job.id,
      'worker-a',
      10_000,
      at(5),
    );
    expect(heartbeat.applied).toBe(true);
    expect(heartbeat.job?.leaseExpiresAt).toBe(at(15));
    expect(
      await jobRepository.leaseNext({
        workerId: 'worker-b',
        leaseDurationMs: 10_000,
        now: at(11),
      }),
    ).toBeNull();

    const checkpoint = await jobRepository.saveCheckpoint(
      job.id,
      'worker-a',
      { node: 'agent2' },
      at(12),
    );
    expect(checkpoint.applied).toBe(true);
    expect(checkpoint.job?.checkpointVersion).toBe(1);
    expect(
      (await jobRepository.complete(job.id, 'worker-b', {}, at(12))).reason,
    ).toBe('lease_lost');

    const completed = await jobRepository.complete(
      job.id,
      'worker-a',
      { runId: 'run-1' },
      at(13),
    );
    expect(completed.applied).toBe(true);
    expect(completed.job?.status).toBe('succeeded');
    expect(completed.job?.result).toEqual({ runId: 'run-1' });
    expect((await jobRepository.listAttempts(job.id))[0].status).toBe(
      'succeeded',
    );
    const db = await readDb();
    expect(
      db.taskEvents
        .filter((event) => event.jobId === job.id)
        .map((event) => event.eventType),
    ).toEqual(
      expect.arrayContaining(['job_queued', 'job_leased', 'job_succeeded']),
    );
    expect(
      db.outboxEvents
        .filter((event) => event.aggregateId === job.id)
        .map((event) => event.eventType),
    ).toEqual(
      expect.arrayContaining(['job_queued', 'job_leased', 'job_succeeded']),
    );
  });

  it('recovers an expired lease, rejects the stale worker and preserves each attempt', async () => {
    const { job } = await jobRepository.enqueue(
      {
        projectId,
        jobType: 'storyboard',
        idempotencyKey: 'crash-recovery',
        payload: {},
        maxAttempts: 2,
      },
      at(0),
    );
    await jobRepository.leaseNext({
      workerId: 'worker-a',
      leaseDurationMs: 5_000,
      now: at(1),
    });
    const recovered = await jobRepository.leaseNext({
      workerId: 'worker-b',
      leaseDurationMs: 5_000,
      now: at(7),
    });
    expect(recovered?.id).toBe(job.id);
    expect(recovered?.attemptCount).toBe(2);
    expect(
      (await jobRepository.complete(job.id, 'worker-a', {}, at(8))).reason,
    ).toBe('lease_lost');

    const failed = await jobRepository.fail(job.id, 'worker-b', {
      errorCode: 'PROVIDER_DOWN',
      errorMessage: 'provider unavailable',
      retryable: true,
      now: at(8),
    });
    expect(failed.job?.status).toBe('failed');
    expect(
      (await jobRepository.listAttempts(job.id)).map(
        (attempt) => attempt.status,
      ),
    ).toEqual(['lease_expired', 'failed']);
    const db = await readDb();
    const eventTypes = db.taskEvents
      .filter((event) => event.eventPayload.jobId === job.id)
      .map((event) => event.eventType);
    expect(eventTypes).toContain('job_retry_scheduled');
    expect(eventTypes).toContain('job_failed');
    const outboxEventTypes = db.outboxEvents
      .filter((event) => event.aggregateId === job.id)
      .map((event) => event.eventType);
    expect(outboxEventTypes).toContain('job_retry_scheduled');
    expect(outboxEventTypes).toContain('job_failed');
  });

  it('cancels queued and running jobs and can explicitly resume a terminal job', async () => {
    const { job } = await jobRepository.enqueue(
      {
        projectId,
        jobType: 'video',
        idempotencyKey: 'cancel-resume',
        payload: { mode: 'missing_only' },
        maxAttempts: 1,
      },
      at(0),
    );
    const firstCancellation = await jobRepository.requestCancellation(
      job.id,
      'user request',
      at(1),
    );
    expect(firstCancellation.job?.status).toBe('cancelled');
    const cancellationReplay = await jobRepository.requestCancellation(
      job.id,
      'duplicate request',
      at(2),
    );
    expect(cancellationReplay).toMatchObject({
      applied: true,
      job: { status: 'cancelled' },
    });
    expect(
      (await readDb()).taskEvents.filter(
        (event) =>
          event.jobId === job.id && event.eventType === 'job_cancelled',
      ),
    ).toHaveLength(1);
    const resumed = await jobRepository.resume(job.id, {
      additionalAttempts: 2,
      now: at(2),
    });
    expect(resumed.job?.status).toBe('queued');
    expect(resumed.job?.maxAttempts).toBe(2);
    expect(resumed.job?.resumeCount).toBe(1);

    await jobRepository.leaseNext({
      workerId: 'worker-a',
      leaseDurationMs: 10_000,
      now: at(3),
    });
    await jobRepository.requestCancellation(job.id, 'changed mind', at(4));
    const heartbeat = await jobRepository.heartbeat(
      job.id,
      'worker-a',
      10_000,
      at(5),
    );
    expect(heartbeat.cancelRequested).toBe(true);
    const cancelled = await jobRepository.acknowledgeCancellation(
      job.id,
      'worker-a',
      at(6),
    );
    expect(cancelled.job?.status).toBe('cancelled');
    expect((await jobRepository.listAttempts(job.id))[0].status).toBe(
      'cancelled',
    );
    const db = await readDb();
    expect(
      db.taskEvents.filter(
        (event) =>
          event.jobId === job.id && event.eventType === 'job_cancelled',
      ),
    ).toHaveLength(2);
    expect(
      db.outboxEvents.filter(
        (event) =>
          event.aggregateId === job.id && event.eventType === 'job_cancelled',
      ),
    ).toHaveLength(2);
  });
});
