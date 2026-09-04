import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureDb, jobRepository } from '@video-agent-studio/db';
import { DurableJobError, DurableJobRunner } from './job-runner';

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition');
}

describe('DurableJobRunner', () => {
  let tempDirectory = '';
  let projectId = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'vas-job-runner-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(
      tempDirectory,
      'db.json',
    );
    const db = await ensureDb();
    projectId = db.projects[0].id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('persists checkpoints and completes a leased handler', async () => {
    const { job } = await jobRepository.enqueue({
      projectId,
      jobType: 'script',
      idempotencyKey: 'runner-success',
      payload: {},
      timeoutMs: 1_000,
    });
    const runner = new DurableJobRunner({
      workerId: 'runner-a',
      leaseDurationMs: 500,
      heartbeatIntervalMs: 50,
      handlers: {
        script: async (context) => {
          await context.saveCheckpoint({ node: 'agent3' });
          return { runId: 'run-success' };
        },
      },
    });

    expect((await runner.runOnce()).state).toBe('succeeded');
    const persisted = await jobRepository.get(job.id);
    expect(persisted?.checkpoint).toEqual({ node: 'agent3' });
    expect(persisted?.result).toEqual({ runId: 'run-success' });
  });

  it('retries a transient handler failure and then succeeds', async () => {
    const { job } = await jobRepository.enqueue({
      projectId,
      jobType: 'script',
      idempotencyKey: 'runner-retry',
      payload: {},
      maxAttempts: 2,
      timeoutMs: 1_000,
    });
    let calls = 0;
    const runner = new DurableJobRunner({
      workerId: 'runner-a',
      leaseDurationMs: 500,
      heartbeatIntervalMs: 50,
      retryDelayMs: () => 0,
      handlers: {
        script: async () => {
          calls += 1;
          if (calls === 1) throw new DurableJobError('TRANSIENT', 'try again');
          return { ok: true };
        },
      },
    });

    expect((await runner.runOnce()).state).toBe('retry_scheduled');
    expect((await runner.runOnce()).state).toBe('succeeded');
    expect((await jobRepository.get(job.id))?.attemptCount).toBe(2);
  });

  it('marks a cooperative timeout and does not leave the lease running', async () => {
    const { job } = await jobRepository.enqueue({
      projectId,
      jobType: 'script',
      idempotencyKey: 'runner-timeout',
      payload: {},
      maxAttempts: 1,
      timeoutMs: 25,
    });
    const runner = new DurableJobRunner({
      workerId: 'runner-a',
      leaseDurationMs: 500,
      heartbeatIntervalMs: 10,
      handlers: {
        script: async ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      },
    });

    expect((await runner.runOnce()).state).toBe('failed');
    const persisted = await jobRepository.get(job.id);
    expect(persisted?.status).toBe('failed');
    expect(persisted?.lastErrorCode).toBe('JOB_TIMEOUT');
    expect((await jobRepository.listAttempts(job.id))[0].status).toBe(
      'timed_out',
    );
  });

  it('observes a running cancellation through heartbeat and acknowledges it', async () => {
    const { job } = await jobRepository.enqueue({
      projectId,
      jobType: 'script',
      idempotencyKey: 'runner-cancel',
      payload: {},
      timeoutMs: 1_000,
    });
    const runner = new DurableJobRunner({
      workerId: 'runner-a',
      leaseDurationMs: 500,
      heartbeatIntervalMs: 10,
      handlers: {
        script: async ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      },
    });

    const execution = runner.runOnce();
    await waitFor(
      async () => (await jobRepository.get(job.id))?.status === 'running',
    );
    await jobRepository.requestCancellation(job.id, 'user cancelled');
    expect((await execution).state).toBe('cancelled');
    expect((await jobRepository.get(job.id))?.status).toBe('cancelled');
  });

  it('keeps polling after a transient repository failure', async () => {
    const shutdown = new AbortController();
    let leaseCalls = 0;
    vi.spyOn(jobRepository, 'leaseNext').mockImplementation(async () => {
      leaseCalls += 1;
      if (leaseCalls === 1) {
        throw new Error('temporary filesystem outage');
      }
      shutdown.abort();
      return null;
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runner = new DurableJobRunner({
      workerId: 'runner-resilient',
      pollIntervalMs: 1,
      handlers: { script: async () => ({ ok: true }) },
    });

    await runner.start(shutdown.signal);

    expect(leaseCalls).toBe(2);
    expect(console.error).toHaveBeenCalledWith(
      '[worker] durable job poll failed',
      expect.any(Error),
    );
  });
});
