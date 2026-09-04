import { notFound } from 'next/navigation';
import type { ShotWithAssets } from '@video-agent-studio/shared';
import { TimelineBoard } from '@/components/timeline-board';
import { WorkflowJobNotice } from '@/components/workflow-job-controls';
import { getProjectContext, getTimelinePageData } from '@/lib/server-data';

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getProjectContext(projectId);
  const data = await getTimelinePageData(projectId);
  if (!context) {
    notFound();
  }

  return (
    <>
      <section className="hero">
        <p className="hero-eyebrow">步骤 03 · 分镜与视频</p>
        <h1 className="page-title">Shot 制作台</h1>
        <p>
          每列对应一个
          Shot：上方是分镜图，下方是视频。重生成、版本切换与锁定默认只影响当前列。
        </p>
      </section>
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
        projectId={projectId}
        shots={data.shots as ShotWithAssets[]}
      />
    </>
  );
}
