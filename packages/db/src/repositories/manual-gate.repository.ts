import type { DatabaseState } from '../types';
import { id, mutateDb, readDb, timestamp } from '../dev-file-db';
import {
  getWorkflowDefinition,
  projectWorkflowRunState,
  rehydrateWorkflowExecutionState,
  transitionWorkflowExecution,
} from '@video-agent-studio/workflow-engine';

export type ConfirmScriptGateFailure =
  | 'project_not_found'
  | 'script_version_not_approved'
  | 'stale_script_version'
  | 'agent1_gate_evidence_missing'
  | 'manual_gate_not_ready';

export type ConfirmScriptGateResult =
  | {
      ok: true;
      alreadyConfirmed: boolean;
      runId: string;
      taskId: string;
      nextStage: string;
    }
  | { ok: false; reason: ConfirmScriptGateFailure };

function latestScriptRun(db: DatabaseState, projectId: string) {
  return (
    db.workflowRuns
      .filter(
        (run) =>
          run.projectId === projectId &&
          run.workflowType === 'script' &&
          !run.deletedAt,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

function scriptConfirmationEvent(
  db: DatabaseState,
  projectId: string,
  runId: string,
) {
  return (
    db.taskEvents.find(
      (event) =>
        event.projectId === projectId &&
        event.runId === runId &&
        event.eventType === 'manual_gate_confirmed' &&
        event.eventPayload.node === 'script_user_confirm' &&
        !event.deletedAt,
    ) ?? null
  );
}

export const manualGateRepository = {
  async getScriptGateState(projectId: string) {
    const db = await readDb();
    const run = latestScriptRun(db, projectId);
    const confirmation = run
      ? scriptConfirmationEvent(db, projectId, run.id)
      : null;
    return {
      confirmed: Boolean(confirmation),
      runId: run?.id ?? null,
      taskId: confirmation?.taskId ?? null,
      confirmedAt: confirmation?.createdAt ?? null,
      inconsistentCompletedRun: Boolean(run?.status === 'completed' && !confirmation),
    };
  },

  /**
   * Commits the manual gate, workflow transition, audit events and outbox event
   * in one mutation. A legacy completed run without evidence can only be
   * repaired by this same explicit user command; it is never trusted silently.
   */
  async confirmFinalScript(
    projectId: string,
    taskId: string,
  ): Promise<ConfirmScriptGateResult> {
    return mutateDb((db) => {
      const project = db.projects.find(
        (candidate) => candidate.id === projectId && !candidate.deletedAt,
      );
      if (!project) {
        return { ok: false as const, reason: 'project_not_found' as const };
      }

      const task = db.agentTasks.find(
        (candidate) =>
          candidate.id === taskId &&
          candidate.projectId === projectId &&
          candidate.agentName === 'agent4' &&
          candidate.status === 'approved' &&
          !candidate.deletedAt,
      );
      if (!task) {
        return {
          ok: false as const,
          reason: 'script_version_not_approved' as const,
        };
      }

      const run = latestScriptRun(db, projectId);
      if (!run || run.id !== task.runId) {
        return { ok: false as const, reason: 'stale_script_version' as const };
      }

      const existingConfirmation = scriptConfirmationEvent(db, projectId, run.id);
      if (existingConfirmation) {
        return {
          ok: true as const,
          alreadyConfirmed: true,
          runId: run.id,
          taskId: task.id,
          nextStage: project.currentStage,
        };
      }

      const isWaitingAtGate =
        run.status === 'reviewing' && run.currentNode === 'script_user_confirm';
      const isLegacyCompletedWithoutEvidence =
        run.status === 'completed' && run.currentNode === 'script_user_confirm';
      if (!isWaitingAtGate && !isLegacyCompletedWithoutEvidence) {
        return {
          ok: false as const,
          reason: 'manual_gate_not_ready' as const,
        };
      }

      const sourceConfigVersionId = db.agentTasks.find(
        (candidate) =>
          candidate.runId === run.id &&
          candidate.projectId === projectId &&
          candidate.agentName === 'agent2' &&
          !candidate.deletedAt,
      )?.inputPayload.configVersionId;
      const activeConfirmedConfig = db.projectConfigVersions.find(
        (candidate) =>
          candidate.projectId === projectId &&
          candidate.id === project.currentConfigVersionId &&
          candidate.isActive &&
          candidate.confirmedByUser &&
          !candidate.deletedAt,
      );
      if (
        !activeConfirmedConfig ||
        typeof sourceConfigVersionId !== 'string' ||
        sourceConfigVersionId !== activeConfirmedConfig.id
      ) {
        return {
          ok: false as const,
          reason: 'agent1_gate_evidence_missing' as const,
        };
      }

      const definition = getWorkflowDefinition('script');
      let projection: ReturnType<typeof projectWorkflowRunState>;
      try {
        const engineState = rehydrateWorkflowExecutionState(
          definition,
          {
            workflowType: definition.type,
            currentNode: 'script_user_confirm',
            status: isLegacyCompletedWithoutEvidence ? 'reviewing' : run.status,
            requiresManualReview: run.requiresManualReview,
            errorType: run.errorType,
            errorMessage: run.errorMessage,
          },
          { confirmedManualGates: ['agent1_confirmed'] },
        );
        projection = projectWorkflowRunState(
          transitionWorkflowExecution(definition, engineState, {
            type: 'manual_gate_confirmed',
            node: 'script_user_confirm',
          }),
        );
      } catch {
        return {
          ok: false as const,
          reason: 'manual_gate_not_ready' as const,
        };
      }

      const confirmedAt = timestamp();
      const previousRunStatus = run.status;
      const previousStage = project.currentStage;
      const nextStage = previousStage === 'script' ? 'storyboard' : previousStage;

      run.currentNode = projection.currentNode;
      run.status = projection.status;
      run.requiresManualReview = projection.requiresManualReview;
      run.errorType = projection.errorType;
      run.errorMessage = projection.errorMessage;
      run.finishedAt = run.finishedAt ?? confirmedAt;
      run.updatedAt = confirmedAt;

      project.currentStage = nextStage;
      if (previousStage === 'script') {
        project.status = 'running';
      }
      project.updatedAt = confirmedAt;

      const userEventId = id();
      db.taskEvents.unshift({
        id: userEventId,
        projectId,
        runId: run.id,
        taskId: task.id,
        eventType: 'manual_gate_confirmed',
        eventLevel: 'info',
        userVisible: true,
        summary: '最终脚本已由用户确认，可以进入 Shot 制作阶段',
        eventPayload: {
          node: 'script_user_confirm',
          confirmedAt,
          scriptTaskId: task.id,
          repairedLegacyEvidence: isLegacyCompletedWithoutEvidence,
        },
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
        deletedAt: null,
      });

      const developerEventId = id();
      db.taskEvents.unshift({
        id: developerEventId,
        projectId,
        runId: run.id,
        taskId: task.id,
        eventType: 'workflow_state_transitioned',
        eventLevel: 'info',
        userVisible: false,
        summary: 'Script manual gate committed atomically',
        eventPayload: {
          command: 'confirm_final_script',
          node: 'script_user_confirm',
          previousRunStatus,
          nextRunStatus: projection.status,
          previousStage,
          nextStage,
          triggerTaskId: task.id,
        },
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
        deletedAt: null,
      });

      db.outboxEvents.push({
        id: id(),
        aggregateType: 'workflow_run',
        aggregateId: run.id,
        eventType: 'manual_gate_confirmed',
        eventPayload: {
          projectId,
          runId: run.id,
          taskId: task.id,
          node: 'script_user_confirm',
          confirmedAt,
          userEventId,
          developerEventId,
        },
        publishedAt: null,
        publishAttempts: 0,
        lastError: null,
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
        deletedAt: null,
      });

      return {
        ok: true as const,
        alreadyConfirmed: false,
        runId: run.id,
        taskId: task.id,
        nextStage,
      };
    });
  },
};
