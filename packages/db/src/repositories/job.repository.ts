import type {
  EventLevel,
  WorkflowJobAttemptRecord,
  WorkflowJobRecord,
  WorkflowType,
} from '@video-agent-studio/shared';
import type { DatabaseState } from '../types';
import { id, mutateDb, readDb, timestamp } from '../dev-file-db';

export interface EnqueueWorkflowJobInput {
  projectId: string;
  jobType: WorkflowType;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  runAfter?: string;
}

export interface LeaseWorkflowJobOptions {
  workerId: string;
  leaseDurationMs: number;
  acceptedJobTypes?: WorkflowType[];
  now?: string;
}

export interface FailWorkflowJobInput {
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  retryDelayMs?: number;
  timedOut?: boolean;
  now?: string;
}

export interface JobMutationResult {
  job: WorkflowJobRecord | null;
  applied: boolean;
  reason?:
    | 'not_found'
    | 'lease_lost'
    | 'invalid_state'
    | 'not_cancel_requested';
}

function asEpoch(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

function isoAfter(value: string, durationMs: number) {
  return new Date(asEpoch(value) + durationMs).toISOString();
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function cloneRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function appendJobEvent(
  db: DatabaseState,
  job: WorkflowJobRecord,
  input: {
    eventType: string;
    eventLevel?: EventLevel;
    userVisible?: boolean;
    summary: string;
    details?: Record<string, unknown>;
  },
  now: string,
) {
  const eventId = id();
  const eventPayload = {
    jobId: job.id,
    jobType: job.jobType,
    jobStatus: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    idempotencyKey: job.idempotencyKey,
    ...(input.details ?? {}),
  };
  const resultRunId =
    job.result && typeof job.result.runId === 'string'
      ? job.result.runId
      : null;
  db.taskEvents.push({
    id: eventId,
    projectId: job.projectId,
    runId: resultRunId,
    taskId: null,
    jobId: job.id,
    eventType: input.eventType,
    eventLevel: input.eventLevel ?? 'info',
    userVisible: input.userVisible ?? false,
    summary: input.summary,
    eventPayload,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  db.outboxEvents.push({
    id: id(),
    aggregateType: 'workflow_job',
    aggregateId: job.id,
    eventType: input.eventType,
    eventPayload: {
      sourceEventId: eventId,
      projectId: job.projectId,
      ...eventPayload,
    },
    publishedAt: null,
    publishAttempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

function touch(record: { updatedAt: string }, now: string) {
  record.updatedAt = now;
}

function clearLease(job: WorkflowJobRecord) {
  job.leaseOwner = null;
  job.leaseExpiresAt = null;
  job.heartbeatAt = null;
}

function currentAttempt(db: DatabaseState, job: WorkflowJobRecord) {
  return db.workflowJobAttempts.find(
    (attempt) =>
      attempt.jobId === job.id &&
      attempt.attemptNo === job.attemptCount &&
      attempt.status === 'running' &&
      !attempt.deletedAt,
  );
}

function finishAttempt(
  db: DatabaseState,
  job: WorkflowJobRecord,
  status: Exclude<WorkflowJobAttemptRecord['status'], 'running'>,
  now: string,
  errorCode: string | null = null,
  errorMessage: string | null = null,
) {
  const attempt = currentAttempt(db, job);
  if (!attempt) {
    return;
  }
  attempt.status = status;
  attempt.finishedAt = now;
  attempt.errorCode = errorCode;
  attempt.errorMessage = errorMessage;
  touch(attempt, now);
}

function expireLease(db: DatabaseState, job: WorkflowJobRecord, now: string) {
  if (
    job.status !== 'running' ||
    !job.leaseExpiresAt ||
    asEpoch(job.leaseExpiresAt) > asEpoch(now)
  ) {
    return false;
  }

  finishAttempt(
    db,
    job,
    job.cancelRequestedAt ? 'cancelled' : 'lease_expired',
    now,
    job.cancelRequestedAt ? 'JOB_CANCELLED' : 'JOB_LEASE_EXPIRED',
    job.cancelRequestedAt
      ? (job.cancelReason ??
          'Cancellation acknowledged after worker lease expired')
      : 'Worker lease expired before the attempt completed',
  );
  clearLease(job);

  if (job.cancelRequestedAt) {
    job.status = 'cancelled';
    job.completedAt = now;
    appendJobEvent(
      db,
      job,
      {
        eventType: 'job_cancelled',
        userVisible: true,
        summary: `${job.jobType} 任务已取消`,
        details: { reason: job.cancelReason, recoveryReason: 'lease_expired' },
      },
      now,
    );
  } else if (job.attemptCount < job.maxAttempts) {
    job.status = 'retry_scheduled';
    job.runAfter = now;
    job.lastErrorCode = 'JOB_LEASE_EXPIRED';
    job.lastErrorMessage = 'Worker lease expired before the attempt completed';
    appendJobEvent(
      db,
      job,
      {
        eventType: 'job_retry_scheduled',
        eventLevel: 'warn',
        summary: `${job.jobType} 任务租约过期，已安排恢复重试`,
        details: { errorCode: 'JOB_LEASE_EXPIRED', runAfter: job.runAfter },
      },
      now,
    );
  } else {
    job.status = 'failed';
    job.completedAt = now;
    job.lastErrorCode = 'JOB_LEASE_EXPIRED';
    job.lastErrorMessage = 'Worker lease expired and no attempts remain';
    appendJobEvent(
      db,
      job,
      {
        eventType: 'job_failed',
        eventLevel: 'error',
        userVisible: true,
        summary: `${job.jobType} 任务失败：worker 租约过期且没有剩余重试`,
        details: { errorCode: 'JOB_LEASE_EXPIRED' },
      },
      now,
    );
  }
  touch(job, now);
  return true;
}

function recoverExpiredLeases(db: DatabaseState, now: string) {
  let recovered = 0;
  for (const job of db.workflowJobs) {
    if (!job.deletedAt && expireLease(db, job, now)) {
      recovered += 1;
    }
  }
  return recovered;
}

function ownsActiveLease(
  db: DatabaseState,
  job: WorkflowJobRecord,
  workerId: string,
  now: string,
) {
  if (
    job.status !== 'running' ||
    job.leaseOwner !== workerId ||
    !job.leaseExpiresAt
  ) {
    return false;
  }
  if (asEpoch(job.leaseExpiresAt) <= asEpoch(now)) {
    expireLease(db, job, now);
    return false;
  }
  return true;
}

function mutationResult(
  job: WorkflowJobRecord | null,
  applied: boolean,
  reason?: JobMutationResult['reason'],
): JobMutationResult {
  return { job, applied, ...(reason ? { reason } : {}) };
}

export const jobRepository = {
  async enqueue(input: EnqueueWorkflowJobInput, now = timestamp()) {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new Error('idempotencyKey is required');
    }
    if (idempotencyKey.length > 200) {
      throw new Error('idempotencyKey must not exceed 200 characters');
    }
    const maxAttempts = positiveInteger(input.maxAttempts ?? 3, 'maxAttempts');
    const timeoutMs = positiveInteger(
      input.timeoutMs ?? 15 * 60_000,
      'timeoutMs',
    );
    const runAfter = input.runAfter ?? now;
    asEpoch(now);
    asEpoch(runAfter);

    return mutateDb((db) => {
      const project = db.projects.find(
        (candidate) => candidate.id === input.projectId && !candidate.deletedAt,
      );
      if (!project) {
        throw new Error('Project not found');
      }

      const existing = db.workflowJobs.find(
        (candidate) =>
          candidate.projectId === input.projectId &&
          candidate.jobType === input.jobType &&
          candidate.idempotencyKey === idempotencyKey &&
          !candidate.deletedAt,
      );
      if (existing) {
        return { job: existing, created: false as const };
      }

      const job: WorkflowJobRecord = {
        id: id(),
        projectId: input.projectId,
        jobType: input.jobType,
        idempotencyKey,
        payload: cloneRecord(input.payload),
        status: 'queued',
        priority: Math.trunc(input.priority ?? 0),
        attemptCount: 0,
        maxAttempts,
        runAfter,
        timeoutMs,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        cancelRequestedAt: null,
        cancelReason: null,
        checkpoint: {},
        checkpointVersion: 0,
        result: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        resumeCount: 0,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      db.workflowJobs.push(job);
      appendJobEvent(
        db,
        job,
        {
          eventType: 'job_queued',
          userVisible: true,
          summary: `${job.jobType} 任务已进入后台队列`,
        },
        now,
      );
      return { job, created: true as const };
    });
  },

  async get(jobId: string) {
    const db = await readDb();
    return (
      db.workflowJobs.find((job) => job.id === jobId && !job.deletedAt) ?? null
    );
  },

  async findByIdempotencyKey(
    projectId: string,
    jobType: WorkflowType,
    idempotencyKey: string,
  ) {
    const db = await readDb();
    return (
      db.workflowJobs.find(
        (job) =>
          job.projectId === projectId &&
          job.jobType === jobType &&
          job.idempotencyKey === idempotencyKey &&
          !job.deletedAt,
      ) ?? null
    );
  },

  async listByProject(projectId: string) {
    const db = await readDb();
    return db.workflowJobs
      .filter((job) => job.projectId === projectId && !job.deletedAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async listAttempts(jobId: string) {
    const db = await readDb();
    return db.workflowJobAttempts
      .filter((attempt) => attempt.jobId === jobId && !attempt.deletedAt)
      .sort((left, right) => left.attemptNo - right.attemptNo);
  },

  async recoverExpiredLeases(now = timestamp()) {
    asEpoch(now);
    return mutateDb((db) => recoverExpiredLeases(db, now));
  },

  async leaseNext(options: LeaseWorkflowJobOptions) {
    const workerId = options.workerId.trim();
    if (!workerId) {
      throw new Error('workerId is required');
    }
    const leaseDurationMs = positiveInteger(
      options.leaseDurationMs,
      'leaseDurationMs',
    );
    const now = options.now ?? timestamp();
    const nowEpoch = asEpoch(now);
    const accepted = options.acceptedJobTypes
      ? new Set<WorkflowType>(options.acceptedJobTypes)
      : null;

    return mutateDb((db) => {
      recoverExpiredLeases(db, now);
      const eligible = db.workflowJobs
        .filter(
          (job) =>
            !job.deletedAt &&
            (job.status === 'queued' || job.status === 'retry_scheduled') &&
            !job.cancelRequestedAt &&
            asEpoch(job.runAfter) <= nowEpoch &&
            (accepted ? accepted.has(job.jobType) : true),
        )
        .sort(
          (left, right) =>
            right.priority - left.priority ||
            left.runAfter.localeCompare(right.runAfter) ||
            left.createdAt.localeCompare(right.createdAt),
        )[0];

      if (!eligible) {
        return null;
      }

      const leaseExpiresAt = isoAfter(now, leaseDurationMs);
      eligible.status = 'running';
      eligible.attemptCount += 1;
      eligible.leaseOwner = workerId;
      eligible.leaseExpiresAt = leaseExpiresAt;
      eligible.heartbeatAt = now;
      eligible.completedAt = null;
      touch(eligible, now);

      const attempt: WorkflowJobAttemptRecord = {
        id: id(),
        jobId: eligible.id,
        attemptNo: eligible.attemptCount,
        workerId,
        status: 'running',
        leaseStartedAt: now,
        leaseExpiresAt,
        heartbeatAt: now,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      db.workflowJobAttempts.push(attempt);
      appendJobEvent(
        db,
        eligible,
        {
          eventType: 'job_leased',
          summary: `${eligible.jobType} 任务已由 worker 领取`,
          details: { workerId, leaseExpiresAt },
        },
        now,
      );
      return eligible;
    });
  },

  async heartbeat(
    jobId: string,
    workerId: string,
    leaseDurationMs: number,
    now = timestamp(),
  ): Promise<JobMutationResult & { cancelRequested: boolean }> {
    positiveInteger(leaseDurationMs, 'leaseDurationMs');
    asEpoch(now);
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) => candidate.id === jobId && !candidate.deletedAt,
      );
      if (!job) {
        return {
          ...mutationResult(null, false, 'not_found'),
          cancelRequested: false,
        };
      }
      if (!ownsActiveLease(db, job, workerId, now)) {
        return {
          ...mutationResult(job, false, 'lease_lost'),
          cancelRequested: false,
        };
      }

      const leaseExpiresAt = isoAfter(now, leaseDurationMs);
      job.heartbeatAt = now;
      job.leaseExpiresAt = leaseExpiresAt;
      touch(job, now);
      const attempt = currentAttempt(db, job);
      if (attempt) {
        attempt.heartbeatAt = now;
        attempt.leaseExpiresAt = leaseExpiresAt;
        touch(attempt, now);
      }
      return {
        ...mutationResult(job, true),
        cancelRequested: Boolean(job.cancelRequestedAt),
      };
    });
  },

  async saveCheckpoint(
    jobId: string,
    workerId: string,
    checkpoint: Record<string, unknown>,
    now = timestamp(),
  ) {
    asEpoch(now);
    const persistedCheckpoint = cloneRecord(checkpoint);
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) => candidate.id === jobId && !candidate.deletedAt,
      );
      if (!job) {
        return mutationResult(null, false, 'not_found');
      }
      if (!ownsActiveLease(db, job, workerId, now)) {
        return mutationResult(job, false, 'lease_lost');
      }
      job.checkpoint = persistedCheckpoint;
      job.checkpointVersion += 1;
      touch(job, now);
      return mutationResult(job, true);
    });
  },

  async makeRunnable(jobId: string, now = timestamp()) {
    asEpoch(now);
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) => candidate.id === jobId && !candidate.deletedAt,
      );
      if (!job) {
        return mutationResult(null, false, 'not_found');
      }
      if (job.status !== 'queued' && job.status !== 'retry_scheduled') {
        return mutationResult(job, false, 'invalid_state');
      }
      job.runAfter = now;
      touch(job, now);
      return mutationResult(job, true);
    });
  },

  async complete(
    jobId: string,
    workerId: string,
    result: Record<string, unknown> = {},
    now = timestamp(),
  ) {
    asEpoch(now);
    const persistedResult = cloneRecord(result);
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) => candidate.id === jobId && !candidate.deletedAt,
      );
      if (!job) {
        return mutationResult(null, false, 'not_found');
      }
      if (!ownsActiveLease(db, job, workerId, now)) {
        return mutationResult(job, false, 'lease_lost');
      }
      if (job.cancelRequestedAt) {
        finishAttempt(
          db,
          job,
          'cancelled',
          now,
          'JOB_CANCELLED',
          job.cancelReason ?? 'Cancellation requested before completion',
        );
        job.status = 'cancelled';
        job.completedAt = now;
        clearLease(job);
        touch(job, now);
        appendJobEvent(
          db,
          job,
          {
            eventType: 'job_cancelled',
            userVisible: true,
            summary: `${job.jobType} 任务已取消`,
            details: { reason: job.cancelReason },
          },
          now,
        );
        return mutationResult(job, true);
      }

      finishAttempt(db, job, 'succeeded', now);
      job.status = 'succeeded';
      job.result = persistedResult;
      job.lastErrorCode = null;
      job.lastErrorMessage = null;
      job.completedAt = now;
      clearLease(job);
      touch(job, now);
      appendJobEvent(
        db,
        job,
        {
          eventType: 'job_succeeded',
          userVisible: true,
          summary: `${job.jobType} 后台任务已完成`,
          details: { result: persistedResult },
        },
        now,
      );
      return mutationResult(job, true);
    });
  },

  async fail(jobId: string, workerId: string, input: FailWorkflowJobInput) {
    const now = input.now ?? timestamp();
    asEpoch(now);
    const retryDelayMs = Math.max(0, Math.trunc(input.retryDelayMs ?? 0));
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) => candidate.id === jobId && !candidate.deletedAt,
      );
      if (!job) {
        return mutationResult(null, false, 'not_found');
      }
      if (!ownsActiveLease(db, job, workerId, now)) {
        return mutationResult(job, false, 'lease_lost');
      }

      if (job.cancelRequestedAt) {
        finishAttempt(
          db,
          job,
          'cancelled',
          now,
          'JOB_CANCELLED',
          job.cancelReason ?? input.errorMessage,
        );
        job.status = 'cancelled';
        job.completedAt = now;
        appendJobEvent(
          db,
          job,
          {
            eventType: 'job_cancelled',
            userVisible: true,
            summary: `${job.jobType} 任务已取消`,
            details: { reason: job.cancelReason },
          },
          now,
        );
      } else {
        finishAttempt(
          db,
          job,
          input.timedOut ? 'timed_out' : 'failed',
          now,
          input.errorCode,
          input.errorMessage,
        );
        job.lastErrorCode = input.errorCode;
        job.lastErrorMessage = input.errorMessage;
        if (input.retryable && job.attemptCount < job.maxAttempts) {
          job.status = 'retry_scheduled';
          job.runAfter = isoAfter(now, retryDelayMs);
          job.completedAt = null;
          appendJobEvent(
            db,
            job,
            {
              eventType: 'job_retry_scheduled',
              eventLevel: 'warn',
              summary: `${job.jobType} 任务暂未成功，已安排自动重试`,
              details: {
                errorCode: input.errorCode,
                errorMessage: input.errorMessage,
                runAfter: job.runAfter,
              },
            },
            now,
          );
        } else {
          job.status = 'failed';
          job.completedAt = now;
          appendJobEvent(
            db,
            job,
            {
              eventType: 'job_failed',
              eventLevel: 'error',
              userVisible: true,
              summary: `${job.jobType} 后台任务失败`,
              details: {
                errorCode: input.errorCode,
                errorMessage: input.errorMessage,
              },
            },
            now,
          );
        }
      }
      clearLease(job);
      touch(job, now);
      return mutationResult(job, true);
    });
  },

  async requestCancellation(jobId: string, reason?: string, now = timestamp()) {
    asEpoch(now);
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) => candidate.id === jobId && !candidate.deletedAt,
      );
      if (!job) {
        return mutationResult(null, false, 'not_found');
      }
      if (job.status === 'cancelled') {
        return mutationResult(job, true);
      }
      if (job.status === 'succeeded' || job.status === 'failed') {
        return mutationResult(job, false, 'invalid_state');
      }
      const newlyRequested = !job.cancelRequestedAt;
      if (newlyRequested) {
        job.cancelRequestedAt = now;
        job.cancelReason = reason?.trim() || null;
      }
      if (job.status === 'queued' || job.status === 'retry_scheduled') {
        job.status = 'cancelled';
        job.completedAt = now;
        clearLease(job);
        appendJobEvent(
          db,
          job,
          {
            eventType: 'job_cancelled',
            userVisible: true,
            summary: `${job.jobType} 排队任务已取消`,
            details: { reason: job.cancelReason },
          },
          now,
        );
      } else if (newlyRequested) {
        appendJobEvent(
          db,
          job,
          {
            eventType: 'job_cancel_requested',
            eventLevel: 'warn',
            summary: `${job.jobType} 任务已收到取消请求`,
            details: { reason: job.cancelReason },
          },
          now,
        );
      }
      touch(job, now);
      return mutationResult(job, true);
    });
  },

  async acknowledgeCancellation(
    jobId: string,
    workerId: string,
    now = timestamp(),
  ) {
    asEpoch(now);
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) => candidate.id === jobId && !candidate.deletedAt,
      );
      if (!job) {
        return mutationResult(null, false, 'not_found');
      }
      if (!ownsActiveLease(db, job, workerId, now)) {
        return mutationResult(job, false, 'lease_lost');
      }
      if (!job.cancelRequestedAt) {
        return mutationResult(job, false, 'not_cancel_requested');
      }

      finishAttempt(
        db,
        job,
        'cancelled',
        now,
        'JOB_CANCELLED',
        job.cancelReason ?? 'Cancellation requested',
      );
      job.status = 'cancelled';
      job.completedAt = now;
      clearLease(job);
      touch(job, now);
      appendJobEvent(
        db,
        job,
        {
          eventType: 'job_cancelled',
          userVisible: true,
          summary: `${job.jobType} 任务已取消`,
          details: { reason: job.cancelReason },
        },
        now,
      );
      return mutationResult(job, true);
    });
  },

  async resume(
    jobId: string,
    options: {
      additionalAttempts?: number;
      runAfter?: string;
      now?: string;
    } = {},
  ) {
    const now = options.now ?? timestamp();
    const additionalAttempts = positiveInteger(
      options.additionalAttempts ?? 1,
      'additionalAttempts',
    );
    const runAfter = options.runAfter ?? now;
    asEpoch(now);
    asEpoch(runAfter);
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) => candidate.id === jobId && !candidate.deletedAt,
      );
      if (!job) {
        return mutationResult(null, false, 'not_found');
      }
      if (job.status !== 'failed' && job.status !== 'cancelled') {
        return mutationResult(job, false, 'invalid_state');
      }

      job.status = 'queued';
      job.maxAttempts = job.attemptCount + additionalAttempts;
      job.runAfter = runAfter;
      job.resumeCount += 1;
      job.cancelRequestedAt = null;
      job.cancelReason = null;
      job.result = null;
      job.completedAt = null;
      clearLease(job);
      touch(job, now);
      appendJobEvent(
        db,
        job,
        {
          eventType: 'job_resumed',
          userVisible: true,
          summary: `${job.jobType} 任务已恢复并重新排队`,
          details: { runAfter, additionalAttempts },
        },
        now,
      );
      return mutationResult(job, true);
    });
  },
};
