import type { WorkflowType } from '../enums/status';
import type { AuditedRecord } from './project';

export const workflowJobStatuses = [
  'queued',
  'running',
  'retry_scheduled',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type WorkflowJobStatus = (typeof workflowJobStatuses)[number];

export const workflowJobAttemptStatuses = [
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'lease_expired',
] as const;

export type WorkflowJobAttemptStatus =
  (typeof workflowJobAttemptStatuses)[number];

/**
 * A durable command consumed by the standalone worker.
 *
 * `idempotencyKey` is unique within project + workflow type. Job state is mutable,
 * while every execution is represented by an append-only `WorkflowJobAttemptRecord`.
 */
export interface WorkflowJobRecord extends AuditedRecord {
  projectId: string;
  jobType: WorkflowType;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: WorkflowJobStatus;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  timeoutMs: number;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  heartbeatAt?: string | null;
  cancelRequestedAt?: string | null;
  cancelReason?: string | null;
  checkpoint: Record<string, unknown>;
  checkpointVersion: number;
  result?: Record<string, unknown> | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  resumeCount: number;
  completedAt?: string | null;
}

/** One immutable-in-identity execution record for a leased job. */
export interface WorkflowJobAttemptRecord extends AuditedRecord {
  jobId: string;
  attemptNo: number;
  workerId: string;
  status: WorkflowJobAttemptStatus;
  leaseStartedAt: string;
  leaseExpiresAt: string;
  heartbeatAt: string;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}
