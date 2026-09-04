import { runRepository } from '@video-agent-studio/db';
import {
  scriptWorkflowRunSchema,
  storyboardWorkflowRunSchema,
  videoWorkflowRunSchema,
  type WorkflowRunRecord,
} from '@video-agent-studio/shared';
import {
  DurableJobError,
  type DurableJobContext,
  type DurableJobHandlerMap,
} from './job-runner';
import { runScriptWorkflow } from '../workflows/run-script.workflow';
import { runStoryboardWorkflow } from '../workflows/run-storyboard.workflow';
import { runVideoWorkflow } from '../workflows/run-video.workflow';
import {
  runShotStoryboardRegenerationJob,
  runShotVideoRegenerationJob,
  runKeyElementRegenerationJob,
} from './shot-regeneration-job';

function invalidPayload(context: DurableJobContext, issues: unknown): never {
  throw new DurableJobError(
    'WORKFLOW_INPUT_INVALID',
    `Persisted ${context.job.jobType} workflow payload is invalid: ${JSON.stringify(issues)}`,
    { retryable: false },
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function completedResultFromCheckpoint(context: DurableJobContext) {
  if (context.checkpoint.phase !== 'workflow_completed') {
    return null;
  }
  return asRecord(context.checkpoint.result);
}

async function persistStartedCheckpoint(context: DurableJobContext) {
  await context.saveCheckpoint({
    ...context.checkpoint,
    phase: 'workflow_running',
    attemptNo: context.job.attemptCount,
    startedAt:
      asNonEmptyString(context.checkpoint.startedAt) ??
      new Date().toISOString(),
  });
}

function workflowResult(run: WorkflowRunRecord | null) {
  if (!run) {
    throw new DurableJobError(
      'WORKFLOW_STATE_ERROR',
      'Workflow did not return a persisted run',
      {
        retryable: true,
      },
    );
  }
  if (run.status === 'failed' && run.errorType === 'system') {
    throw new DurableJobError(
      'WORKFLOW_CONFIG_ERROR',
      run.errorMessage ?? 'Workflow configuration is not ready',
      { retryable: false },
    );
  }
  return {
    runId: run.id,
    workflowType: run.workflowType,
    runStatus: run.status,
  };
}

async function persistCompletedCheckpoint(
  context: DurableJobContext,
  result: Record<string, unknown>,
) {
  await context.saveCheckpoint({
    ...context.checkpoint,
    phase: 'workflow_completed',
    result,
    completedAt: new Date().toISOString(),
  });
  return result;
}

async function persistRunBinding(
  context: DurableJobContext,
  workflowRunId: string,
) {
  await context.saveCheckpoint({
    ...context.checkpoint,
    phase: 'workflow_running',
    workflowRunId,
    attemptNo: context.job.attemptCount,
    startedAt:
      asNonEmptyString(context.checkpoint.startedAt) ??
      new Date().toISOString(),
  });
}

/**
 * A workflow can finish all of its writes and then lose the worker between the
 * workflow return and the final job checkpoint. `originJobId` is the durable,
 * unique link that lets the next attempt recognize that settled run instead of
 * starting the workflow (and its artifact writes) again.
 */
async function recoverSettledWorkflowRun(context: DurableJobContext) {
  const linkedRun = await runRepository.getByOriginJobId(context.job.id);
  const checkpointRunId = asNonEmptyString(context.checkpoint.workflowRunId);

  if (!linkedRun) {
    if (checkpointRunId) {
      throw new DurableJobError(
        'WORKFLOW_RUN_BINDING_CORRUPT',
        'Job checkpoint references a workflow run without a durable job binding',
        { retryable: false },
      );
    }
    return null;
  }

  if (
    linkedRun.projectId !== context.job.projectId ||
    linkedRun.workflowType !== context.job.jobType ||
    (checkpointRunId && checkpointRunId !== linkedRun.id)
  ) {
    throw new DurableJobError(
      'WORKFLOW_RUN_BINDING_CORRUPT',
      'Durable job is bound to an incompatible workflow run',
      { retryable: false },
    );
  }

  if (!checkpointRunId) {
    await persistRunBinding(context, linkedRun.id);
  }

  if (linkedRun.status === 'pending' || linkedRun.status === 'running') {
    return null;
  }

  if (
    context.job.resumeCount > 0 &&
    (linkedRun.status === 'failed' ||
      linkedRun.status === 'cancelled' ||
      linkedRun.status === 'paused')
  ) {
    return null;
  }

  return persistCompletedCheckpoint(context, workflowResult(linkedRun));
}

export interface WorkflowJobHandlerDependencies {
  runScriptWorkflow: typeof runScriptWorkflow;
  runStoryboardWorkflow: typeof runStoryboardWorkflow;
  runVideoWorkflow: typeof runVideoWorkflow;
}

export function createWorkflowJobHandlers(
  overrides: Partial<WorkflowJobHandlerDependencies> = {},
): DurableJobHandlerMap {
  const workflows: WorkflowJobHandlerDependencies = {
    runScriptWorkflow,
    runStoryboardWorkflow,
    runVideoWorkflow,
    ...overrides,
  };

  return {
    script: async (context) => {
      const completed = completedResultFromCheckpoint(context);
      if (completed) {
        return completed;
      }
      const recovered = await recoverSettledWorkflowRun(context);
      if (recovered) {
        return recovered;
      }
      const payload = scriptWorkflowRunSchema.safeParse(context.job.payload);
      if (!payload.success) {
        invalidPayload(context, payload.error.issues);
      }
      context.throwIfAborted();
      await persistStartedCheckpoint(context);
      const run = await workflows.runScriptWorkflow(
        context.job.projectId,
        payload.data.configVersionId,
        {
          jobId: context.job.id,
          signal: context.signal,
          idempotencyKey: context.job.idempotencyKey,
          resumeExistingRun: context.job.resumeCount > 0,
          resumeCount: context.job.resumeCount,
          onRunReady: (runId) => persistRunBinding(context, runId),
        },
      );
      context.throwIfAborted();
      return persistCompletedCheckpoint(context, workflowResult(run));
    },

    storyboard: async (context) => {
      if (context.job.payload.action === 'regenerate_key_element') {
        return runKeyElementRegenerationJob(context);
      }
      if (context.job.payload.action === 'regenerate_shot_storyboard') {
        return runShotStoryboardRegenerationJob(context);
      }
      const completed = completedResultFromCheckpoint(context);
      if (completed) {
        return completed;
      }
      const recovered = await recoverSettledWorkflowRun(context);
      if (recovered) {
        return recovered;
      }
      const payload = storyboardWorkflowRunSchema.safeParse(
        context.job.payload,
      );
      if (!payload.success) {
        invalidPayload(context, payload.error.issues);
      }
      context.throwIfAborted();
      await persistStartedCheckpoint(context);
      const run = await workflows.runStoryboardWorkflow(
        context.job.projectId,
        payload.data.scriptSourceTaskId,
        {
          jobId: context.job.id,
          signal: context.signal,
          idempotencyKey: context.job.idempotencyKey,
          resumeExistingRun: context.job.resumeCount > 0,
          resumeCount: context.job.resumeCount,
          onRunReady: (runId) => persistRunBinding(context, runId),
        },
      );
      context.throwIfAborted();
      return persistCompletedCheckpoint(context, workflowResult(run));
    },

    video: async (context) => {
      if (context.job.payload.action === 'regenerate_shot_video') {
        return runShotVideoRegenerationJob(context);
      }
      const completed = completedResultFromCheckpoint(context);
      if (completed) {
        return completed;
      }
      const recovered = await recoverSettledWorkflowRun(context);
      if (recovered) {
        return recovered;
      }
      const payload = videoWorkflowRunSchema.safeParse(context.job.payload);
      if (!payload.success) {
        invalidPayload(context, payload.error.issues);
      }
      context.throwIfAborted();
      await persistStartedCheckpoint(context);
      const run = await workflows.runVideoWorkflow(
        context.job.projectId,
        payload.data.mode,
        payload.data.mode === 'selected_shots'
          ? payload.data.selectedShotIds
          : undefined,
        {
          jobId: context.job.id,
          signal: context.signal,
          idempotencyKey: context.job.idempotencyKey,
          resumeExistingRun: context.job.resumeCount > 0,
          resumeCount: context.job.resumeCount,
          onRunReady: (runId) => persistRunBinding(context, runId),
        },
      );
      context.throwIfAborted();
      return persistCompletedCheckpoint(context, workflowResult(run));
    },
  };
}
