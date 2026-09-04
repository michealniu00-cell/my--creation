'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ApiResponse,
  ControlPlaneChangeType,
  ControlPlaneObjectType,
  ImpactAnalysisResult,
} from '@video-agent-studio/shared';

type ControlPlaneRequest = {
  url: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

type ConfirmationState = {
  analysis: ImpactAnalysisResult;
  conflictId: string | null;
  resolution: string;
};

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

async function requestApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.success) {
    throw new Error(
      payload.success
        ? `Request failed with status ${response.status}`
        : (payload.error.message ?? 'Request failed'),
    );
  }

  return {
    data: payload.data,
    meta: payload.meta,
  };
}

function impactPillClass(impactLevel: ImpactAnalysisResult['impactLevel']) {
  if (impactLevel === 'high') {
    return 'failed';
  }
  if (impactLevel === 'medium') {
    return 'reviewing';
  }
  return 'active';
}

function impactLabel(impactLevel: ImpactAnalysisResult['impactLevel']) {
  if (impactLevel === 'high') {
    return '高影响';
  }
  if (impactLevel === 'medium') {
    return '中影响';
  }
  return '低影响';
}

function objectTypeLabel(objectType: string) {
  if (objectType === 'shot') {
    return 'Shot';
  }
  if (objectType === 'storyboard') {
    return '分镜图';
  }
  if (objectType === 'video') {
    return '视频';
  }
  if (objectType === 'key_element') {
    return '关键要素';
  }
  return objectType;
}

export function ControlPlaneActionButton({
  projectId,
  analysisTarget,
  request,
  actionLabel,
  children,
  className = 'button small',
  pendingLabel = '处理中...',
  confirmTitle,
  confirmDescription,
  disabled = false,
  refreshOnSuccess = true,
  onSuccess,
  stateKey,
}: {
  projectId: string;
  analysisTarget: {
    objectType: ControlPlaneObjectType;
    objectId: string;
    changeType: ControlPlaneChangeType;
  };
  request: ControlPlaneRequest;
  actionLabel: string;
  children: ReactNode;
  className?: string;
  pendingLabel?: string;
  confirmTitle?: string;
  confirmDescription?: string;
  disabled?: boolean;
  refreshOnSuccess?: boolean;
  onSuccess?: () => void;
  stateKey?: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const resolutionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(
    null,
  );
  const confirmationOpen = confirmation !== null;

  useEffect(() => {
    setPending(false);
    setError(null);
    setConfirmation(null);
  }, [
    stateKey,
    analysisTarget.objectId,
    analysisTarget.changeType,
    request.url,
  ]);

  useEffect(() => {
    if (!confirmationOpen) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelButtonRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [confirmationOpen]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !pending) {
      event.preventDefault();
      setConfirmation(null);
      setError(null);
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function performRequest(
    conflictId?: string | null,
    resolution?: string,
  ) {
    setPending(true);
    setError(null);

    try {
      if (conflictId && resolution) {
        await requestApi<{ resolved: boolean }>(
          `/api/projects/${projectId}/conflicts/${conflictId}/resolve`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution }),
          },
        );
      }

      await requestApi<Record<string, unknown>>(request.url, {
        method: request.method ?? 'POST',
        headers:
          request.body !== undefined
            ? { 'content-type': 'application/json' }
            : undefined,
        body:
          request.body !== undefined ? JSON.stringify(request.body) : undefined,
      });

      setConfirmation(null);
      setError(null);
      onSuccess?.();
      if (refreshOnSuccess) {
        router.refresh();
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '操作失败，请稍后重试',
      );
      return;
    } finally {
      setPending(false);
    }
  }

  async function handleClick() {
    if (pending || disabled) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const result = await requestApi<ImpactAnalysisResult>(
        `/api/projects/${projectId}/impact-analysis`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(analysisTarget),
        },
      );

      const conflictId =
        typeof result.meta?.conflictId === 'string'
          ? result.meta.conflictId
          : null;

      if (result.data.requiresUserConfirmation || conflictId) {
        setError(null);
        setConfirmation({
          analysis: result.data,
          conflictId,
          resolution: `${actionLabel} 已由用户确认继续执行，接受 ${impactLabel(result.data.impactLevel)}。`,
        });
        return;
      }

      await performRequest();
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : '影响分析失败，请稍后重试',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        className={className}
        type="button"
        disabled={disabled || pending}
        onClick={() => void handleClick()}
      >
        {pending ? pendingLabel : children}
      </button>

      {error && !confirmation ? (
        <div
          className="control-action-error"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </div>
      ) : null}

      {confirmation ? (
        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) {
              setConfirmation(null);
              setError(null);
            }
          }}
        >
          <div
            ref={dialogRef}
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
          >
            <div className="toolbar">
              <div>
                <strong id={titleId}>{confirmTitle ?? '操作影响确认'}</strong>
                <div id={descriptionId} className="subtle">
                  {confirmDescription ??
                    '系统检测到该操作会影响当前工作流中的其他对象，请确认后继续。'}
                </div>
              </div>
              <span
                className={`pill ${impactPillClass(confirmation.analysis.impactLevel)}`}
              >
                {impactLabel(confirmation.analysis.impactLevel)}
              </span>
            </div>

            <div className="impact-summary">
              <div className="list-row">
                受影响对象 {confirmation.analysis.affectedObjects.length} 个
              </div>
              <div className="list-row">
                {confirmation.analysis.requiresUserConfirmation
                  ? '需要用户确认后继续'
                  : '可直接继续执行'}
              </div>
            </div>

            {confirmation.analysis.warnings.length > 0 ? (
              <div className="impact-list">
                {confirmation.analysis.warnings.map((warning) => (
                  <div key={warning} className="list-row version-error">
                    {warning}
                  </div>
                ))}
              </div>
            ) : (
              <div className="list-row subtle">
                当前未发现额外警告，但这次改动仍会触及多个对象。
              </div>
            )}

            <div className="impact-object-list">
              {confirmation.analysis.affectedObjects.map((item) => (
                <div
                  key={`${item.type}:${item.id}`}
                  className="impact-object-chip"
                >
                  <span className="pill active">
                    {objectTypeLabel(item.type)}
                  </span>
                  <span className="subtle">{item.id.slice(0, 8)}…</span>
                </div>
              ))}
            </div>

            <div className="field">
              <label htmlFor={resolutionId}>确认说明</label>
              <textarea
                id={resolutionId}
                value={confirmation.resolution}
                onChange={(event) =>
                  setConfirmation((current) =>
                    current
                      ? {
                          ...current,
                          resolution: event.target.value,
                        }
                      : current,
                  )
                }
              />
            </div>

            {error ? (
              <div
                className="list-row version-error"
                role="alert"
                aria-live="assertive"
              >
                {error}
              </div>
            ) : null}

            <div className="inline-actions">
              <button
                ref={cancelButtonRef}
                className="button secondary small"
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirmation(null);
                  setError(null);
                }}
              >
                取消
              </button>
              <button
                className="button small"
                type="button"
                disabled={
                  pending || confirmation.resolution.trim().length === 0
                }
                onClick={() =>
                  void performRequest(
                    confirmation.conflictId,
                    confirmation.resolution.trim(),
                  )
                }
              >
                {pending ? pendingLabel : '确认并继续'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
