import { CreateProjectForm } from '../../../components/create-project-form';

export default function NewProjectPage() {
  return (
    <div className="app-shell">
      <div className="content">
        <section className="hero">
          <p className="muted">Create a new workflow-driven production project</p>
          <h1 className="page-title">新建项目</h1>
          <p>从项目标题和原始灵感开始，系统会在 Agent1 阶段把脚本类型、风格、调研重点和结构要求整理成当前生效配置版本。</p>
        </section>
        <CreateProjectForm />
      </div>
    </div>
  );
}

