import { notFound } from 'next/navigation';
import { RunStreamStatus } from '@/components/run-stream-status';
import { ScriptControls } from '@/components/script-controls';
import { StatusPill } from '@/components/status-pill';
import { WorkflowJobNotice } from '@/components/workflow-job-controls';
import {
  getProjectContext,
  getScriptWorkflowPageData,
} from '@/lib/server-data';
import { formatDate } from '@/lib/format';

function runtimeTone(state: string) {
  switch (state) {
    case 'ready':
      return 'active';
    case 'mock':
      return 'placeholder';
    default:
      return 'failed';
  }
}

function runtimeLabel(state: string) {
  switch (state) {
    case 'ready':
      return '已就绪';
    case 'mock':
      return '模拟模式';
    case 'unsupported':
      return '暂不支持';
    case 'misconfigured':
      return '需要配置';
    default:
      return state;
  }
}

function formatCredentialSource(source?: string | null) {
  switch (source) {
    case 'page':
      return '历史页面密钥（已停用）';
    case 'env':
      return '后端环境变量';
    default:
      return '未配置';
  }
}

const agentLabels: Record<string, { title: string; description: string }> = {
  agent2: { title: '调研依据', description: '事实、数据与内容风险' },
  agent3: { title: '故事结构', description: '叙事节奏与情绪路径' },
  agent4: { title: '最终脚本', description: '等待你确认的当前版本' },
};

export default async function ScriptWorkflowPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getProjectContext(projectId);
  const workflow = await getScriptWorkflowPageData(projectId);

  if (!context) {
    notFound();
  }

  const finalScriptTask = workflow.tasks.find(
    (task) => task.agentName === 'agent4' && task.status === 'approved',
  );
  const finalReviews = finalScriptTask
    ? (workflow.reviewMap[finalScriptTask.id] ?? [])
    : [];
  const supportingTasks = workflow.tasks.filter(
    (task) => task.id !== finalScriptTask?.id,
  );
  const isScriptConfirmed = workflow.scriptGate.confirmed;

  return (
    <>
      <section className="hero workflow-hero">
        <div className="workflow-heading-row">
          <div>
            <p className="hero-eyebrow">步骤 02 · 人工确认门</p>
            <h1 className="page-title">脚本与审核</h1>
            <p>
              先读最终脚本，需要时再展开调研、故事线和运行详情。确认后才会进入
              Shot 制作。
            </p>
          </div>
          {workflow.run ? (
            <StatusPill value={workflow.run.status} />
          ) : (
            <span className="pill">未开始</span>
          )}
        </div>
        <ScriptControls
          projectId={projectId}
          canConfirmScript={Boolean(finalScriptTask) && !isScriptConfirmed}
          isScriptConfirmed={isScriptConfirmed}
          activeTaskId={finalScriptTask?.id}
          hasHistoricalRun={Boolean(workflow.run)}
          canRunWorkflow={workflow.canRunWorkflow}
          runDisabledReason={workflow.runDisabledReason}
        />
      </section>

      {workflow.workflowJob ? (
        <WorkflowJobNotice
          projectId={projectId}
          job={workflow.workflowJob}
          title="脚本后台任务"
        />
      ) : null}

      <section className="script-review-layout">
        <article className="card script-document">
          <div className="section-heading">
            <div>
              <p className="hero-eyebrow">Current script</p>
              <h2 className="card-title">
                {isScriptConfirmed ? '当前生效脚本' : '当前待确认脚本'}
              </h2>
            </div>
            {finalScriptTask ? (
              <StatusPill value={finalScriptTask.status} />
            ) : (
              <span className="pill placeholder">尚未生成</span>
            )}
          </div>
          {finalScriptTask ? (
            <>
              <div className="document-meta">
                <span>第 {finalScriptTask.roundNo} 轮</span>
                <span>{formatDate(finalScriptTask.updatedAt)}</span>
                <span>
                  {finalScriptTask.providerName ?? 'unknown'} /{' '}
                  {finalScriptTask.modelName ?? 'unknown'}
                </span>
              </div>
              <pre className="script-copy">
                {finalScriptTask.outputMarkdown}
              </pre>
            </>
          ) : (
            <div className="empty-reading-state">
              <strong>脚本还没有准备好</strong>
              <p>完成创作设定并运行脚本链路后，最终脚本会显示在这里。</p>
            </div>
          )}
        </article>

        <aside className="card script-review-panel">
          <div>
            <p className="hero-eyebrow">Review gate</p>
            <h2 className="card-title">确认检查</h2>
          </div>
          <div className="review-check-list">
            <div>
              <span>内容审核</span>
              <strong>{finalReviews.length > 0 ? '已完成' : '等待审核'}</strong>
            </div>
            <div>
              <span>人工确认</span>
              <strong>
                {isScriptConfirmed
                  ? '已确认'
                  : workflow.run?.currentNode === 'script_user_confirm'
                    ? '等待你确认'
                    : '尚未到达'}
              </strong>
            </div>
          </div>
          {finalReviews.map((review) => (
            <div key={review.id} className="review-note">
              <StatusPill value={review.decision} />
              <p>{review.feedbackMarkdown}</p>
            </div>
          ))}
          <RunStreamStatus runId={workflow.run?.id} />
          <p className="subtle">
            确认会推进工作流，但不会删除当前脚本；之后重跑会创建新版本。
          </p>
        </aside>
      </section>

      <details className="card disclosure-card">
        <summary>
          <span>
            <strong>创作依据</strong>
            <small>查看调研与故事结构</small>
          </span>
          <span>{supportingTasks.length} 份内容</span>
        </summary>
        <div className="supporting-output-grid">
          {supportingTasks.map((task) => (
            <article key={task.id} className="supporting-output">
              <div className="toolbar">
                <div>
                  <h3>
                    {agentLabels[task.agentName]?.title ?? task.agentName}
                  </h3>
                  <p>{agentLabels[task.agentName]?.description}</p>
                </div>
                <StatusPill value={task.status} />
              </div>
              <pre>{task.outputMarkdown}</pre>
            </article>
          ))}
        </div>
      </details>

      <details className="card disclosure-card">
        <summary>
          <span>
            <strong>运行详情</strong>
            <small>模型、耗时、Token 与最近错误</small>
          </span>
          <span>{workflow.runtime.length} 个 Agent</span>
        </summary>
        <div className="runtime-grid">
          {workflow.runtime.map((item) => (
            <div key={item.agentName} className="runtime-card">
              <div className="toolbar">
                <div>
                  <h3>
                    {agentLabels[item.agentName]?.title ?? item.agentName}
                  </h3>
                  <p>
                    {item.providerLabel ?? item.provider} /{' '}
                    {item.modelName || '未填写模型'}
                  </p>
                </div>
                <span className={`pill ${runtimeTone(item.state)}`}>
                  {runtimeLabel(item.state)}
                </span>
              </div>
              <div className="runtime-metrics">
                <div>
                  <span>认证</span>
                  <strong>
                    {formatCredentialSource(item.credentialSource)}
                  </strong>
                </div>
                <div>
                  <span>任务</span>
                  <strong>{item.latestTaskStatus ?? '未运行'}</strong>
                </div>
                <div>
                  <span>Token</span>
                  <strong>{item.totalTokens}</strong>
                </div>
                <div>
                  <span>耗时</span>
                  <strong>
                    {typeof item.latencyMs === 'number'
                      ? `${(item.latencyMs / 1000).toFixed(1)}s`
                      : '—'}
                  </strong>
                </div>
              </div>
              <p className="subtle">{item.summary}</p>
              {item.lastErrorMessage ? (
                <div className="error-note">
                  最近错误：{item.lastErrorMessage}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </details>

      <details className="card disclosure-card">
        <summary>
          <span>
            <strong>本阶段事件</strong>
            <small>用于诊断与追踪，不影响脚本阅读</small>
          </span>
          <span>{workflow.events.length} 条</span>
        </summary>
        <div className="event-list compact-event-list">
          {workflow.events.map((event) => (
            <div key={event.id} className="list-row">
              <div className="toolbar">
                <strong>{event.eventType}</strong>
                <span className="subtle">{formatDate(event.createdAt)}</span>
              </div>
              <div className="subtle">{event.summary}</div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
