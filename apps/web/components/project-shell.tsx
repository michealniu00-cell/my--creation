'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type {
  FailureSummaryDoc,
  ProjectConfigVersionRecord,
  ProjectOverviewStats,
  ProjectRecord,
  WorkflowRunRecord,
} from '@video-agent-studio/shared';
import { StatusPill } from './status-pill';
import { ProjectQuickActions } from './project-quick-actions';
import {
  deriveProjectJourney,
  type JourneyStageKey,
} from '@/lib/project-journey';

const utilityNavItems = [
  { href: '/storyboard', label: 'Shot 结构', description: '编辑镜头字段' },
  { href: '/key-elements', label: '关键要素', description: '管理参考素材' },
  { href: '/logs', label: '运行记录', description: '查看错误与事件' },
  { href: '/settings', label: '项目设置', description: '模型与 Agent' },
];

function isActivePath(currentPath: string, href: string, overviewHref: string) {
  return (
    currentPath === href ||
    (href !== overviewHref && currentPath.startsWith(href))
  );
}

export function ProjectShell({
  context,
  children,
}: {
  context: {
    project: ProjectRecord;
    config?: ProjectConfigVersionRecord | null;
    overview?: {
      stats: ProjectOverviewStats;
    } | null;
    failureSummary?: FailureSummaryDoc | null;
    runs: {
      script?: WorkflowRunRecord | null;
      storyboard?: WorkflowRunRecord | null;
      video?: WorkflowRunRecord | null;
    };
    manualGates: {
      scriptConfirmed: boolean;
      scriptEvidenceInconsistent: boolean;
    };
  };
  children: React.ReactNode;
}) {
  const currentPath = usePathname();
  const workflowNavRef = useRef<HTMLElement>(null);
  const { project, config, overview, failureSummary, runs } = context;
  const overviewHref = `/projects/${project.id}`;
  const workflowNavItems: Array<{
    href: string;
    step: string;
    label: string;
    description: string;
    stageKey?: JourneyStageKey;
  }> = [
    {
      href: overviewHref,
      step: '00',
      label: '项目总览',
      description: '进度与下一步',
    },
    {
      href: `${overviewHref}/agent1`,
      step: '01',
      label: '创作设定',
      description: '确认目标与约束',
      stageKey: 'setup',
    },
    {
      href: `${overviewHref}/script`,
      step: '02',
      label: '脚本与审核',
      description: '阅读并确认脚本',
      stageKey: 'script',
    },
    {
      href: `${overviewHref}/timeline`,
      step: '03',
      label: 'Shot 制作',
      description: '分镜与视频同屏',
      stageKey: 'production',
    },
  ];

  const journey = deriveProjectJourney({
    project,
    configConfirmed: Boolean(config?.confirmedByUser),
    scriptConfirmed: context.manualGates.scriptConfirmed,
    scriptEvidenceInconsistent: context.manualGates.scriptEvidenceInconsistent,
    stats: overview?.stats,
    runs,
  });
  const currentStageAction = (() => {
    switch (journey.recommendedAction) {
      case 'confirm_config':
        return { href: `${overviewHref}/agent1`, label: '确认创作设定' };
      case 'start_script':
        return { href: `${overviewHref}/script`, label: '启动脚本制作' };
      case 'monitor_script':
        return { href: `${overviewHref}/script`, label: '查看脚本进度' };
      case 'confirm_script':
        return { href: `${overviewHref}/script`, label: '检查并确认脚本' };
      case 'resolve_script':
        return {
          href: `${overviewHref}/script`,
          label:
            context.manualGates.scriptEvidenceInconsistent ||
            project.currentStage !== 'script'
              ? '检查脚本确认'
              : '处理脚本问题',
        };
      case 'produce_video':
        return { href: `${overviewHref}/timeline`, label: '继续生成视频' };
      case 'resolve_shots':
      case 'resolve_video':
        return { href: `${overviewHref}/timeline`, label: '处理 Shot 问题' };
      case 'view_result':
        return { href: `${overviewHref}/timeline`, label: '查看最终结果' };
      default:
        return { href: `${overviewHref}/timeline`, label: '继续制作 Shot' };
    }
  })();

  useEffect(() => {
    const currentItem = workflowNavRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    currentItem?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    });
  }, [currentPath]);

  return (
    <div className="app-shell project-app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="frame">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <p className="hero-eyebrow">Video Agent Studio</p>
            <Link href="/" className="brand-link">
              返回项目中心
            </Link>
          </div>

          <div className="sidebar-project">
            <span className="nav-section-label">当前项目</span>
            <strong title={project.title}>{project.title}</strong>
            <div className="inline-actions sidebar-statuses">
              <StatusPill value={project.status} />
              <StatusPill value={project.currentStage} />
            </div>
          </div>

          <nav
            ref={workflowNavRef}
            className="sidebar-nav"
            aria-label="制作流程"
          >
            <p className="nav-section-label">制作流程</p>
            {workflowNavItems.map((item) => {
              const active = isActivePath(currentPath, item.href, overviewHref);
              const stage = item.stageKey
                ? journey.stages[item.stageKey]
                : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link ${active ? 'active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="nav-step">{item.step}</span>
                  <span className="nav-copy">
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  {stage ? (
                    <span className="nav-state">{stage.label}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <nav className="sidebar-nav utility-nav" aria-label="项目工具">
            <p className="nav-section-label">项目工具</p>
            {utilityNavItems.map((item) => {
              const href = `${overviewHref}${item.href}`;
              const active = isActivePath(currentPath, href, overviewHref);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`nav-link nav-link-utility ${active ? 'active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="nav-copy">
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="content" id="main-content">
          <header className="project-context-bar">
            <div className="project-context-copy">
              <div className="inline-actions">
                <p className="hero-eyebrow">当前项目</p>
                {config ? (
                  <span className="version-label">
                    配置 v{config.versionNo}
                  </span>
                ) : null}
                {failureSummary ? (
                  <span className="version-label warning">有待处理异常</span>
                ) : null}
              </div>
              <h2 title={project.title}>{project.title}</h2>
              <p className="project-idea">{project.sourceIdea}</p>
            </div>

            <div className="project-context-actions">
              <div className="context-stats" aria-label="项目产出统计">
                <span>
                  <strong>{overview?.stats.shotCount ?? 0}</strong> Shot
                </span>
                <span>
                  <strong>{overview?.stats.storyboardImageCount ?? 0}</strong>{' '}
                  分镜
                </span>
                <span>
                  <strong>{overview?.stats.videoClipCount ?? 0}</strong> 视频
                </span>
              </div>
              <div className="inline-actions context-buttons">
                <Link className="button small" href={currentStageAction.href}>
                  {currentStageAction.label}
                </Link>
                <details className="action-menu">
                  <summary className="button secondary small">更多操作</summary>
                  <div className="action-menu-popover">
                    <ProjectQuickActions projectId={project.id} />
                  </div>
                </details>
              </div>
            </div>
          </header>

          {children}
        </main>
      </div>
    </div>
  );
}
