import { notFound } from 'next/navigation';
import { LogsWorkbench } from '@/components/logs-workbench';
import { getLogsPageData, getProjectContext } from '@/lib/server-data';

export default async function LogsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getProjectContext(projectId);
  const data = await getLogsPageData(projectId);
  if (!context) {
    notFound();
  }

  return (
    <>
      <section className="hero">
        <p className="hero-eyebrow">项目工具 · User & developer events</p>
        <h1 className="page-title">运行记录</h1>
        <p>优先查看需要处理的失败与提醒，再按需展开 Run、Task、输入输出和审核上下文。</p>
      </section>

      <LogsWorkbench
        runs={data.runs}
        tasks={data.tasks}
        events={data.events}
        reviewMap={data.reviewMap}
        failureSummary={data.failureSummary}
      />
    </>
  );
}
