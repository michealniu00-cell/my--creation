'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useState } from 'react';
import { ConfirmationDialog } from './confirmation-dialog';

type WorkflowKey = 'script' | 'storyboard' | 'video';

const workflowRouteMap: Record<WorkflowKey, string> = {
  script: 'script',
  storyboard: 'storyboard',
  video: 'video',
};

const workflowPageMap: Record<WorkflowKey, string> = {
  script: 'script',
  storyboard: 'timeline',
  video: 'timeline',
};

const workflowLabelMap: Record<WorkflowKey, string> = {
  script: '重新生成脚本阶段',
  storyboard: '重新生成分镜阶段',
  video: '补齐缺失视频',
};

const regenerationCopy: Record<Exclude<WorkflowKey, 'video'>, {
  title: string;
  description: string;
  details: string[];
}> = {
  script: {
    title: '重新生成整个脚本阶段？',
    description: '这会创建一条新的脚本工作流，重新执行调研、故事线与最终脚本。',
    details: [
      '现有脚本与历史版本会保留。',
      '新脚本仍需再次人工确认，确认前不会推进后续阶段。',
      '不会自动重新生成分镜或视频。',
    ],
  },
  storyboard: {
    title: '重新生成整个分镜阶段？',
    description: '这会为全部可写 Shot 创建新的分镜阶段输出。',
    details: [
      '现有版本会保留，锁定对象不会被自动覆盖。',
      '发现锁冲突时会停下并等待你的决定。',
      '如只需调整一处，请回到 Shot 制作台进行局部重生成。',
    ],
  },
};

export function ProjectQuickActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<WorkflowKey | null>(null);
  const [confirming, setConfirming] = useState<Exclude<WorkflowKey, 'video'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runWorkflow(workflow: WorkflowKey) {
    setLoading(workflow);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/workflows/${workflowRouteMap[workflow]}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          workflow === 'video'
            ? { mode: 'missing_only' }
            : { confirmStageRegeneration: true },
        ),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || !payload.success) {
        setError(payload.error?.message ?? '触发工作流失败，请稍后重试。');
        return;
      }

      startTransition(() => {
        router.push(`/projects/${projectId}/${workflowPageMap[workflow]}`);
        router.refresh();
      });
    } catch {
      setError('触发工作流失败，请检查当前本地环境。');
    } finally {
      setLoading(null);
    }
  }

  function requestWorkflow(workflow: WorkflowKey) {
    if (workflow === 'video') {
      void runWorkflow(workflow);
      return;
    }
    setError(null);
    setConfirming(workflow);
  }

  return (
    <div className="quick-actions">
      <div>
        <strong>阶段操作</strong>
        <p className="subtle">重跑会创建新版本，不会覆盖历史内容。视频默认只补齐空缺 Shot。</p>
      </div>
      <div className="actions">
        {(['script', 'storyboard', 'video'] as WorkflowKey[]).map((workflow) => (
          <button
            key={workflow}
            className="button secondary small"
            type="button"
            disabled={loading !== null}
            aria-haspopup={workflow === 'video' ? undefined : 'dialog'}
            onClick={() => requestWorkflow(workflow)}
          >
            {loading === workflow ? '正在启动...' : workflowLabelMap[workflow]}
          </button>
        ))}
      </div>
      {error ? <p className="control-action-error" role="alert" aria-live="polite">{error}</p> : null}
      <ConfirmationDialog
        open={confirming !== null}
        title={confirming ? regenerationCopy[confirming].title : ''}
        description={confirming ? regenerationCopy[confirming].description : ''}
        details={confirming ? regenerationCopy[confirming].details : []}
        confirmLabel="确认创建全阶段新版本"
        pending={loading !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return;
          const workflow = confirming;
          setConfirming(null);
          void runWorkflow(workflow);
        }}
      />
    </div>
  );
}
