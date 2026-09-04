import {
  configRepository,
  eventRepository,
  projectRepository,
  runRepository,
  settingsRepository,
} from '@video-agent-studio/db';
import { evaluateBindingHealth } from '@video-agent-studio/providers';
import {
  createWorkflowExecutionState,
  getWorkflowDefinition,
  planWorkflowExecution,
  projectWorkflowRunState,
  rehydrateWorkflowExecutionState,
  transitionWorkflowExecution,
  type WorkflowDefinition,
  type WorkflowExecutionState,
} from '@video-agent-studio/workflow-engine';
import {
  scopedIdempotencyKey,
  throwIfWorkflowAborted,
  type WorkflowExecutionControl,
} from './execution-control';
import { runReviewedNode, type ReviewPlan } from './reviewed-node';

function failCurrentExecutionStep(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
  errorMessage: string,
  options: {
    errorType?: 'system' | 'content';
    requiresManualReview?: boolean;
  } = {},
) {
  const plan = planWorkflowExecution(definition, state);
  if (plan.kind !== 'execute_agent' && plan.kind !== 'execute_reviewed_agent') {
    throw new Error(`Cannot fail non-execution plan ${plan.kind}.`);
  }

  return transitionWorkflowExecution(definition, state, {
    type: 'step_failed',
    node: plan.node,
    errorType: options.errorType ?? 'system',
    errorMessage,
    requiresManualReview: options.requiresManualReview,
  });
}

async function persistEngineState(
  runId: string,
  state: WorkflowExecutionState,
  retryCount: number,
) {
  const projection = projectWorkflowRunState(state);
  return runRepository.update(runId, {
    ...projection,
    retryCount,
    finishedAt:
      projection.status === 'failed' || projection.status === 'completed'
        ? new Date().toISOString()
        : null,
  });
}

export async function runScriptWorkflow(
  projectId: string,
  configVersionId?: string,
  options?: { reviewPlan?: ReviewPlan } & WorkflowExecutionControl,
) {
  throwIfWorkflowAborted(options?.signal);
  const project = await projectRepository.get(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const definition = getWorkflowDefinition('script');
  const configVersions = await configRepository.list(projectId);
  const selectedConfig = configVersionId
    ? configVersions.find((item) => item.id === configVersionId)
    : configVersions.find((item) => item.isActive);
  const hasConfirmedAgent1Gate = Boolean(
    selectedConfig?.isActive && selectedConfig.confirmedByUser,
  );
  let engineState = createWorkflowExecutionState(definition, {
    confirmedPrerequisiteGates: hasConfirmedAgent1Gate
      ? ['agent1_confirmed']
      : [],
  });
  const entryPlan = planWorkflowExecution(definition, engineState);
  if (
    entryPlan.kind === 'await_manual_gate' &&
    entryPlan.node === 'agent1_confirmed'
  ) {
    throw new Error('Agent1 配置尚未由用户确认，不能启动脚本工作流');
  }

  const runInput = {
    workflowType: definition.type,
    triggerMode: 'manual' as const,
    startFromNode: definition.startNode,
    endAtNode: definition.manualGateNodes.at(-1) ?? definition.nodes.at(-1),
    currentNode: engineState.currentNode,
    runReason: '启动第一部分脚本工作流',
  };
  const runResolution = options?.jobId
    ? await runRepository.createOnceForJob(projectId, options.jobId, runInput)
    : {
        run: await runRepository.create(projectId, runInput),
        created: true as const,
      };
  const run = runResolution.run;
  await options?.onRunReady?.(run.id);
  throwIfWorkflowAborted(options?.signal);

  // A retry can arrive after the workflow settled but before the durable job
  // wrote its completion checkpoint. The unique job/run binding makes that
  // replay a read instead of another round of Agent and artifact side effects.
  if (
    !runResolution.created &&
    run.status !== 'pending' &&
    run.status !== 'running' &&
    !options?.resumeExistingRun
  ) {
    return runRepository.get(run.id);
  }

  if (!runResolution.created) {
    engineState = rehydrateWorkflowExecutionState(
      definition,
      {
        workflowType: definition.type,
      currentNode: run.currentNode ?? null,
        status: run.status,
        requiresManualReview: run.requiresManualReview,
        errorType: run.errorType,
        errorMessage: run.errorMessage,
      },
      {
        confirmedManualGates: ['agent1_confirmed'],
      },
    );
    if (engineState.status === 'failed') {
      if (!options?.resumeExistingRun || !engineState.failedNode) {
        return runRepository.get(run.id);
      }
      engineState = transitionWorkflowExecution(definition, engineState, {
        type: 'failed_step_retry_requested',
        node: engineState.failedNode,
      });
      await persistEngineState(run.id, engineState, run.retryCount);
    }
  }

  const executionRootKey =
    options?.resumeExistingRun && options.resumeCount
      ? scopedIdempotencyKey(
          options.idempotencyKey,
          'resume',
          options.resumeCount,
        )
      : options?.idempotencyKey;

  await settingsRepository.ensureDefaults(projectId);
  const scriptBindings = await Promise.all(
    definition.agentNodes.map(async (agentName) => ({
      agentName,
      binding: await settingsRepository.getActiveModelBinding(
        projectId,
        agentName,
      ),
    })),
  );

  const allowMockInScriptWorkflow = process.env.NODE_ENV === 'test';
  const bindingHealth = scriptBindings.map(({ agentName, binding }) => ({
    agentName,
    binding,
    health: evaluateBindingHealth(agentName, binding),
  }));

  const mockBindings = bindingHealth.filter(
    ({ health }) => health.state === 'mock',
  );
  if (mockBindings.length > 0 && !allowMockInScriptWorkflow) {
    const items = mockBindings.map(({ agentName, binding }) => ({
      agentName,
      provider: binding?.provider ?? 'mock',
      modelName: binding?.modelName ?? '未配置',
    }));
    const message =
      '脚本工作流已禁用 mock。请先在设置中心为 Agent1-7 配置真实文本 provider、模型和 API Key，再重新运行。';

    await eventRepository.create({
      projectId,
      runId: run.id,
      taskId: null,
      eventType: 'binding_error',
      eventLevel: 'error',
      userVisible: true,
      summary: message,
      eventPayload: {
        reason: 'mock_provider_disabled_for_script_workflow',
        items,
      },
    });
    engineState = failCurrentExecutionStep(definition, engineState, message, {
      errorType: 'system',
      requiresManualReview: true,
    });
    await projectRepository.update(projectId, {
      currentStage: 'script',
      status: 'failed',
    });
    await persistEngineState(run.id, engineState, 0);
    return runRepository.get(run.id);
  }

  if (mockBindings.length > 0) {
    await eventRepository.create({
      projectId,
      runId: run.id,
      taskId: null,
      eventType: 'binding_warning',
      eventLevel: 'warn',
      userVisible: true,
      summary: `脚本工作流当前仍有 ${mockBindings.map((item) => item.agentName).join('、')} 使用 mock，占位输出会明显弱于真实模型能力。`,
      eventPayload: {
        reason: 'mock_provider_in_script_workflow',
        agents: mockBindings.map((item) => item.agentName),
      },
    });
  }

  const invalidBindings = bindingHealth.filter(
    ({ health }) => health.state !== 'ready' && health.state !== 'mock',
  );
  if (invalidBindings.length > 0) {
    const invalidAgents = invalidBindings
      .map((item) => item.agentName)
      .join('、');
    const message = `脚本工作流当前配置未就绪，${invalidAgents} 还不能执行真实 API。`;

    await eventRepository.create({
      projectId,
      runId: run.id,
      taskId: null,
      eventType: 'binding_error',
      eventLevel: 'error',
      userVisible: true,
      summary: message,
      eventPayload: {
        reason: 'invalid_provider_configuration',
        items: invalidBindings.map(({ agentName, binding, health }) => ({
          agentName,
          provider: binding?.provider ?? 'unknown',
          modelName: binding?.modelName ?? 'unknown',
          state: health.state,
          issues: health.issues,
          summary: health.summary,
        })),
      },
    });
    engineState = failCurrentExecutionStep(definition, engineState, message, {
      errorType: 'system',
      requiresManualReview: true,
    });
    await projectRepository.update(projectId, {
      currentStage: 'script',
      status: 'failed',
    });
    await persistEngineState(run.id, engineState, 0);
    return runRepository.get(run.id);
  }

  let totalRetries = run.retryCount;

  while (true) {
    throwIfWorkflowAborted(options?.signal);
    const plan = planWorkflowExecution(definition, engineState);

    if (plan.kind === 'execute_reviewed_agent') {
      await persistEngineState(run.id, engineState, totalRetries);
      const result = await runReviewedNode({
        runId: run.id,
        projectId,
        stageName: 'script',
        projectTitle: project.title,
        sourceIdea: project.sourceIdea,
        agentName: plan.agentName,
        inputPayload: {
          configVersionId: selectedConfig?.id ?? project.currentConfigVersionId,
        },
        reviewPlan: options?.reviewPlan,
        startNode: plan.node,
        reviewNode: plan.reviewNode,
        persistRunProgress: false,
        signal: options?.signal,
        idempotencyKey: scopedIdempotencyKey(
          executionRootKey,
          definition.type,
          plan.agentName,
        ),
      });

      totalRetries += result.retryCount;
      engineState = result.approved
        ? transitionWorkflowExecution(definition, engineState, {
            type: 'reviewed_agent_passed',
            node: plan.node,
            reviewNode: plan.reviewNode,
            requiresManualReview: result.requiresManualReview,
          })
        : transitionWorkflowExecution(definition, engineState, {
            type: 'step_failed',
            node: plan.node,
            errorType: result.errorType ?? 'content',
            errorMessage:
              result.errorMessage ?? `${plan.agentName} 在重规划后仍未通过审核`,
            requiresManualReview: result.requiresManualReview,
          });
      await persistEngineState(run.id, engineState, totalRetries);
      continue;
    }

    if (plan.kind === 'await_manual_gate') {
      if (plan.node !== 'script_user_confirm') {
        throw new Error(`Unexpected script manual gate ${plan.node}.`);
      }

      await eventRepository.create({
        projectId,
        runId: run.id,
        taskId: null,
        eventType: 'workflow_progress',
        eventLevel: 'info',
        userVisible: true,
        summary: '第一部分脚本工作流已完成，等待用户确认进入第二部分',
        eventPayload: {
          retryCount: totalRetries,
          requiresManualReview: engineState.requiresManualReview,
        },
      });
      await projectRepository.update(projectId, {
        currentStage: 'script',
        status: 'running',
      });
      await persistEngineState(run.id, engineState, totalRetries);
      return runRepository.get(run.id);
    }

    if (plan.kind === 'failed') {
      await projectRepository.update(projectId, {
        currentStage: 'script',
        status: 'failed',
      });
      await persistEngineState(run.id, engineState, totalRetries);
      return runRepository.get(run.id);
    }

    if (plan.kind === 'complete') {
      await persistEngineState(run.id, engineState, totalRetries);
      return runRepository.get(run.id);
    }

    throw new Error(
      `Script definition produced unsupported unreviewed Agent ${plan.agentName}.`,
    );
  }
}
