import { jobRepository } from '@video-agent-studio/db';
import type {
  WorkflowJobRecord,
  WorkflowType,
} from '@video-agent-studio/shared';

export interface DurableJobContext {
  job: WorkflowJobRecord;
  signal: AbortSignal;
  checkpoint: Record<string, unknown>;
  saveCheckpoint(checkpoint: Record<string, unknown>): Promise<void>;
  throwIfAborted(): void;
}

export type DurableJobHandler = (
  context: DurableJobContext,
) => Promise<Record<string, unknown> | void>;

export type DurableJobHandlerMap = Partial<
  Record<WorkflowType, DurableJobHandler>
>;

export interface DurableJobRunnerOptions {
  workerId: string;
  handlers: DurableJobHandlerMap;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  retryDelayMs?: (attemptNo: number) => number;
}

export type DurableJobRunOutcome =
  | { state: 'idle' }
  | { state: 'succeeded'; job: WorkflowJobRecord }
  | { state: 'retry_scheduled'; job: WorkflowJobRecord }
  | { state: 'failed'; job: WorkflowJobRecord }
  | { state: 'cancelled'; job: WorkflowJobRecord }
  | { state: 'lease_lost'; jobId: string };

export class DurableJobError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'DurableJobError';
    this.code = code;
    this.retryable = options?.retryable ?? true;
  }
}

class JobLeaseLostError extends DurableJobError {
  constructor(message = 'Worker no longer owns the job lease') {
    super('JOB_LEASE_LOST', message, { retryable: false });
    this.name = 'JobLeaseLostError';
  }
}

class JobTimeoutError extends DurableJobError {
  constructor(timeoutMs: number) {
    super('JOB_TIMEOUT', `Job exceeded its ${timeoutMs}ms execution timeout`);
    this.name = 'JobTimeoutError';
  }
}

class JobCancellationError extends DurableJobError {
  constructor() {
    super('JOB_CANCELLED', 'Job cancellation was requested', {
      retryable: false,
    });
    this.name = 'JobCancellationError';
  }
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function wait(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function normalizeError(error: unknown) {
  if (error instanceof DurableJobError) {
    return error;
  }
  if (error instanceof Error) {
    return new DurableJobError('JOB_HANDLER_ERROR', error.message, {
      retryable: true,
      cause: error,
    });
  }
  return new DurableJobError('JOB_HANDLER_ERROR', String(error), {
    retryable: true,
    cause: error,
  });
}

function outcomeFromJob(job: WorkflowJobRecord): DurableJobRunOutcome {
  if (job.status === 'succeeded') {
    return { state: 'succeeded', job };
  }
  if (job.status === 'retry_scheduled') {
    return { state: 'retry_scheduled', job };
  }
  if (job.status === 'cancelled') {
    return { state: 'cancelled', job };
  }
  return { state: 'failed', job };
}

export class DurableJobRunner {
  private readonly workerId: string;
  private readonly handlers: DurableJobHandlerMap;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly pollIntervalMs: number;
  private readonly retryDelayMs: (attemptNo: number) => number;

  constructor(options: DurableJobRunnerOptions) {
    this.workerId = options.workerId.trim();
    if (!this.workerId) {
      throw new Error('workerId is required');
    }
    this.handlers = options.handlers;
    this.leaseDurationMs = positiveInteger(
      options.leaseDurationMs ?? 30_000,
      'leaseDurationMs',
    );
    this.heartbeatIntervalMs = positiveInteger(
      options.heartbeatIntervalMs ??
        Math.max(250, Math.floor(this.leaseDurationMs / 3)),
      'heartbeatIntervalMs',
    );
    if (this.heartbeatIntervalMs >= this.leaseDurationMs) {
      throw new Error(
        'heartbeatIntervalMs must be shorter than leaseDurationMs',
      );
    }
    this.pollIntervalMs = positiveInteger(
      options.pollIntervalMs ?? 1_000,
      'pollIntervalMs',
    );
    this.retryDelayMs =
      options.retryDelayMs ??
      ((attemptNo) => Math.min(30_000, 500 * 2 ** Math.max(0, attemptNo - 1)));
  }

  async runOnce(): Promise<DurableJobRunOutcome> {
    const acceptedJobTypes = Object.entries(this.handlers)
      .filter(
        (entry): entry is [WorkflowType, DurableJobHandler] =>
          typeof entry[1] === 'function',
      )
      .map(([jobType]) => jobType);
    if (acceptedJobTypes.length === 0) {
      await jobRepository.recoverExpiredLeases();
      return { state: 'idle' };
    }

    const job = await jobRepository.leaseNext({
      workerId: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
      acceptedJobTypes,
    });
    if (!job) {
      return { state: 'idle' };
    }

    const handler = this.handlers[job.jobType];
    if (!handler) {
      const failure = await jobRepository.fail(job.id, this.workerId, {
        errorCode: 'JOB_HANDLER_MISSING',
        errorMessage: `No handler is registered for ${job.jobType}`,
        retryable: false,
      });
      return failure.job
        ? outcomeFromJob(failure.job)
        : { state: 'lease_lost', jobId: job.id };
    }

    const controller = new AbortController();
    let abortKind: 'timeout' | 'cancellation' | 'lease_lost' | null = null;
    let heartbeatInFlight = false;

    const abort = (kind: NonNullable<typeof abortKind>, reason: Error) => {
      if (controller.signal.aborted) {
        return;
      }
      abortKind = kind;
      controller.abort(reason);
    };

    const heartbeat = async () => {
      if (heartbeatInFlight || controller.signal.aborted) {
        return;
      }
      heartbeatInFlight = true;
      try {
        const state = await jobRepository.heartbeat(
          job.id,
          this.workerId,
          this.leaseDurationMs,
        );
        if (!state.applied) {
          abort('lease_lost', new JobLeaseLostError());
        } else if (state.cancelRequested) {
          abort('cancellation', new JobCancellationError());
        }
      } catch (error) {
        abort(
          'lease_lost',
          new JobLeaseLostError(
            `Unable to renew worker lease: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      } finally {
        heartbeatInFlight = false;
      }
    };

    const heartbeatTimer = setInterval(() => {
      void heartbeat();
    }, this.heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    const timeoutTimer = setTimeout(() => {
      abort('timeout', new JobTimeoutError(job.timeoutMs));
    }, job.timeoutMs);
    timeoutTimer.unref?.();

    const abortPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () =>
          reject(
            controller.signal.reason ??
              new DurableJobError('JOB_ABORTED', 'Job aborted'),
          ),
        { once: true },
      );
    });

    const context: DurableJobContext = {
      job,
      signal: controller.signal,
      checkpoint: job.checkpoint,
      saveCheckpoint: async (checkpoint) => {
        controller.signal.throwIfAborted();
        const saved = await jobRepository.saveCheckpoint(
          job.id,
          this.workerId,
          checkpoint,
        );
        if (!saved.applied) {
          abort('lease_lost', new JobLeaseLostError());
          throw controller.signal.reason;
        }
        context.checkpoint = saved.job?.checkpoint ?? checkpoint;
        job.checkpoint = context.checkpoint;
        job.checkpointVersion =
          saved.job?.checkpointVersion ?? job.checkpointVersion;
      },
      throwIfAborted: () => controller.signal.throwIfAborted(),
    };

    try {
      const handlerPromise = Promise.resolve().then(() => handler(context));
      // The race enforces the worker deadline. Handlers must pass `signal` to any
      // provider/network call so a timed-out execution cannot continue side effects.
      const result = await Promise.race([handlerPromise, abortPromise]);
      const completed = await jobRepository.complete(
        job.id,
        this.workerId,
        result ?? {},
      );
      if (!completed.applied || !completed.job) {
        return { state: 'lease_lost', jobId: job.id };
      }
      return outcomeFromJob(completed.job);
    } catch (error) {
      if (abortKind === 'lease_lost') {
        return { state: 'lease_lost', jobId: job.id };
      }
      if (abortKind === 'cancellation') {
        const cancelled = await jobRepository.acknowledgeCancellation(
          job.id,
          this.workerId,
        );
        if (!cancelled.applied || !cancelled.job) {
          return { state: 'lease_lost', jobId: job.id };
        }
        return outcomeFromJob(cancelled.job);
      }

      const normalized =
        abortKind === 'timeout'
          ? new JobTimeoutError(job.timeoutMs)
          : normalizeError(error);
      const retryDelayMs = nonNegativeInteger(
        Math.trunc(this.retryDelayMs(job.attemptCount)),
        'retryDelayMs',
      );
      const failed = await jobRepository.fail(job.id, this.workerId, {
        errorCode: normalized.code,
        errorMessage: normalized.message,
        retryable: normalized.retryable,
        retryDelayMs,
        timedOut: abortKind === 'timeout',
      });
      if (!failed.applied || !failed.job) {
        return { state: 'lease_lost', jobId: job.id };
      }
      return outcomeFromJob(failed.job);
    } finally {
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
    }
  }

  async runUntilIdle(maxJobs = 100) {
    positiveInteger(maxJobs, 'maxJobs');
    const outcomes: DurableJobRunOutcome[] = [];
    for (let index = 0; index < maxJobs; index += 1) {
      const outcome = await this.runOnce();
      outcomes.push(outcome);
      if (outcome.state === 'idle') {
        break;
      }
    }
    return outcomes;
  }

  async start(signal?: AbortSignal) {
    while (!signal?.aborted) {
      try {
        const outcome = await this.runOnce();
        if (outcome.state !== 'idle') {
          continue;
        }
      } catch (error) {
        // Repository or filesystem failures are infrastructure failures, not job
        // failures. Keep the standalone worker alive so it can recover on the
        // next poll without consuming an attempt whose lease was never acquired.
        console.error('[worker] durable job poll failed', error);
      }
      if (!signal?.aborted) {
        await wait(this.pollIntervalMs, signal);
      }
    }
  }
}
