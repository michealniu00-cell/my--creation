'use client';

import { useEffect, useState } from 'react';
import type {
  AgentTaskRecord,
  FailureSummaryDoc,
  ReviewRecord,
  TaskEventRecord,
  WorkflowRunRecord,
} from '@video-agent-studio/shared';
import { StatusPill } from './status-pill';
import { formatDate } from '@/lib/format';

type LogsViewMode = 'runs' | 'events' | 'tasks';

function stringifyBlock(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function LogsWorkbench({
  runs,
  tasks,
  events,
  reviewMap,
  failureSummary,
}: {
  runs: WorkflowRunRecord[];
  tasks: AgentTaskRecord[];
  events: TaskEventRecord[];
  reviewMap: Record<string, ReviewRecord[]>;
  failureSummary?: FailureSummaryDoc | null;
}) {
  const [viewMode, setViewMode] = useState<LogsViewMode>(runs.length > 0 ? 'runs' : events.length > 0 ? 'events' : 'tasks');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(events[0]?.id ?? null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(tasks[0]?.id ?? null);

  useEffect(() => {
    if (viewMode === 'runs' && !selectedRunId && runs[0]) {
      setSelectedRunId(runs[0].id);
    }
    if (viewMode === 'events' && !selectedEventId && events[0]) {
      setSelectedEventId(events[0].id);
    }
    if (viewMode === 'tasks' && !selectedTaskId && tasks[0]) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [events, runs, selectedEventId, selectedRunId, selectedTaskId, tasks, viewMode]);

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedTaskReviews = selectedTask ? reviewMap[selectedTask.id] ?? [] : [];

  const userVisibleEvents = events.filter((event) => event.userVisible);
  const warningCount = events.filter((event) => event.eventLevel === 'warn' || event.eventLevel === 'error').length;
  const failedTaskCount = tasks.filter(
    (task) => task.status === 'failed' || task.status === 'revise_needed',
  ).length;

  return (
    <div className="grid">
      <section className="stats">
        <div className="stat">
          <span className="subtle">运行批次</span>
          <strong>{runs.length}</strong>
        </div>
        <div className="stat">
          <span className="subtle">用户可见日志</span>
          <strong>{userVisibleEvents.length}</strong>
        </div>
        <div className="stat">
          <span className="subtle">风险事件</span>
          <strong>{warningCount}</strong>
        </div>
        <div className="stat">
          <span className="subtle">失败任务</span>
          <strong>{failedTaskCount}</strong>
        </div>
      </section>

      <section className="logs-workbench">
        <div className="card">
          <div className="toolbar">
            <h2 className="card-title">日志工作台</h2>
            <div className="segmented-controls">
              <button
                type="button"
                className={`segment-button ${viewMode === 'runs' ? 'active' : ''}`}
                onClick={() => setViewMode('runs')}
              >
                Run
              </button>
              <button
                type="button"
                className={`segment-button ${viewMode === 'events' ? 'active' : ''}`}
                onClick={() => setViewMode('events')}
              >
                Event
              </button>
              <button
                type="button"
                className={`segment-button ${viewMode === 'tasks' ? 'active' : ''}`}
                onClick={() => setViewMode('tasks')}
              >
                Task
              </button>
            </div>
          </div>

          <div className="event-list">
            {viewMode === 'runs'
              ? runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className={`list-row selectable-row ${selectedRunId === run.id ? 'selected' : ''}`}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div className="toolbar">
                      <strong>{run.workflowType}</strong>
                      <StatusPill value={run.status} />
                    </div>
                    <div className="subtle">
                      {run.currentNode ?? 'N/A'} · {formatDate(run.updatedAt)}
                    </div>
                  </button>
                ))
              : null}

            {viewMode === 'events'
              ? events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`list-row selectable-row ${selectedEventId === event.id ? 'selected' : ''}`}
                    onClick={() => setSelectedEventId(event.id)}
                  >
                    <div className="toolbar">
                      <strong>{event.summary ?? event.eventType}</strong>
                      <StatusPill value={event.eventLevel} />
                    </div>
                    <div className="subtle">
                      {event.eventType} · {formatDate(event.createdAt)}
                    </div>
                  </button>
                ))
              : null}

            {viewMode === 'tasks'
              ? tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`list-row selectable-row ${selectedTaskId === task.id ? 'selected' : ''}`}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <div className="toolbar">
                      <strong>{task.agentName}</strong>
                      <StatusPill value={task.status} />
                    </div>
                    <div className="subtle">
                      {task.stageName} · tokens {task.totalTokens ?? 0}
                    </div>
                    <div className="subtle">{task.outputSummary ?? '暂无输出摘要'}</div>
                  </button>
                ))
              : null}

            {(viewMode === 'runs' && runs.length === 0) ||
            (viewMode === 'events' && events.length === 0) ||
            (viewMode === 'tasks' && tasks.length === 0) ? (
              <p className="subtle">当前维度还没有可查看的数据。</p>
            ) : null}
          </div>
        </div>

        <div className="card detail-panel">
          {viewMode === 'runs' && selectedRun ? (
            <>
              <div className="toolbar">
                <div>
                  <p className="muted">Run Detail</p>
                  <h2 className="card-title">{selectedRun.workflowType} 工作流</h2>
                </div>
                <StatusPill value={selectedRun.status} />
              </div>
              <div className="detail-grid">
                <div className="list-row">
                  <strong>当前节点</strong>
                  <div className="subtle">{selectedRun.currentNode ?? 'N/A'}</div>
                </div>
                <div className="list-row">
                  <strong>手动审核</strong>
                  <div className="subtle">{selectedRun.requiresManualReview ? '需要' : '无需'}</div>
                </div>
                <div className="list-row">
                  <strong>重试次数</strong>
                  <div className="subtle">{selectedRun.retryCount}</div>
                </div>
                <div className="list-row">
                  <strong>更新时间</strong>
                  <div className="subtle">{formatDate(selectedRun.updatedAt)}</div>
                </div>
              </div>
              <div className="list-row">
                <strong>运行原因</strong>
                <div className="subtle">{selectedRun.runReason ?? 'N/A'}</div>
              </div>
              {selectedRun.errorMessage ? (
                <div className="list-row version-error">
                  <strong>错误信息</strong>
                  <div>{selectedRun.errorMessage}</div>
                </div>
              ) : null}
              <div className="timeline">
                <h3 className="card-title">关联任务</h3>
                {tasks.filter((task) => task.runId === selectedRun.id).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="list-row selectable-row"
                    onClick={() => {
                      setViewMode('tasks');
                      setSelectedTaskId(task.id);
                    }}
                  >
                    <div className="toolbar">
                      <strong>{task.agentName}</strong>
                      <StatusPill value={task.status} />
                    </div>
                    <div className="subtle">
                      {task.stageName} · {formatDate(task.updatedAt)}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {viewMode === 'events' && selectedEvent ? (
            <>
              <div className="toolbar">
                <div>
                  <p className="muted">Event Detail</p>
                  <h2 className="card-title">{selectedEvent.summary ?? selectedEvent.eventType}</h2>
                </div>
                <StatusPill value={selectedEvent.eventLevel} />
              </div>
              <div className="detail-grid">
                <div className="list-row">
                  <strong>事件类型</strong>
                  <div className="subtle">{selectedEvent.eventType}</div>
                </div>
                <div className="list-row">
                  <strong>可见范围</strong>
                  <div className="subtle">{selectedEvent.userVisible ? '用户可见' : '开发者态'}</div>
                </div>
                <div className="list-row">
                  <strong>Run</strong>
                  <div className="subtle">{selectedEvent.runId ?? 'N/A'}</div>
                </div>
                <div className="list-row">
                  <strong>Task</strong>
                  <div className="subtle">{selectedEvent.taskId ?? 'N/A'}</div>
                </div>
              </div>
              <div className="json-block">
                <strong>事件载荷</strong>
                <pre>{stringifyBlock(selectedEvent.eventPayload)}</pre>
              </div>
            </>
          ) : null}

          {viewMode === 'tasks' && selectedTask ? (
            <>
              <div className="toolbar">
                <div>
                  <p className="muted">Task Detail</p>
                  <h2 className="card-title">{selectedTask.agentName}</h2>
                </div>
                <StatusPill value={selectedTask.status} />
              </div>
              <div className="detail-grid">
                <div className="list-row">
                  <strong>阶段</strong>
                  <div className="subtle">{selectedTask.stageName}</div>
                </div>
                <div className="list-row">
                  <strong>Prompt 版本</strong>
                  <div className="subtle">{selectedTask.promptVersion ?? 'N/A'}</div>
                </div>
                <div className="list-row">
                  <strong>延迟</strong>
                  <div className="subtle">{selectedTask.latencyMs ?? 0}ms</div>
                </div>
                <div className="list-row">
                  <strong>Token</strong>
                  <div className="subtle">{selectedTask.totalTokens ?? 0}</div>
                </div>
              </div>
              {selectedTask.outputSummary ? (
                <div className="list-row">
                  <strong>输出摘要</strong>
                  <div className="subtle">{selectedTask.outputSummary}</div>
                </div>
              ) : null}
              {selectedTask.errorMessage ? (
                <div className="list-row version-error">
                  <strong>错误信息</strong>
                  <div>{selectedTask.errorMessage}</div>
                </div>
              ) : null}
              {selectedTask.outputMarkdown ? (
                <div className="json-block">
                  <strong>输出 Markdown</strong>
                  <pre>{selectedTask.outputMarkdown}</pre>
                </div>
              ) : null}
              <div className="detail-grid">
                <div className="json-block">
                  <strong>输入载荷</strong>
                  <pre>{stringifyBlock(selectedTask.inputPayload)}</pre>
                </div>
                <div className="json-block">
                  <strong>输出 JSON</strong>
                  <pre>{stringifyBlock(selectedTask.outputJson)}</pre>
                </div>
              </div>
              <div className="timeline">
                <h3 className="card-title">审核记录</h3>
                {selectedTaskReviews.length === 0 ? (
                  <p className="subtle">当前任务还没有审核记录。</p>
                ) : (
                  selectedTaskReviews.map((review) => (
                    <div key={review.id} className="list-row">
                      <div className="toolbar">
                        <strong>{review.reviewerName}</strong>
                        <StatusPill value={review.decision} />
                      </div>
                      <div className="subtle">
                        round {review.reviewRound} · {formatDate(review.createdAt)}
                      </div>
                      <div className="subtle">{review.feedbackMarkdown ?? review.revisionBrief ?? '无额外反馈'}</div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : null}

          {!selectedRun && !selectedEvent && !selectedTask ? (
            <p className="subtle">当前还没有可钻取的运行数据。</p>
          ) : null}
        </div>
      </section>

      {failureSummary ? (
        <section className="card">
          <div className="toolbar">
            <h2 className="card-title">最新失败总结</h2>
            <span className="subtle">v{failureSummary.versionNo}</span>
          </div>
          <pre className="plain-pre">{failureSummary.summaryMarkdown}</pre>
        </section>
      ) : null}
    </div>
  );
}
