import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectContext } from '@/lib/server-data';
import { StatusPill } from '@/components/status-pill';
import { deriveProjectJourney, type JourneyStageKey } from '@/lib/project-journey';

const snapshotLabels: Record<string, string> = {
  research: '调研结论',
  storyline: '故事线',
  script: '已确认脚本',
  shots: 'Shot 拆分',
  storyboard_spec: '分镜规格',
};

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getProjectContext(projectId);
  if (!context || !context.overview) {
    notFound();
  }

  const { project, overview, runs } = context;
  const journey = deriveProjectJourney({
    project,
    configConfirmed: Boolean(context.config?.confirmedByUser),
    scriptConfirmed: context.manualGates.scriptConfirmed,
    scriptEvidenceInconsistent: context.manualGates.scriptEvidenceInconsistent,
    stats: overview.stats,
    runs,
  });
  const stageCards: Array<{ step: string; stageKey: JourneyStageKey; label: string; href: string; description: string }> = [
    { step: '01', stageKey: 'setup', label: '创作设定', href: `/projects/${projectId}/agent1`, description: '把灵感整理为可执行的创作标准' },
    { step: '02', stageKey: 'script', label: '脚本与审核', href: `/projects/${projectId}/script`, description: '阅读调研、故事线与最终脚本并人工确认' },
    { step: '03', stageKey: 'production', label: 'Shot 制作', href: `/projects/${projectId}/timeline`, description: '在同一工作台完成分镜图与视频片段' },
  ];

  const nextAction = (() => {
    switch (journey.recommendedAction) {
      case 'confirm_config':
        return {
          eyebrow: '从这里开始',
          title: '先确认创作目标与限制',
          description: '把平台、受众、风格和禁止项对齐后，再启动脚本工作流。',
          href: `/projects/${projectId}/agent1`,
          label: '完善创作设定',
        };
      case 'start_script':
        return {
          eyebrow: '创作设定已就绪',
          title: '启动脚本工作流',
          description: 'Agent 会依次完成调研、故事线、脚本与自动审核，最终脚本仍需你确认。',
          href: `/projects/${projectId}/script`,
          label: '开始制作脚本',
        };
      case 'monitor_script':
        return {
          eyebrow: '脚本正在制作',
          title: '查看 Agent 执行与审核进度',
          description: '运行会在后台继续。你可以离开此页，完成后再回来确认最终脚本。',
          href: `/projects/${projectId}/script`,
          label: '查看脚本进度',
        };
      case 'confirm_script':
        return {
          eyebrow: '等待你的确认',
          title: '检查脚本，然后进入 Shot 制作',
          description: '脚本链路已到人工确认门。确认前不会自动推进，也不会覆盖后续已锁定内容。',
          href: `/projects/${projectId}/script`,
          label: '检查并确认脚本',
        };
      case 'resolve_script':
        return {
          eyebrow: '需要处理',
          title: '检查脚本运行问题',
          description: '先查看可读错误与建议，再从失败节点安全重试；已经通过的输出不会被覆盖。',
          href: `/projects/${projectId}/script`,
          label: '处理脚本问题',
        };
      case 'produce_shots':
        return {
          eyebrow: '当前制作任务',
          title: '逐个 Shot 完成分镜与视频',
          description: '优先处理失败或空缺的卡片。局部重生成只影响当前 Shot，旧版本会继续保留。',
          href: `/projects/${projectId}/timeline`,
          label: '进入 Shot 制作台',
        };
      case 'produce_video':
        return {
          eyebrow: '接近完成',
          title: '补齐视频片段并检查连续性',
          description: '分镜已准备好，现在可以按 Shot 生成视频并核对前后镜头衔接。',
          href: `/projects/${projectId}/timeline`,
          label: '继续生成视频',
        };
      case 'resolve_shots':
      case 'resolve_video':
        return {
          eyebrow: '需要处理',
          title: '修复失败或冲突的 Shot',
          description: '问题已定位到具体卡片。优先局部重试或处理锁冲突，其他 Shot 与历史版本不会受影响。',
          href: `/projects/${projectId}/timeline`,
          label: '处理 Shot 问题',
        };
      case 'view_result':
        return {
          eyebrow: '项目已完成',
          title: '查看最终版本与历史记录',
          description: '当前结果已完成，所有历史版本和锁定状态仍可追溯。',
          href: `/projects/${projectId}/timeline`,
          label: '查看最终结果',
        };
    }
  })();

  return (
    <>
      <section className="overview-focus">
        <div className="overview-focus-copy">
          <p className="hero-eyebrow">{nextAction.eyebrow}</p>
          <h1>{nextAction.title}</h1>
          <p>{nextAction.description}</p>
          <Link className="button" href={nextAction.href}>{nextAction.label}</Link>
        </div>
        <div className="overview-output-summary" aria-label="当前产出概况">
          <div><span>场景</span><strong>{overview.stats.sceneCount}</strong></div>
          <div><span>Shot</span><strong>{overview.stats.shotCount}</strong></div>
          <div><span>分镜完成</span><strong>{overview.stats.storyboardImageCount}/{overview.stats.shotCount}</strong></div>
          <div><span>视频完成</span><strong>{overview.stats.videoClipCount}/{overview.stats.shotCount}</strong></div>
        </div>
      </section>

      {context.failureSummary ? (
        <section className="attention-banner" role="status">
          <div>
            <strong>有一组运行异常需要检查</strong>
            <p>失败摘要 v{context.failureSummary.versionNo} 已保留，不会覆盖当前可用版本。</p>
          </div>
          <Link className="button secondary small" href={`/projects/${projectId}/logs`}>查看运行记录</Link>
        </section>
      ) : null}

      <section className="stage-overview-grid" aria-label="制作阶段">
        {stageCards.map((item) => {
          const stage = journey.stages[item.stageKey];
          return (
            <Link key={item.step} href={item.href} className="stage-overview-card">
              <div className="stage-overview-heading">
                <span>{item.step}</span>
                <StatusPill value={stage.pillValue} />
              </div>
              <h2>{item.label}</h2>
              <p>{item.description}</p>
              <small>{stage.detail}</small>
            </Link>
          );
        })}
      </section>

      <section className="card snapshot-section">
        <div className="section-heading">
          <div>
            <p className="hero-eyebrow">Active outputs</p>
            <h2 className="card-title">当前生效内容</h2>
          </div>
          <p className="subtle">默认只显示摘要，需要时再展开原文；历史版本仍在对应工作区中保留。</p>
        </div>
        <div className="snapshot-grid">
          {Object.entries(overview.activeSnapshots).map(([key, snapshot]) => {
            const content = snapshot.snapshotMarkdown ?? JSON.stringify(snapshot.snapshotJson, null, 2);
            return (
              <details key={key} className="snapshot-disclosure">
                <summary>
                  <span>{key === 'script' && !context.manualGates.scriptConfirmed
                    ? '当前脚本（待人工确认）'
                    : snapshotLabels[key] ?? key}</span>
                  <small>查看内容</small>
                </summary>
                <pre>{content}</pre>
              </details>
            );
          })}
        </div>
      </section>
    </>
  );
}
