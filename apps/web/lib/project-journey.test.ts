import { describe, expect, it } from 'vitest';
import type { ProjectRecord, WorkflowRunRecord } from '@video-agent-studio/shared';
import { deriveProjectJourney } from './project-journey';

const now = '2026-09-03T00:00:00.000Z';

function project(
  currentStage: ProjectRecord['currentStage'],
  status: ProjectRecord['status'] = 'running',
) {
  return { currentStage, status };
}

function run(
  workflowType: WorkflowRunRecord['workflowType'],
  status: WorkflowRunRecord['status'],
  currentNode: WorkflowRunRecord['currentNode'] = null,
): WorkflowRunRecord {
  return {
    id: `${workflowType}-${status}`,
    projectId: 'project-1',
    workflowType,
    triggerMode: 'manual',
    startFromNode: null,
    endAtNode: null,
    currentNode,
    status,
    runReason: null,
    retryCount: 0,
    requiresManualReview: false,
    errorType: null,
    errorMessage: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

describe('deriveProjectJourney', () => {
  it('offers the first script run after setup instead of reporting a failure', () => {
    const journey = deriveProjectJourney({
      project: project('script'),
      configConfirmed: true,
      scriptConfirmed: false,
      runs: {},
    });
    expect(journey.stages.script.status).toBe('not_started');
    expect(journey.recommendedAction).toBe('start_script');
  });

  it.each(['pending', 'running', 'reviewing', 'paused'] as const)(
    'keeps an unconfirmed %s script on the progress path',
    (status) => {
      const journey = deriveProjectJourney({
        project: project('script'),
        configConfirmed: true,
        scriptConfirmed: false,
        runs: { script: run('script', status, 'agent4') },
      });
      expect(journey.recommendedAction).toBe('monitor_script');
      expect(journey.stages.production.status).toBe('not_started');
    },
  );

  it('never presents an ended run as a manually confirmed script', () => {
    const journey = deriveProjectJourney({
      project: project('script'),
      configConfirmed: true,
      scriptConfirmed: false,
      runs: { script: run('script', 'completed', 'script_user_confirm') },
    });
    expect(journey.stages.script.status).toBe('needs_attention');
    expect(journey.recommendedAction).toBe('resolve_script');
  });

  it('uses persisted gate evidence instead of stale run metadata after the project advanced', () => {
    const journey = deriveProjectJourney({
      project: project('storyboard'),
      configConfirmed: true,
      scriptConfirmed: true,
      stats: { shotCount: 5, storyboardImageCount: 5, videoClipCount: 0 },
      runs: {
        script: run('script', 'reviewing', 'script_user_confirm'),
        storyboard: run('storyboard', 'reviewing', 'agent8'),
      },
    });

    expect(journey.stages.script.status).toBe('completed');
    expect(journey.stages.production.status).toBe('in_progress');
    expect(journey.recommendedAction).toBe('produce_shots');
  });

  it('does not infer a manual confirmation from an advanced project stage', () => {
    const journey = deriveProjectJourney({
      project: project('storyboard'),
      configConfirmed: true,
      scriptConfirmed: false,
      scriptEvidenceInconsistent: true,
      stats: { shotCount: 5, storyboardImageCount: 5, videoClipCount: 0 },
      runs: {
        script: run('script', 'completed', 'script_user_confirm'),
        storyboard: run('storyboard', 'reviewing', 'agent8'),
      },
    });

    expect(journey.stages.script.status).toBe('needs_attention');
    expect(journey.stages.production.status).toBe('not_started');
    expect(journey.recommendedAction).toBe('resolve_script');
  });

  it('shows only the real script manual gate as awaiting confirmation', () => {
    const journey = deriveProjectJourney({
      project: project('script'),
      configConfirmed: true,
      scriptConfirmed: false,
      runs: { script: run('script', 'reviewing', 'script_user_confirm') },
    });

    expect(journey.stages.setup.status).toBe('completed');
    expect(journey.stages.script.status).toBe('awaiting_confirmation');
    expect(journey.stages.production.status).toBe('not_started');
    expect(journey.recommendedAction).toBe('confirm_script');
  });

  it('prioritizes the Agent1 manual gate before any workflow action', () => {
    const journey = deriveProjectJourney({
      project: project('script', 'draft'),
      configConfirmed: false,
      scriptConfirmed: false,
      runs: {},
    });

    expect(journey.stages.setup.status).toBe('awaiting_confirmation');
    expect(journey.stages.script.status).toBe('not_started');
    expect(journey.recommendedAction).toBe('confirm_config');
  });

  it('maps failures to the stage that currently owns recovery', () => {
    const journey = deriveProjectJourney({
      project: project('video', 'failed'),
      configConfirmed: true,
      scriptConfirmed: true,
      stats: { shotCount: 5, storyboardImageCount: 5, videoClipCount: 3 },
      runs: { video: run('video', 'failed', 'agent9') },
    });

    expect(journey.stages.script.status).toBe('completed');
    expect(journey.stages.production.status).toBe('needs_attention');
    expect(journey.recommendedAction).toBe('resolve_video');
  });
});
