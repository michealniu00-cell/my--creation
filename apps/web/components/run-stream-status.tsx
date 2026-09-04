'use client';

import { useRunStream } from '../lib/use-run-stream';

const runStatusLabels: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  reviewing: '等待审核',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const taskStatusLabels: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  succeeded: '已完成',
  review_pending: '等待审核',
  revise_needed: '需要修改',
  approved: '已通过',
  failed: '失败',
  skipped: '已跳过',
};

function messageText(event: string, data: Record<string, unknown>) {
  if (event === 'run.updated') {
    const status = typeof data.status === 'string' ? runStatusLabels[data.status] ?? data.status : '未知';
    const node = typeof data.currentNode === 'string' ? data.currentNode : '未开始';
    return `运行${status} · 当前节点 ${node}`;
  }

  if (event === 'task.updated') {
    const agentName = typeof data.agentName === 'string' ? data.agentName : 'Agent';
    const status = typeof data.status === 'string' ? taskStatusLabels[data.status] ?? data.status : '已更新';
    return `${agentName} ${status}`;
  }

  if (event === 'user.alert' && typeof data.message === 'string') {
    return data.message;
  }

  return '运行状态已更新';
}

export function RunStreamStatus({ runId }: { runId?: string | null }) {
  const messages = useRunStream(runId);
  if (!runId) {
    return <p className="subtle">当前还没有运行记录。</p>;
  }

  return (
    <details className="run-live-disclosure">
      <summary>查看实时运行状态</summary>
      <div className="event-list" aria-live="polite">
        {messages.length === 0 ? (
          <p className="subtle">暂无新的运行事件。</p>
        ) : (
          messages.slice(0, 6).map((message, index) => (
            <div key={`${message.event}-${index}`} className="list-row">
              <div>{messageText(message.event, message.data)}</div>
            </div>
          ))
        )}
      </div>
    </details>
  );
}
