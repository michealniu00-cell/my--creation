import { notFound } from 'next/navigation';
import { SettingsWorkbench } from '@/components/settings-workbench';
import { getProjectContext, getSettingsPageData } from '@/lib/server-data';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getProjectContext(projectId);
  const data = await getSettingsPageData(projectId);
  if (!context) {
    notFound();
  }

  return (
    <>
      <section className="hero">
        <p className="hero-eyebrow">项目工具 · Agent & provider</p>
        <h1 className="page-title">项目设置</h1>
        <p>管理 Agent 角色、读写边界和模型连接。日常制作无需频繁进入这里。</p>
      </section>

      <SettingsWorkbench
        projectId={projectId}
        profiles={data.profiles}
        bindings={data.bindings}
        snapshots={data.snapshots}
        providerHealth={data.providerHealth}
      />
    </>
  );
}
