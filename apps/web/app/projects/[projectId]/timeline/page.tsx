import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ShotWithAssets } from '@video-agent-studio/shared';
import { TimelineBoard } from '@/components/timeline-board';
import { WorkflowJobNotice } from '@/components/workflow-job-controls';
import { getProjectContext, getTimelinePageData } from '@/lib/server-data';

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ shot?: string }>;
}) {
  const { projectId } = await params;
  const { shot: initialShotId } = await searchParams;
  const context = await getProjectContext(projectId);
  const data = await getTimelinePageData(projectId);
  if (!context) {
    notFound();
  }

  return (
    <>
      <section className="hero workspace-hero">
        <p className="hero-eyebrow">步骤 03 · 分镜与视频</p>
        <h1 className="page-title">Shot 制作台</h1>
        <p>上方分镜，下方视频；局部修改默认只影响当前镜头。</p>
      </section>
      {!context.config?.confirmedByUser ||
      !context.manualGates.scriptConfirmed ? (
        <div className="workspace-notice gate-notice" role="status">
          <div>
            <strong>
              {!context.config?.confirmedByUser
                ? '下一步：确认创作设定'
                : '下一步：检查并确认脚本'}
            </strong>
            <p className="subtle">
              {data.shots.length > 0
                ? '已有产出保留，补齐脚本确认后继续制作。'
                : '完成两次人工确认后，工作流会开始制作镜头。'}
            </p>
          </div>
          <Link
            className="button secondary small"
            href={`/projects/${projectId}/${!context.config?.confirmedByUser ? 'agent1' : 'script'}`}
          >
            前往确认
          </Link>
        </div>
      ) : null}
      {data.workflowJobs.map((job) => (
        <WorkflowJobNotice
          key={job.id}
          projectId={projectId}
          job={job}
          title={
            job.jobType === 'storyboard'
              ? '分镜阶段后台任务'
              : '视频阶段后台任务'
          }
        />
      ))}
      <TimelineBoard
        initialShotId={initialShotId}
        projectId={projectId}
        shots={data.shots as ShotWithAssets[]}
      />
    </>
  );
}
