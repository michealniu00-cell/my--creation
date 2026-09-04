import { getProjectListData } from '../lib/server-data';
import { ProjectManagementCenter } from '../components/project-management-center';

export default async function HomePage() {
  const projects = await getProjectListData();

  return (
    <div className="app-shell landing-shell">
      <div className="content">
        <section className="hero hero-landing">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="hero-eyebrow">Multi-agent production operating system</p>
              <h1 className="page-title">Video Agent Studio</h1>
              <p className="hero-lead">
                把灵感交给平台，由多个职责清晰的 agent 负责调研、故事线、脚本、shot、关键分镜图和视频片段，并用审核、锁定、版本和局部更新把整条链路做成可控工作流。
              </p>
            </div>
            <div className="hero-aside">
              <div className="hero-note">
                <span className="hero-note-index">01</span>
                <div>
                  <strong>从灵感到成片</strong>
                  <p className="subtle">脚本、分镜、视频三段串联，所有关键节点都保留人工控制权。</p>
                </div>
              </div>
              <div className="hero-note">
                <span className="hero-note-index">02</span>
                <div>
                  <strong>工业化工作流</strong>
                  <p className="subtle">不是单次聊天结果，而是可追踪、可回退、可版本化的生产系统。</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        <ProjectManagementCenter projects={projects} />
      </div>
    </div>
  );
}
