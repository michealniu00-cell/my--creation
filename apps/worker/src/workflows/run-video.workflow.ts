import {
  artifactRepository,
  eventRepository,
  lockRepository,
  projectRepository,
  runRepository,
  settingsRepository,
  shotRepository,
  type ArtifactActivationExpectation,
  type ArtifactActivationResult,
} from '@video-agent-studio/db';
import { materializeMediaOutput } from '@video-agent-studio/artifact-service';
import {
  createVideoProvider,
  evaluateBindingHealth,
} from '@video-agent-studio/providers';
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
  remoteVideoTaskScope,
  throwIfWorkflowAborted,
  type WorkflowExecutionControl,
} from './execution-control';

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
) {
  const projection = projectWorkflowRunState(state);
  return runRepository.update(runId, {
    ...projection,
    finishedAt:
      projection.status === 'failed' || projection.status === 'completed'
        ? new Date().toISOString()
        : null,
  });
}

function captureActivationExpectation(group: {
  activeVersionId?: string | null;
  updatedAt: string;
}): ArtifactActivationExpectation {
  return {
    expectedActiveVersionId: group.activeVersionId ?? null,
    expectedGroupUpdatedAt: group.updatedAt,
  };
}

async function recordActivationConflict(input: {
  projectId: string;
  runId: string;
  shotId: string;
  shotTitle: string;
  artifactGroupId: string;
  candidateVersionId: string;
  expectation: ArtifactActivationExpectation;
  result: Extract<ArtifactActivationResult, { ok: false }>;
}) {
  await eventRepository.create({
    projectId: input.projectId,
    runId: input.runId,
    taskId: null,
    eventType: 'artifact_activation_conflict',
    eventLevel: 'warn',
    userVisible: true,
    summary: `${input.shotTitle} 的视频版本已生成，但当前版本或锁状态已变化，需要人工决定`,
    eventPayload: {
      shotId: input.shotId,
      artifactGroupId: input.artifactGroupId,
      candidateVersionId: input.candidateVersionId,
      reason: input.result.reason,
      expectedActiveVersionId:
        input.expectation.expectedActiveVersionId ?? null,
      expectedGroupUpdatedAt: input.expectation.expectedGroupUpdatedAt ?? null,
      actualActiveVersionId: input.result.actualActiveVersionId,
      actualGroupUpdatedAt: input.result.actualGroupUpdatedAt,
      lockId: input.result.lockId,
    },
  });
}

export async function runVideoWorkflow(
  projectId: string,
  mode: 'all' | 'missing_only' | 'selected_shots' = 'missing_only',
  selectedShotIds?: string[],
  options?: WorkflowExecutionControl,
) {
  throwIfWorkflowAborted(options?.signal);
  const project = await projectRepository.get(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const definition = getWorkflowDefinition('video');
  let engineState = createWorkflowExecutionState(definition);
  const createInput = {
    workflowType: definition.type,
    triggerMode: 'manual',
    startFromNode: definition.startNode,
    endAtNode: definition.nodes.at(-1),
    currentNode: engineState.currentNode,
    runReason: `启动第三部分视频工作流 (${mode})`,
  } as const;
  const runBinding = options?.jobId
    ? await runRepository.createOnceForJob(
        projectId,
        options.jobId,
        createInput,
      )
    : {
        run: await runRepository.create(projectId, createInput),
        created: true as const,
      };
  const run = runBinding.run;
  await options?.onRunReady?.(run.id);
  if (
    !runBinding.created &&
    run.status !== 'running' &&
    !options?.resumeExistingRun
  ) {
    return run;
  }
  if (!runBinding.created) {
    engineState = rehydrateWorkflowExecutionState(definition, {
      workflowType: definition.type,
      currentNode: run.currentNode ?? null,
      status: run.status,
      requiresManualReview: run.requiresManualReview,
      errorType: run.errorType,
      errorMessage: run.errorMessage,
    });
    if (engineState.status === 'failed') {
      if (!options?.resumeExistingRun || !engineState.failedNode) {
        return run;
      }
      engineState = transitionWorkflowExecution(definition, engineState, {
        type: 'failed_step_retry_requested',
        node: engineState.failedNode,
      });
      await persistEngineState(run.id, engineState);
    }
  }
  throwIfWorkflowAborted(options?.signal);

  const agent9Plan = planWorkflowExecution(definition, engineState);
  if (
    agent9Plan.kind !== 'execute_reviewed_agent' ||
    agent9Plan.agentName !== 'agent9'
  ) {
    throw new Error(`Video workflow expected Agent9, got ${agent9Plan.kind}.`);
  }
  await persistEngineState(run.id, engineState);

  const allShots = (await shotRepository.list(projectId, true)) as any[];
  const selectedShotIdSet = new Set(selectedShotIds ?? []);
  const shots =
    mode === 'selected_shots'
      ? allShots.filter((shot) => selectedShotIdSet.has(shot.id))
      : allShots;

  if (mode === 'selected_shots' && shots.length !== selectedShotIdSet.size) {
    const message =
      '所选 Shot 包含不存在或不属于当前项目的对象，已拒绝启动视频工作流。';
    engineState = failCurrentExecutionStep(definition, engineState, message, {
      errorType: 'system',
      requiresManualReview: true,
    });
    await persistEngineState(run.id, engineState);
    await eventRepository.create({
      projectId,
      runId: run.id,
      taskId: null,
      eventType: 'workflow_guard_rejected',
      eventLevel: 'error',
      userVisible: true,
      summary: message,
      eventPayload: { mode, selectedShotIds: selectedShotIds ?? [] },
    });
    return runRepository.get(run.id);
  }
  throwIfWorkflowAborted(options?.signal);
  await settingsRepository.ensureDefaults(projectId);
  const videoBinding = await settingsRepository.getActiveModelBinding(
    projectId,
    'agent9',
  );
  const videoBindingHealth = evaluateBindingHealth('agent9', videoBinding);
  const allowMockInVideoWorkflow = process.env.NODE_ENV === 'test';

  if (videoBindingHealth.state === 'mock' && !allowMockInVideoWorkflow) {
    const message =
      '第三部分工作流已禁用 mock。请先在后端为 Agent9 配置真实视频 API Key，再重新运行。';
    await eventRepository.create({
      projectId,
      runId: run.id,
      taskId: null,
      eventType: 'binding_error',
      eventLevel: 'error',
      userVisible: true,
      summary: message,
      eventPayload: {
        reason: 'mock_provider_disabled_for_video_workflow',
        provider: videoBinding?.provider ?? 'mock',
        modelName: videoBinding?.modelName ?? '未配置',
      },
    });
    await projectRepository.update(projectId, {
      currentStage: 'video',
      status: 'failed',
    });
    engineState = failCurrentExecutionStep(definition, engineState, message, {
      errorType: 'system',
      requiresManualReview: true,
    });
    await persistEngineState(run.id, engineState);
    return runRepository.get(run.id);
  }

  if (
    videoBindingHealth.state !== 'ready' &&
    videoBindingHealth.state !== 'mock'
  ) {
    const message = '第三部分工作流当前配置未就绪，Agent9 还不能执行真实 API。';
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
        provider: videoBinding?.provider ?? 'unknown',
        modelName: videoBinding?.modelName ?? 'unknown',
        state: videoBindingHealth.state,
        issues: videoBindingHealth.issues,
        summary: videoBindingHealth.summary,
      },
    });
    await projectRepository.update(projectId, {
      currentStage: 'video',
      status: 'failed',
    });
    engineState = failCurrentExecutionStep(definition, engineState, message, {
      errorType: 'system',
      requiresManualReview: true,
    });
    await persistEngineState(run.id, engineState);
    return runRepository.get(run.id);
  }

  const videoProvider = createVideoProvider(videoBinding);
  let failed = 0;
  let placeholders = 0;
  let activationConflicts = 0;

  for (const shot of shots) {
    throwIfWorkflowAborted(options?.signal);
    const locked = await lockRepository.isLocked('shot', shot.id);
    if (locked) {
      await eventRepository.create({
        projectId,
        runId: run.id,
        taskId: null,
        eventType: 'task_skipped',
        eventLevel: 'info',
        userVisible: true,
        summary: `${shot.title} 已锁定，自动跳过`,
        eventPayload: { shotId: shot.id },
      });
      continue;
    }

    const currentVideo = await artifactRepository.getShotVideo(shot.id);
    const activeVideoVersionId = currentVideo?.group?.activeVersionId;
    if (activeVideoVersionId) {
      const videoLocked = await lockRepository.isLocked(
        'artifact_version',
        activeVideoVersionId,
      );
      if (videoLocked) {
        await eventRepository.create({
          projectId,
          runId: run.id,
          taskId: null,
          eventType: 'task_skipped',
          eventLevel: 'warn',
          userVisible: true,
          summary: `${shot.title ?? 'Shot'} 的当前视频版本已锁定，自动跳过覆盖`,
          eventPayload: {
            shotId: shot.id,
            versionId: activeVideoVersionId,
          },
        });
        continue;
      }
    }

    const shouldSkip =
      mode === 'missing_only' &&
      currentVideo?.group?.activeVersionId &&
      currentVideo.versions.some(
        (version) => version.id === currentVideo.group?.activeVersionId,
      );

    if (shouldSkip) {
      continue;
    }

    const videoGroup =
      currentVideo?.group ??
      (await artifactRepository.getOrCreateGroup({
        projectId,
        scopeType: 'shot',
        scopeId: shot.id,
        artifactType: 'video',
        role: 'video_clip',
        name: `${shot.title ?? 'Shot'} 视频片段`,
        activeVersionId: null,
        status: 'active',
        isUserManaged: true,
        note: null,
      }));
    if (!currentVideo?.group) {
      await artifactRepository.bindAssetOnce({
        projectId,
        shotId: shot.id,
        artifactGroupId: videoGroup.id,
        bindingRole: 'video_main',
        isPrimary: true,
        influenceScope: 'current_shot',
        note: null,
      });
    }

    const activationExpectation = captureActivationExpectation(videoGroup);
    const prompt = `${project.title} ${shot.title ?? 'shot'} video`;
    const baseExecutionKey = scopedIdempotencyKey(
      options?.idempotencyKey,
      definition.type,
      agent9Plan.agentName,
      shot.id,
    );
    let executionKey = baseExecutionKey;
    let existingExecutionVersion = executionKey
      ? currentVideo?.versions.find(
          (version) => version.generationInput.executionKey === executionKey,
        )
      : null;
    if (
      existingExecutionVersion?.status === 'placeholder' &&
      options?.resumeExistingRun &&
      options.resumeCount &&
      baseExecutionKey
    ) {
      executionKey = scopedIdempotencyKey(
        baseExecutionKey,
        'resume',
        options.resumeCount,
      );
      existingExecutionVersion = currentVideo?.versions.find(
        (version) => version.generationInput.executionKey === executionKey,
      );
    }
    if (existingExecutionVersion) {
      if (
        existingExecutionVersion.status === 'generated' &&
        videoGroup.activeVersionId !== existingExecutionVersion.id
      ) {
        const replayExpectation: ArtifactActivationExpectation = {
          expectedActiveVersionId:
            typeof existingExecutionVersion.generationInput
              .expectedActiveVersionId === 'string'
              ? existingExecutionVersion.generationInput.expectedActiveVersionId
              : null,
          expectedGroupUpdatedAt:
            typeof existingExecutionVersion.generationInput
              .expectedGroupUpdatedAt === 'string'
              ? existingExecutionVersion.generationInput.expectedGroupUpdatedAt
              : undefined,
        };
        const activation = await artifactRepository.activateVersionIfExpected(
          videoGroup.id,
          existingExecutionVersion.id,
          replayExpectation,
        );
        if (!activation.ok) {
          activationConflicts += 1;
          await recordActivationConflict({
            projectId,
            runId: run.id,
            shotId: shot.id,
            shotTitle: shot.title ?? 'Shot',
            artifactGroupId: videoGroup.id,
            candidateVersionId: existingExecutionVersion.id,
            expectation: replayExpectation,
            result: activation,
          });
        }
      } else if (existingExecutionVersion.status === 'placeholder') {
        failed += 1;
        placeholders += 1;
      }
      continue;
    }
    let generatedCandidateId: string | null = null;
    try {
      const response = await videoProvider.generate({
        ...options?.remoteVideoTaskControl?.(
          remoteVideoTaskScope(shot.id, {
            provider: videoBinding?.provider,
            model: videoBinding?.modelName,
            baseUrl: videoBinding?.baseUrl,
            prompt,
            durationMs: 5000,
          }),
        ),
        prompt,
        durationMs: 5000,
        signal: options?.signal,
        idempotencyKey: executionKey,
      });
      throwIfWorkflowAborted(options?.signal);
      const stored = await materializeMediaOutput({
        output: response,
        prefix: `video-${shot.id}`,
        fallbackMimeType: 'video/mp4',
        fallbackExtension: 'mp4',
      });

      const versionInput = {
        groupId: videoGroup.id,
        generatedByAgent: 'agent9',
        sourceTaskId: null,
        mimeType: response.mimeType ?? 'video/mp4',
        storageBucket: stored.storageBucket,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        fileSizeBytes: stored.fileSizeBytes,
        width: 1280,
        height: 720,
        durationMs: 4000,
        generationInput: {
          prompt,
          jobId: options?.jobId ?? null,
          ...activationExpectation,
        },
        metadata: {
          provider: videoBinding?.provider ?? 'mock',
          model: videoBinding?.modelName ?? 'mock',
          remoteTaskId: response.remoteId ?? null,
          ...(response.metadata ?? {}),
        },
        status: 'generated',
        versionNote: currentVideo?.group ? '重生成版本' : '自动生成版本',
        isPlaceholder: false,
      } as const;
      const version = executionKey
        ? (
            await artifactRepository.createNextVersionOnce(
              executionKey,
              versionInput,
            )
          ).version
        : await artifactRepository.createNextVersion(versionInput);
      if (!version) {
        throw new Error('视频 artifact group 在版本写入前已失效');
      }
      generatedCandidateId = version.id;

      const activation = await artifactRepository.activateVersionIfExpected(
        videoGroup.id,
        version.id,
        activationExpectation,
      );
      if (!activation.ok) {
        activationConflicts += 1;
        await recordActivationConflict({
          projectId,
          runId: run.id,
          shotId: shot.id,
          shotTitle: shot.title ?? 'Shot',
          artifactGroupId: videoGroup.id,
          candidateVersionId: version.id,
          expectation: activationExpectation,
          result: activation,
        });
      }
    } catch (error) {
      throwIfWorkflowAborted(options?.signal);
      if (generatedCandidateId) {
        throw error;
      }
      failed += 1;
      const placeholderInput = {
        groupId: videoGroup.id,
        generatedByAgent: 'agent9',
        sourceTaskId: null,
        mimeType: 'video/mp4',
        storageBucket: 'placeholder',
        storagePath: `${videoGroup.id}-${Date.now()}.mp4`,
        publicUrl: null,
        fileSizeBytes: null,
        width: 1280,
        height: 720,
        durationMs: 4000,
        generationInput: {
          prompt,
          jobId: options?.jobId ?? null,
          ...activationExpectation,
        },
        metadata: { reason: 'video_generation_failed', error: String(error) },
        status: 'placeholder',
        versionNote: '视频生成失败占位版本',
        isPlaceholder: true,
      } as const;
      const placeholder = executionKey
        ? (
            await artifactRepository.createNextVersionOnce(
              executionKey,
              placeholderInput,
            )
          ).version
        : await artifactRepository.createNextVersion(placeholderInput);
      if (placeholder) {
        placeholders += 1;

        // A failure must not replace a previously usable active version. For a
        // brand-new stream, activating the placeholder exposes the failure state.
        if (activationExpectation.expectedActiveVersionId === null) {
          const activation = await artifactRepository.activateVersionIfExpected(
            videoGroup.id,
            placeholder.id,
            activationExpectation,
          );
          if (!activation.ok) {
            activationConflicts += 1;
            await recordActivationConflict({
              projectId,
              runId: run.id,
              shotId: shot.id,
              shotTitle: shot.title ?? 'Shot',
              artifactGroupId: videoGroup.id,
              candidateVersionId: placeholder.id,
              expectation: activationExpectation,
              result: activation,
            });
          }
        }
      }
    }
  }

  const needsManualReview = failed > 0 || activationConflicts > 0;
  engineState =
    failed > 0
      ? transitionWorkflowExecution(definition, engineState, {
          type: 'step_failed',
          node: agent9Plan.node,
          errorType: 'system',
          errorMessage: `${failed} 个 Shot 的视频生成失败`,
          requiresManualReview: true,
        })
      : transitionWorkflowExecution(definition, engineState, {
          type: 'reviewed_agent_passed',
          node: agent9Plan.node,
          reviewNode: agent9Plan.reviewNode,
          requiresManualReview: needsManualReview,
        });
  await persistEngineState(run.id, engineState);
  const runProjection = projectWorkflowRunState(engineState);
  await projectRepository.update(projectId, {
    currentStage: 'video',
    status:
      runProjection.status === 'failed'
        ? 'failed'
        : needsManualReview
          ? 'running'
          : 'completed',
  });

  await eventRepository.create({
    projectId,
    runId: run.id,
    taskId: null,
    eventType:
      failed > 0 || activationConflicts > 0 ? 'user_alert' : 'task_finished',
    eventLevel: failed > 0 || activationConflicts > 0 ? 'warn' : 'info',
    userVisible: true,
    summary:
      failed > 0 || activationConflicts > 0
        ? `视频工作流完成：${failed} 个生成失败，${activationConflicts} 个版本因并发或锁冲突等待人工处理`
        : '视频工作流已完成',
    eventPayload: {
      failed,
      placeholders,
      activationConflicts,
    },
  });

  return runRepository.get(run.id);
}
