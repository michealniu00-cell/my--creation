import { randomUUID } from 'node:crypto';
import {
  configRepository,
  eventRepository,
  mutateDb,
  projectRepository,
  reviewRepository,
  settingsRepository,
  snapshotRepository,
  taskRepository,
} from '@video-agent-studio/db';
import { executeAgent } from '@video-agent-studio/agents';
import {
  buildFailureSummary,
  reviewTaskOutput,
} from '@video-agent-studio/review-service';
import type {
  AgentName,
  AgentTaskRecord,
  ReviewDecision,
  ReviewRecord,
  StageName,
  WorkflowNode,
} from '@video-agent-studio/shared';

export type ReviewPlan = Partial<Record<AgentName, ReviewDecision[]>>;

interface RunReviewedNodeParams {
  runId: string;
  projectId: string;
  stageName: StageName;
  projectTitle: string;
  sourceIdea: string;
  agentName: AgentName;
  inputPayload: Record<string, unknown>;
  reviewPlan?: ReviewPlan;
  /** @deprecated The workflow engine owns node position; retained for call-site compatibility. */
  startNode?: WorkflowNode;
  /** @deprecated The workflow engine owns review transitions; retained for compatibility. */
  reviewNode?: WorkflowNode;
  allowedSnapshotStages?: string[];
  /**
   * @deprecated No-op. Reviewed-node execution never persists workflow state;
   * the workflow engine projection is the only authority for run progress.
   */
  persistRunProgress?: boolean;
  /** Durable cancellation propagated into every Agent provider request. */
  signal?: AbortSignal;
  /** Stable identity for this logical reviewed node across job retries. */
  idempotencyKey?: string;
}

interface RunReviewedNodeResult {
  approvedTask: AgentTaskRecord | null;
  retryCount: number;
  requiresManualReview: boolean;
  approved: boolean;
  failureSummaryId?: string | null;
  errorType?: 'system' | 'content' | null;
  errorMessage?: string | null;
}

function withReviewOverride(
  baseReview: Omit<
    ReviewRecord,
    'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
  >,
  forcedDecision: ReviewDecision | undefined,
  agentName: AgentName,
  roundNo: number,
) {
  if (!forcedDecision || forcedDecision === baseReview.decision) {
    return baseReview;
  }

  if (forcedDecision === 'pass') {
    return {
      ...baseReview,
      decision: 'pass' as const,
      failedRules: [],
      feedbackMarkdown: `${agentName} 在第 ${roundNo} 轮审核通过。`,
      revisionBrief: null,
      score: 88,
    };
  }

  return {
    ...baseReview,
    decision: forcedDecision,
    failedRules: ['quality_gate_failed'],
    feedbackMarkdown: `${agentName} 第 ${roundNo} 轮仍未达到可推进标准。`,
    revisionBrief: '请根据审核意见补充完整性、结构和可执行细节后重新生成。',
    score: 60,
  };
}

async function createStageSnapshot(task: AgentTaskRecord) {
  await snapshotRepository.createFromAgentTask(task.agentName, task.id);
}

async function createTaskEvent(
  projectId: string,
  runId: string,
  taskId: string | null,
  eventType: string,
  summary: string,
  userVisible = true,
  eventLevel: 'info' | 'warn' | 'error' = 'info',
  eventPayload: Record<string, unknown> = {},
) {
  await eventRepository.create({
    projectId,
    runId,
    taskId,
    eventType,
    eventLevel,
    userVisible,
    summary,
    eventPayload,
  });
}

async function createTaskRecord(params: {
  runId: string;
  projectId: string;
  stageName: StageName;
  agentName: AgentName;
  roundNo: number;
  parentTaskId?: string | null;
  inputPayload: Record<string, unknown>;
  projectTitle: string;
  sourceIdea: string;
  context?: Record<string, unknown>;
  allowedSnapshotStages?: string[];
  signal?: AbortSignal;
  idempotencyKey?: string;
}) {
  params.signal?.throwIfAborted();
  const executionKey = params.idempotencyKey
    ? `${params.idempotencyKey}:${params.agentName}:round-${params.roundNo}`
    : null;
  if (executionKey) {
    const existing = await taskRepository.getByExecutionKey(
      params.runId,
      executionKey,
    );
    if (existing) {
      return { task: existing, created: false as const };
    }
  }
  await settingsRepository.ensureDefaults(params.projectId);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const [activeConfig, overview, profile, modelBinding] = await Promise.all([
    configRepository.getActive(params.projectId),
    projectRepository.getOverview(params.projectId),
    settingsRepository.getActiveProfile(params.projectId, params.agentName),
    settingsRepository.getActiveModelBinding(
      params.projectId,
      params.agentName,
    ),
  ]);
  const visibleSnapshots =
    params.allowedSnapshotStages?.length && overview?.activeSnapshots
      ? Object.fromEntries(
          Object.entries(overview.activeSnapshots).filter(([stageName]) =>
            params.allowedSnapshotStages?.includes(stageName),
          ),
        )
      : (overview?.activeSnapshots ?? {});

  const output = await executeAgent({
    agentName: params.agentName,
    stageName: params.stageName,
    projectTitle: params.projectTitle,
    sourceIdea: params.sourceIdea,
    context: {
      activeConfig: activeConfig
        ? {
            id: activeConfig.id,
            versionNo: activeConfig.versionNo,
            scriptType: activeConfig.scriptType,
            styleDefinition: activeConfig.styleDefinition,
            researchFocus: activeConfig.researchFocus,
            storylineStructure: activeConfig.storylineStructure,
            scriptOrganization: activeConfig.scriptOrganization,
            globalConstraints: activeConfig.globalConstraints,
          }
        : null,
      activeSnapshots: visibleSnapshots,
      inputPayload: params.inputPayload,
      ...params.context,
    },
    profile,
    modelBinding,
    signal: params.signal,
    idempotencyKey: executionKey ?? undefined,
  });
  params.signal?.throwIfAborted();
  const finishedAt = new Date().toISOString();
  const latencyMs = Math.max(1, Date.now() - startedMs);

  const taskInput: Omit<
    AgentTaskRecord,
    'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'executionKey'
  > = {
    runId: params.runId,
    projectId: params.projectId,
    agentName: params.agentName,
    stageName: params.stageName,
    roundNo: params.roundNo,
    parentTaskId: params.parentTaskId ?? null,
    inputPayload: params.inputPayload,
    outputJson: output.outputJson,
    outputMarkdown: output.outputMarkdown,
    outputSummary: output.outputSummary,
    profileVersionId: profile?.id ?? null,
    modelBindingId: modelBinding?.id ?? null,
    providerName: output.providerName ?? modelBinding?.provider ?? 'mock',
    modelName: output.modelName ?? modelBinding?.modelName ?? 'mock',
    credentialSource:
      modelBinding?.credentialSource ??
      (modelBinding?.provider === 'mock' ? 'none' : null),
    promptVersion: output.promptVersion,
    status: 'succeeded',
    errorType: null,
    errorMessage: null,
    latencyMs,
    promptTokens: output.usage?.promptTokens ?? 0,
    completionTokens: output.usage?.completionTokens ?? 0,
    totalTokens: output.usage?.totalTokens ?? 0,
    startedAt,
    finishedAt,
  };
  return executionKey
    ? taskRepository.createAgentOutputOnce(
        params.agentName,
        executionKey,
        taskInput,
      )
    : {
        task: await taskRepository.createAgentOutput(
          params.agentName,
          taskInput,
        ),
        created: true as const,
      };
}

async function createFailureSummaryDoc(
  projectId: string,
  runId: string,
  sourceTaskId: string,
  taskHistory: AgentTaskRecord[],
  reviewHistory: ReviewRecord[],
) {
  const summary = buildFailureSummary(taskHistory);

  return mutateDb((db) => {
    const now = new Date().toISOString();
    const existing = db.failureSummaryDocs.filter(
      (doc) => doc.projectId === projectId && !doc.deletedAt,
    );
    const replay = existing.find(
      (doc) => doc.runId === runId && doc.sourceTaskId === sourceTaskId,
    );
    existing.forEach((doc) => {
      if (doc.isActive) {
        doc.isActive = false;
        doc.updatedAt = now;
      }
    });

    if (replay) {
      replay.isActive = true;
      replay.updatedAt = now;
      const project = db.projects.find(
        (item) => item.id === projectId && !item.deletedAt,
      );
      if (project) {
        project.currentFailureSummaryId = replay.id;
        project.updatedAt = now;
      }
      return replay;
    }

    const doc = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      projectId,
      runId,
      sourceTaskId,
      versionNo: Math.max(0, ...existing.map((item) => item.versionNo)) + 1,
      summaryMarkdown: summary.markdown,
      summaryJson: summary.summaryJson,
      basedOnTaskIds: taskHistory.map((task) => task.id),
      basedOnReviewIds: reviewHistory.map((review) => review.id),
      isActive: true,
      note: '连续失败后自动生成',
    };

    db.failureSummaryDocs.unshift(doc);

    const project = db.projects.find(
      (item) => item.id === projectId && !item.deletedAt,
    );
    if (project) {
      project.currentFailureSummaryId = doc.id;
      project.updatedAt = now;
    }

    return doc;
  });
}

export async function runReviewedNode({
  runId,
  projectId,
  stageName,
  projectTitle,
  sourceIdea,
  agentName,
  inputPayload,
  reviewPlan,
  allowedSnapshotStages,
  signal,
  idempotencyKey,
}: RunReviewedNodeParams): Promise<RunReviewedNodeResult> {
  signal?.throwIfAborted();
  const taskHistory: AgentTaskRecord[] = [];
  const reviewHistory: ReviewRecord[] = [];
  let parentTaskId: string | null = null;
  let revisionBrief: string | null = null;
  let retryCount = 0;

  async function handleExecutionError(
    error: unknown,
    failingAgent: AgentName,
  ): Promise<RunReviewedNodeResult> {
    signal?.throwIfAborted();
    const message =
      error instanceof Error ? error.message : 'Unknown execution error';
    await createTaskEvent(
      projectId,
      runId,
      null,
      'task_failed',
      `${failingAgent} 执行失败`,
      true,
      'error',
      { message },
    );
    return {
      approvedTask: null,
      retryCount,
      requiresManualReview: true,
      approved: false,
      failureSummaryId: null,
      errorType: 'system',
      errorMessage: message,
    };
  }

  for (let roundNo = 1; roundNo <= 3; roundNo += 1) {
    signal?.throwIfAborted();
    let task: AgentTaskRecord;
    let taskCreated = false;
    try {
      const taskResolution = await createTaskRecord({
        runId,
        projectId,
        stageName,
        agentName,
        roundNo,
        parentTaskId,
        inputPayload: {
          ...inputPayload,
          revisionBrief,
        },
        projectTitle,
        sourceIdea,
        context: {
          ...inputPayload,
          revisionBrief,
        },
        allowedSnapshotStages,
        signal,
        idempotencyKey,
      });
      task = taskResolution.task;
      taskCreated = taskResolution.created;
    } catch (error) {
      return handleExecutionError(error, agentName);
    }

    if (taskCreated) {
      await createTaskEvent(
        projectId,
        runId,
        task.id,
        'task_finished',
        `${agentName} 第 ${roundNo} 轮已完成`,
      );
    }

    const forcedDecision = reviewPlan?.[agentName]?.[roundNo - 1];
    const review = await reviewRepository.createAgentFeedback(
      'agent5',
      withReviewOverride(
        reviewTaskOutput(task),
        forcedDecision,
        agentName,
        roundNo,
      ),
    );

    taskHistory.push(task);
    reviewHistory.push(review);

    if (review.decision === 'pass') {
      const alreadyApproved = task.status === 'approved';
      if (!alreadyApproved) {
        await taskRepository.updateExecutionState(task.id, {
          status: 'approved',
        });
      }
      await createStageSnapshot({ ...task, status: 'approved' });
      if (!alreadyApproved) {
        await createTaskEvent(
          projectId,
          runId,
          task.id,
          'review_passed',
          `${agentName} 第 ${roundNo} 轮审核通过`,
        );
      }

      return {
        approvedTask: { ...task, status: 'approved' },
        retryCount,
        requiresManualReview: false,
        approved: true,
        failureSummaryId: null,
        errorType: null,
        errorMessage: null,
      };
    }

    retryCount += 1;
    revisionBrief = review.revisionBrief ?? revisionBrief;
    parentTaskId = task.id;

    const alreadyReviewed = task.status === 'revise_needed';
    if (!alreadyReviewed) {
      await taskRepository.updateExecutionState(task.id, {
        status: 'revise_needed',
      });
      await createTaskEvent(
        projectId,
        runId,
        task.id,
        'review_failed',
        `${agentName} 第 ${roundNo} 轮未通过审核`,
        true,
        'warn',
        {
          decision: review.decision,
          failedRules: review.failedRules,
        },
      );
    }

    if (roundNo < 3 && !alreadyReviewed) {
      await createTaskEvent(
        projectId,
        runId,
        task.id,
        'retry_scheduled',
        `${agentName} 将自动进入第 ${roundNo + 1} 轮重试`,
      );
    }
  }

  const lastFailedTask = taskHistory.at(-1);
  if (!lastFailedTask) {
    return {
      approvedTask: null,
      retryCount,
      requiresManualReview: false,
      approved: false,
      failureSummaryId: null,
      errorType: 'content' as const,
      errorMessage: `${agentName} 未产出可审核结果`,
    };
  }

  const failureSummary = await createFailureSummaryDoc(
    projectId,
    runId,
    lastFailedTask.id,
    taskHistory,
    reviewHistory,
  );

  await createTaskEvent(
    projectId,
    runId,
    lastFailedTask.id,
    'failure_summary_generated',
    `${agentName} 连续 3 次失败，已生成 Agent1 重规划总结`,
    true,
    'warn',
    {
      failureSummaryId: failureSummary.id,
    },
  );

  let agent1Task: AgentTaskRecord;
  let agent1TaskCreated = false;
  try {
    const agent1Resolution = await createTaskRecord({
      runId,
      projectId,
      stageName,
      agentName: 'agent1',
      roundNo: 1,
      parentTaskId: lastFailedTask.id,
      inputPayload: {
        failedAgent: agentName,
        failureSummaryId: failureSummary.id,
        basedOnTaskIds: taskHistory.map((task) => task.id),
        basedOnReviewIds: reviewHistory.map((review) => review.id),
      },
      projectTitle,
      sourceIdea,
      context: {
        failedAgent: agentName,
        failureSummaryMarkdown: failureSummary.summaryMarkdown,
      },
      allowedSnapshotStages,
      signal,
      idempotencyKey: idempotencyKey
        ? `${idempotencyKey}:agent1-replan`
        : undefined,
    });
    agent1Task = agent1Resolution.task;
    agent1TaskCreated = agent1Resolution.created;
  } catch (error) {
    return handleExecutionError(error, 'agent1');
  }

  if (agent1Task.status !== 'approved') {
    await taskRepository.updateExecutionState(agent1Task.id, {
      status: 'approved',
    });
  }
  await createStageSnapshot({ ...agent1Task, status: 'approved' });
  if (agent1TaskCreated) {
    await createTaskEvent(
      projectId,
      runId,
      agent1Task.id,
      'agent1_replanned',
      `Agent1 已基于失败历史为 ${agentName} 生成修正建议`,
      true,
      'warn',
      {
        failureSummaryId: failureSummary.id,
      },
    );
  }

  const recoveryRoundNo = 4;
  let recoveryTask: AgentTaskRecord;
  let recoveryTaskCreated = false;
  try {
    const recoveryResolution = await createTaskRecord({
      runId,
      projectId,
      stageName,
      agentName,
      roundNo: recoveryRoundNo,
      parentTaskId: lastFailedTask.id,
      inputPayload: {
        ...inputPayload,
        revisionBrief: failureSummary.summaryMarkdown,
        failureSummaryId: failureSummary.id,
        replannedByTaskId: agent1Task.id,
      },
      projectTitle,
      sourceIdea,
      context: {
        ...inputPayload,
        revisionBrief: failureSummary.summaryMarkdown,
        failureSummaryId: failureSummary.id,
        replannedByTaskId: agent1Task.id,
      },
      allowedSnapshotStages,
      signal,
      idempotencyKey,
    });
    recoveryTask = recoveryResolution.task;
    recoveryTaskCreated = recoveryResolution.created;
  } catch (error) {
    return handleExecutionError(error, agentName);
  }

  if (recoveryTaskCreated) {
    await createTaskEvent(
      projectId,
      runId,
      recoveryTask.id,
      'task_finished',
      `${agentName} 已根据 Agent1 修正建议重新执行`,
    );
  }

  const recoveryForcedDecision = reviewPlan?.[agentName]?.[recoveryRoundNo - 1];
  const recoveryReview = await reviewRepository.createAgentFeedback(
    'agent5',
    withReviewOverride(
      reviewTaskOutput(recoveryTask),
      recoveryForcedDecision,
      agentName,
      recoveryRoundNo,
    ),
  );

  if (recoveryReview.decision === 'pass') {
    const alreadyApproved = recoveryTask.status === 'approved';
    if (!alreadyApproved) {
      await taskRepository.updateExecutionState(recoveryTask.id, {
        status: 'approved',
      });
    }
    await createStageSnapshot({ ...recoveryTask, status: 'approved' });
    if (!alreadyApproved) {
      await createTaskEvent(
        projectId,
        runId,
        recoveryTask.id,
        'review_passed',
        `${agentName} 在 Agent1 重规划后审核通过`,
        true,
        'warn',
      );
    }

    return {
      approvedTask: { ...recoveryTask, status: 'approved' },
      retryCount,
      requiresManualReview: true,
      approved: true,
      failureSummaryId: failureSummary.id,
      errorType: null,
      errorMessage: null,
    };
  }

  if (recoveryTask.status !== 'failed') {
    await taskRepository.updateExecutionState(recoveryTask.id, {
      status: 'failed',
    });
    await createTaskEvent(
      projectId,
      runId,
      recoveryTask.id,
      'review_failed',
      `${agentName} 在 Agent1 重规划后仍未通过审核`,
      true,
      'error',
      {
        failureSummaryId: failureSummary.id,
        decision: recoveryReview.decision,
      },
    );
  }

  return {
    approvedTask: null,
    retryCount,
    requiresManualReview: true,
    approved: false,
    failureSummaryId: failureSummary.id,
    errorType: 'content' as const,
    errorMessage: `${agentName} 在 Agent1 重规划后仍未通过审核`,
  };
}
