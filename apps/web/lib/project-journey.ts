import type {
  ProjectOverviewStats,
  ProjectRecord,
  WorkflowRunRecord,
} from '@video-agent-studio/shared';

export type JourneyStageKey = 'setup' | 'script' | 'production';
export type JourneyStatus =
  | 'not_started'
  | 'in_progress'
  | 'awaiting_confirmation'
  | 'completed'
  | 'needs_attention'
  | 'paused';

export type ProjectRecommendedAction =
  | 'confirm_config'
  | 'start_script'
  | 'monitor_script'
  | 'confirm_script'
  | 'resolve_script'
  | 'produce_shots'
  | 'resolve_shots'
  | 'produce_video'
  | 'resolve_video'
  | 'view_result';

export interface JourneyStageState {
  status: JourneyStatus;
  label: string;
  pillValue: string;
  detail: string;
}

export interface ProjectJourney {
  stages: Record<JourneyStageKey, JourneyStageState>;
  recommendedAction: ProjectRecommendedAction;
}

interface ProjectJourneyInput {
  project: Pick<ProjectRecord, 'currentStage' | 'status'>;
  configConfirmed: boolean;
  scriptConfirmed: boolean;
  scriptEvidenceInconsistent?: boolean;
  stats?: Pick<ProjectOverviewStats, 'shotCount' | 'storyboardImageCount' | 'videoClipCount'> | null;
  runs: {
    script?: WorkflowRunRecord | null;
    storyboard?: WorkflowRunRecord | null;
    video?: WorkflowRunRecord | null;
  };
}

const statusPresentation: Record<JourneyStatus, Pick<JourneyStageState, 'label' | 'pillValue'>> = {
  not_started: { label: '未开始', pillValue: 'not_started' },
  in_progress: { label: '制作中', pillValue: 'in_progress' },
  awaiting_confirmation: { label: '待确认', pillValue: 'awaiting_confirmation' },
  completed: { label: '已完成', pillValue: 'completed' },
  needs_attention: { label: '需处理', pillValue: 'needs_attention' },
  paused: { label: '已暂停', pillValue: 'paused' },
};

function stageState(status: JourneyStatus, detail: string): JourneyStageState {
  return {
    status,
    ...statusPresentation[status],
    detail,
  };
}

function isRunInProgress(run?: WorkflowRunRecord | null) {
  return run?.status === 'pending' || run?.status === 'running' || run?.status === 'reviewing';
}

/**
 * Derives one product-level journey from persisted project facts.
 *
 * A run is execution history, not the source of truth for an already crossed
 * manual gate. Once the project has advanced, stale run metadata must never
 * make a completed stage look as if it still needs confirmation.
 */
export function deriveProjectJourney(input: ProjectJourneyInput): ProjectJourney {
  const {
    project,
    configConfirmed,
    scriptConfirmed,
    scriptEvidenceInconsistent = false,
    runs,
  } = input;
  const stats = input.stats ?? {
    shotCount: 0,
    storyboardImageCount: 0,
    videoClipCount: 0,
  };

  const setup = configConfirmed
    ? stageState('completed', '创作设定已由用户确认')
    : stageState('awaiting_confirmation', '需要先确认目标、风格与限制');

  let script: JourneyStageState;
  if (scriptConfirmed) {
    script = stageState('completed', '最终脚本已通过人工确认');
  } else if (scriptEvidenceInconsistent || project.currentStage !== 'script') {
    script = stageState('needs_attention', '缺少人工确认凭据，请重新确认最终脚本');
  } else if (runs.script?.status === 'failed' || (project.status === 'failed' && runs.script)) {
    script = stageState('needs_attention', runs.script?.errorMessage ?? '脚本运行需要处理');
  } else if (runs.script?.status === 'paused') {
    script = stageState('paused', '脚本运行已暂停');
  } else if (
    runs.script?.status === 'reviewing' &&
    runs.script.currentNode === 'script_user_confirm'
  ) {
    script = stageState('awaiting_confirmation', '最终脚本等待你的确认');
  } else if (runs.script?.status === 'completed') {
    script = stageState('completed', '脚本工作流已完成');
  } else if (isRunInProgress(runs.script)) {
    script = stageState('in_progress', '脚本 Agent 正在执行与审核');
  } else {
    script = stageState('not_started', configConfirmed ? '创作设定就绪，可以启动脚本' : '完成创作设定后可启动');
  }

  const outputDetail = `${stats.storyboardImageCount}/${stats.shotCount} 分镜 · ${stats.videoClipCount}/${stats.shotCount} 视频`;
  const currentProductionRun = project.currentStage === 'video' ? runs.video : runs.storyboard;
  let production: JourneyStageState;
  if (!scriptConfirmed) {
    production = stageState('not_started', '确认最终脚本后开始');
  } else if (project.currentStage === 'completed') {
    production = stageState('completed', outputDetail);
  } else if (
    currentProductionRun?.status === 'failed' ||
    (project.status === 'failed' && currentProductionRun)
  ) {
    production = stageState('needs_attention', currentProductionRun?.errorMessage ?? outputDetail);
  } else if (currentProductionRun?.status === 'paused') {
    production = stageState('paused', outputDetail);
  } else {
    // Storyboard review is automatic. `reviewing` here means processing, never
    // another user gate. The unified Shot workspace remains the active stage.
    production = stageState('in_progress', outputDetail);
  }

  let recommendedAction: ProjectRecommendedAction;
  if (!configConfirmed) {
    recommendedAction = 'confirm_config';
  } else if (!scriptConfirmed) {
    recommendedAction = script.status === 'awaiting_confirmation'
      ? 'confirm_script'
      : 'resolve_script';
  } else if (project.currentStage === 'script') {
    if (script.status === 'needs_attention') {
      recommendedAction = 'resolve_script';
    } else if (script.status === 'awaiting_confirmation') {
      recommendedAction = 'confirm_script';
    } else if (script.status === 'in_progress' || script.status === 'paused') {
      recommendedAction = 'monitor_script';
    } else if (script.status === 'completed') {
      recommendedAction = 'produce_shots';
    } else {
      recommendedAction = 'start_script';
    }
  } else if (project.currentStage === 'storyboard') {
    recommendedAction = production.status === 'needs_attention' ? 'resolve_shots' : 'produce_shots';
  } else if (project.currentStage === 'video') {
    recommendedAction = production.status === 'needs_attention' ? 'resolve_video' : 'produce_video';
  } else {
    recommendedAction = 'view_result';
  }

  return {
    stages: { setup, script, production },
    recommendedAction,
  };
}
