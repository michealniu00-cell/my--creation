'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ProjectRecord } from '@video-agent-studio/shared';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';

export function ProjectManagementCenter({ projects }: { projects: ProjectRecord[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ProjectRecord['status']>('all');

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const matchesStatus = status === 'all' ? true : project.status === status;
      const keyword = query.trim().toLowerCase();
      const matchesQuery = keyword
        ? [project.title, project.sourceIdea, project.targetPlatform ?? '', project.language]
            .join(' ')
            .toLowerCase()
            .includes(keyword)
        : true;
      return matchesStatus && matchesQuery;
    });
  }, [projects, query, status]);

  const draftCount = projects.filter((project) => project.status === 'draft').length;
  const runningCount = projects.filter((project) => project.status === 'running').length;
  const completedCount = projects.filter((project) => project.status === 'completed').length;

  return (
    <div className="grid">
      <section className="stats stats-kpi">
        <div className="stat">
          <span className="subtle">项目总数</span>
          <strong>{projects.length}</strong>
        </div>
        <div className="stat">
          <span className="subtle">草稿</span>
          <strong>{draftCount}</strong>
        </div>
        <div className="stat">
          <span className="subtle">进行中</span>
          <strong>{runningCount}</strong>
        </div>
        <div className="stat">
          <span className="subtle">已完成</span>
          <strong>{completedCount}</strong>
        </div>
      </section>

      <section className="card management-toolbar">
        <div className="toolbar">
          <div>
            <p className="hero-eyebrow">Control center</p>
            <h2 className="card-title">项目管理中心</h2>
            <p className="subtle">在这里筛选、查看和新建视频工作流项目。</p>
          </div>
          <Link className="button" href="/projects/new">
            新建项目
          </Link>
        </div>
        <div className="grid two">
          <div className="field">
            <label>搜索项目</label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按标题、灵感、平台搜索"
            />
          </div>
          <div className="field">
            <label>状态筛选</label>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="all">全部</option>
              <option value="draft">草稿</option>
              <option value="running">进行中</option>
              <option value="completed">已完成</option>
              <option value="failed">失败</option>
              <option value="archived">已归档</option>
            </select>
          </div>
        </div>
      </section>

      <section className="projects-grid">
        {filteredProjects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`} className="card project-card">
            <div className="toolbar">
              <div>
                <p className="hero-eyebrow">Project</p>
                <h2 className="card-title">{project.title}</h2>
                <p className="subtle">{project.sourceIdea.slice(0, 120)}...</p>
              </div>
              <div className="timeline">
                <StatusPill value={project.status} />
                <StatusPill value={project.currentStage} />
              </div>
            </div>
            <div className="project-card-meta">
              <div className="subtle">平台：{project.targetPlatform ?? '未设置'}</div>
              <div className="subtle">语言：{project.language}</div>
            </div>
            <p className="subtle">最后更新：{formatDate(project.updatedAt)}</p>
          </Link>
        ))}
        {filteredProjects.length === 0 ? (
          <div className="card project-card empty-state">
            <h2 className="card-title">没有匹配的项目</h2>
            <p className="subtle">换个关键词，或者直接创建一个新项目开始工作。</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
