'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type JobStatus =
  | 'queued'
  | 'running'
  | 'retry_scheduled'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

type JobSnapshot = {
  jobId: string;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  cancelRequestedAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

const activeStatuses = new Set<JobStatus>([
  'queued',
  'running',
  'retry_scheduled',
]);

const statusCopy: Record<JobStatus, { label: string; tone: string }> = {
  queued: { label: '等待执行', tone: 'pending' },
  running: { label: '正在执行', tone: 'pending' },
  retry_scheduled: { label: '等待重试', tone: 'reviewing' },
  succeeded: { label: '已完成', tone: 'active' },
  failed: { label: '执行失败', tone: 'failed' },
  cancelled: { label: '已取消', tone: 'placeholder' },
};

function asJobStatus(value: string): JobStatus {
  return value in statusCopy ? (value as JobStatus) : 'queued';
}

async function requestJob(
  projectId: string,
  jobId: string,
  init?: RequestInit,
): Promise<JobSnapshot> {
  const response = await fetch(
    `/api/projects/${projectId}/jobs/${jobId}`,
    init,
  );
  const payload = (await response.json()) as {
    success: boolean;
    data?: JobSnapshot;
    error?: { message?: string };
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message ?? '无法读取后台任务状态');
  }
  return payload.data;
}

async function mutateJob(
  projectId: string,
  jobId: string,
  action: 'cancel' | 'resume',
) {
  const response = await fetch(
    `/api/projects/${projectId}/jobs/${jobId}/${action}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        action === 'cancel'
          ? { reason: '用户从 Shot 制作台取消任务' }
          : { additionalAttempts: 1 },
      ),
    },
  );
  const payload = (await response.json()) as {
    success: boolean;
    data?: Partial<JobSnapshot>;
    error?: { message?: string };
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(
      payload.error?.message ??
        `${action === 'cancel' ? '取消' : '恢复'}任务失败`,
    );
  }
  return payload.data;
}

export function WorkflowJobControls({
  projectId,
  jobId,
  initialArtifactStatus,
}: {
  projectId: string;
  jobId: string;
  initialArtifactStatus: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<
    'cancel' | 'resume' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const refreshedTerminalStatus = useRef<JobStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await requestJob(projectId, jobId);
      setJob(next);
      setError(null);
      if (
        !activeStatuses.has(next.status) &&
        refreshedTerminalStatus.current !== next.status
      ) {
        refreshedTerminalStatus.current = next.status;
        router.refresh();
      }
      return next;
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : '无法读取后台任务状态',
      );
      return null;
    }
  }, [jobId, projectId, router]);

  useEffect(() => {
    let disposed = false;

    const poll = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      await load();
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    const onVisibilityChange = () => void poll();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load]);

  async function runAction(action: 'cancel' | 'resume') {
    setPendingAction(action);
    setError(null);
    try {
      const result = await mutateJob(projectId, jobId, action);
      setJob((current) =>
        current
          ? {
              ...current,
              ...result,
            }
          : current,
      );
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : '任务操作失败',
      );
    } finally {
      setPendingAction(null);
    }
  }

  const effectiveStatus = job?.status ?? asJobStatus(initialArtifactStatus);
  const canCancel =
    activeStatuses.has(effectiveStatus) && !job?.cancelRequestedAt;
  const canResume =
    effectiveStatus === 'failed' || effectiveStatus === 'cancelled';

  return (
    <div className="job-controls" aria-busy={pendingAction !== null}>
      <div className="job-control-summary">
        <span className="subtle">
          后台任务 {jobId.slice(0, 8)}…
          {job ? ` · 尝试 ${job.attemptCount}/${job.maxAttempts}` : ''}
        </span>
        <span className={`pill ${statusCopy[effectiveStatus].tone}`}>
          {statusCopy[effectiveStatus].label}
        </span>
        {job?.cancelRequestedAt ? (
          <span className="subtle">正在停止…</span>
        ) : null}
      </div>
      {canCancel ? (
        <button
          className="button ghost small"
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void runAction('cancel')}
        >
          {pendingAction === 'cancel' ? '正在取消…' : '取消任务'}
        </button>
      ) : null}
      {canResume ? (
        <button
          className="button secondary small"
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void runAction('resume')}
        >
          {pendingAction === 'resume' ? '正在恢复…' : '恢复任务'}
        </button>
      ) : null}
      {error ? (
        <p className="control-action-error" role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}
      {job?.lastErrorMessage && canResume ? (
        <details className="technical-error">
          <summary>查看任务失败原因</summary>
          <div>{job.lastErrorMessage}</div>
        </details>
      ) : null}
    </div>
  );
}

export function WorkflowJobNotice({
  projectId,
  job,
  title,
}: {
  projectId: string;
  job: {
    id: string;
    status: string;
    jobType: string;
    attemptCount: number;
    maxAttempts: number;
    lastErrorMessage?: string | null;
  };
  title: string;
}) {
  const status = asJobStatus(job.status);
  const message = activeStatuses.has(status)
    ? '任务在独立 Worker 中运行，离开此页不会中断。'
    : status === 'failed'
      ? '当前产物保持不变。修复原因后可从最近断点恢复。'
      : '任务已取消，已完成的历史版本不会被删除。';

  return (
    <section
      className="workspace-notice workflow-job-notice"
      role="status"
      aria-live="polite"
    >
      <div>
        <strong>{title}</strong>
        <p className="subtle">{message}</p>
      </div>
      <WorkflowJobControls
        projectId={projectId}
        jobId={job.id}
        initialArtifactStatus={status}
      />
    </section>
  );
}
