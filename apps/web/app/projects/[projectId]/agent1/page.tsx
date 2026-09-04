import { notFound } from 'next/navigation';
import { Agent1ConfigForm } from '@/components/agent1-config-form';
import { getProjectContext } from '@/lib/server-data';

export default async function Agent1Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getProjectContext(projectId);
  if (!context) {
    notFound();
  }

  const { project, config } = context;

  return (
    <>
      <section className="hero workflow-hero">
        <p className="hero-eyebrow">步骤 01 · 人工确认门</p>
        <h1 className="page-title">创作设定</h1>
        <p>确认受众、风格、调研重点和全局限制。保存草稿不会启动生成，只有确认后才进入脚本阶段。</p>
      </section>

      <section className="alignment-layout">
        <aside className="card alignment-brief">
          <div>
            <p className="hero-eyebrow">Original brief</p>
            <h2 className="card-title">原始创意</h2>
          </div>
          <p className="brief-copy">{project.sourceIdea}</p>
          <div className="alignment-summary">
            <div>
              <span>脚本类型</span>
              <strong>{config?.scriptType ?? '混合型'}</strong>
            </div>
            <div>
              <span>调研重点</span>
              <strong>{config?.researchFocus ?? '事实、洞察与创作依据'}</strong>
            </div>
            <div>
              <span>当前版本</span>
              <strong>{config ? `v${config.versionNo}` : '尚未保存'}</strong>
            </div>
          </div>
          <div className="guidance-note">
            <strong>确认前建议检查</strong>
            <p>平台和受众是否明确、风格能否执行、是否写清禁用内容，以及连续性要求是否合适。</p>
          </div>
        </aside>

        <div className="card alignment-form-card">
          <div className="section-heading">
            <div>
              <p className="hero-eyebrow">Production brief</p>
              <h2 className="card-title">可执行创作标准</h2>
            </div>
            <p className="subtle">每次保存都会创建新的配置版本，不覆盖历史版本。</p>
          </div>
          <Agent1ConfigForm projectId={projectId} initialConfig={config} />
        </div>
      </section>
    </>
  );
}
