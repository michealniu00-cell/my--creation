import { createHash } from 'node:crypto';
import type { RemoteVideoTaskControl } from '@video-agent-studio/providers';

/** Durable execution controls shared by full-workflow entry points. */
export interface WorkflowExecutionControl {
  /** Stable durable job identity used to bind retries to one workflow run. */
  jobId?: string;
  /** Explicit user resume may reopen a settled run while retaining its identity. */
  resumeExistingRun?: boolean;
  /** Monotonic explicit-resume generation used to retry only failed work. */
  resumeCount?: number;
  /** Stable root key used to derive provider request identities. */
  idempotencyKey?: string;
  /** Lease-loss, cancellation, and timeout signal from the durable runner. */
  signal?: AbortSignal;
  /** Persists the stable run identity before expensive workflow side effects. */
  onRunReady?: (runId: string) => Promise<void> | void;
  remoteVideoTaskControl?: (scope: string) => RemoteVideoTaskControl;
}

export function remoteVideoTaskScope(
  shotId: string,
  request: Record<string, unknown>,
) {
  return `${shotId}:${createHash('sha256').update(JSON.stringify(request)).digest('hex')}`;
}

export function scopedIdempotencyKey(
  rootKey: string | undefined,
  ...segments: Array<string | number>
) {
  if (!rootKey) {
    return undefined;
  }

  return [rootKey, ...segments]
    .map((segment) => String(segment).trim().replace(/\s+/g, '-'))
    .join(':');
}

export function throwIfWorkflowAborted(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
