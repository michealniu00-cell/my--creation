'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmationDialog } from './confirmation-dialog';

export function ScriptControls({
  projectId,
  canConfirmScript,
  isScriptConfirmed,
  activeTaskId,
  hasHistoricalRun,
  canRunWorkflow,
  runDisabledReason,
}: {
  projectId: string;
  canConfirmScript: boolean;
  isScriptConfirmed: boolean;
  activeTaskId?: string;
  hasHistoricalRun: boolean;
  canRunWorkflow: boolean;
  runDisabledReason?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<'run' | 'confirm' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmingRerun, setConfirmingRerun] = useState(false);

  async function startWorkflow() {
    setErrorMessage(null);
    if (!canRunWorkflow) {
      setErrorMessage(runDisabledReason ?? '脚本工作流当前还不能启动，请先完成真实 provider 配置。');
      return;
    }

    setLoading('run');
    try {
      const response = await fetch(`/api/projects/${projectId}/workflows/script/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startFromNode: 'agent2',
          ...(hasHistoricalRun ? { confirmStageRegeneration: true } : {}),
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || payload.success === false) {
        setErrorMessage(payload.error?.message ?? '脚本工作流启动失败。');
        return;
      }

      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '脚本工作流启动失败。');
    } finally {
      setLoading(null);
    }
  }

  async function confirmScript() {
    if (!activeTaskId) {
      return;
    }
    setErrorMessage(null);
    setLoading('confirm');
    try {
      const response = await fetch(`/api/projects/${projectId}/script/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: activeTaskId }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || payload.success === false) {
        setErrorMessage(payload.error?.message ?? '脚本确认失败，请稍后重试。');
        return;
      }

      router.push(`/projects/${projectId}/timeline`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '脚本确认失败，请稍后重试。');
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <div className="actions">
        <button
          className="button secondary"
          type="button"
          aria-haspopup={hasHistoricalRun ? 'dialog' : undefined}
          onClick={() => {
            if (hasHistoricalRun) {
              setErrorMessage(null);
              setConfirmingRerun(true);
            } else {
              void startWorkflow();
            }
          }}
          disabled={loading !== null || !canRunWorkflow}
          title={!canRunWorkflow ? runDisabledReason ?? '请先配置真实 provider' : undefined}
        >
          {loading === 'run'
            ? '正在创建新版本...'
            : hasHistoricalRun
              ? '重新生成脚本'
              : '开始生成脚本'}
        </button>
        <button className="button" type="button" onClick={confirmScript} disabled={!canConfirmScript || loading !== null}>
          {loading === 'confirm'
            ? '正在确认...'
            : isScriptConfirmed
              ? '脚本已确认'
              : '确认脚本并开始 Shot 制作'}
        </button>
      </div>
      {!canRunWorkflow && runDisabledReason ? <p className="control-action-error" role="status">{runDisabledReason}</p> : null}
      {errorMessage ? <p className="control-action-error" role="alert" aria-live="polite">{errorMessage}</p> : null}
      <ConfirmationDialog
        open={confirmingRerun}
        title="重新生成整个脚本阶段？"
        description="这会重新执行调研、故事线与最终脚本，并创建新的可追溯输出。"
        details={[
          '当前脚本与历史版本不会被删除。',
          '新脚本仍需你再次确认，确认前不会进入 Shot 制作。',
          '分镜与视频不会自动重新生成。',
        ]}
        confirmLabel="确认创建脚本新版本"
        pending={loading === 'run'}
        onCancel={() => setConfirmingRerun(false)}
        onConfirm={() => {
          setConfirmingRerun(false);
          void startWorkflow();
        }}
      />
    </>
  );
}
