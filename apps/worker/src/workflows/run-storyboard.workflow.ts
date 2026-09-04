import {
  artifactRepository,
  eventRepository,
  lockRepository,
  manualGateRepository,
  projectRepository,
  runRepository,
  sceneRepository,
  settingsRepository,
  shotRepository,
  taskRepository,
  type ArtifactActivationExpectation,
  type ArtifactActivationResult,
  type ShotMutationFailure,
} from '@video-agent-studio/db';
import { buildStoryboardImagePrompt } from '@video-agent-studio/shared';
import { materializeMediaOutput } from '@video-agent-studio/artifact-service';
import {
  createImageProvider,
  evaluateBindingHealth,
} from '@video-agent-studio/providers';
import {
  createWorkflowExecutionState,
  getWorkflowDefinition,
  planWorkflowExecution,
  projectWorkflowRunState,
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

type StructuredObject = Record<string, unknown>;

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

function captureActivationExpectation(group: {
  activeVersionId?: string | null;
  updatedAt: string;
}): ArtifactActivationExpectation {
  return {
    expectedActiveVersionId: group.activeVersionId ?? null,
    expectedGroupUpdatedAt: group.updatedAt,
  };
}

async function recordStoryboardActivationConflict(input: {
  projectId: string;
  runId: string;
  taskId: string;
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
    taskId: input.taskId,
    eventType: 'artifact_activation_conflict',
    eventLevel: 'warn',
    userVisible: true,
    summary: `${input.shotTitle} 的分镜版本已生成，但当前版本或锁状态已变化，需要人工决定`,
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

async function recordShotMutationConflict(input: {
  projectId: string;
  runId: string;
  taskId: string;
  operation: 'structure_sync' | 'visual_expansion';
  failure: Pick<ShotMutationFailure, 'reason' | 'shotId' | 'lockId'>;
}) {
  await eventRepository.create({
    projectId: input.projectId,
    runId: input.runId,
    taskId: input.taskId,
    eventType: 'shot_write_conflict',
    eventLevel: 'warn',
    userVisible: true,
    summary:
      'Agent 产出的 Shot 候选已保留，但锁状态阻止了自动写回，需要人工决定',
    eventPayload: {
      reason: input.failure.reason,
      operation: input.operation,
      shotId: input.failure.shotId ?? null,
      lockId: input.failure.lockId ?? null,
      candidateTaskId: input.taskId,
    },
  });
}

type StoryboardShotPlan = {
  title: string;
  scriptSegment: string;
  sceneDesc: string | null;
  subjectDesc: string | null;
  actionDesc: string | null;
  moodDesc: string | null;
  continuityNotes: string | null;
  shotIndexInScene: number;
  shotIndexGlobal: number;
};

type StoryboardScenePlan = {
  title: string;
  scriptSegment: string | null;
  sceneDesc: string | null;
  sceneIndex: number;
  shots: StoryboardShotPlan[];
};

type StoryboardShotExpansion = {
  shotId: string | null;
  shotIndexGlobal: number | null;
  shotTitle: string | null;
  scriptSegment: string | null;
  sceneDesc: string | null;
  subjectDesc: string | null;
  actionDesc: string | null;
  moodDesc: string | null;
  continuityNotes: string | null;
  visualPrompt: string | null;
  lighting: string | null;
  cameraMotion: string | null;
  compositionNotes: string | null;
  styleNotes: string | null;
};

function isRecord(value: unknown): value is StructuredObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObjectArray(value: unknown): StructuredObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is StructuredObject => isRecord(item))
    : [];
}

function asNonEmptyText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function pickText(source: StructuredObject, keys: string[]) {
  for (const key of keys) {
    const value = asNonEmptyText(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function createSceneKey(
  sceneTitle: string,
  sceneDesc: string | null,
  scriptSegment: string | null,
) {
  return [sceneTitle, sceneDesc ?? '', scriptSegment ?? ''].join('::');
}

function normalizeSceneShots(
  rawShots: StructuredObject[],
  scene: {
    title: string;
    sceneDesc: string | null;
    scriptSegment: string | null;
  },
) {
  return rawShots.map((rawShot, index) => ({
    title:
      pickText(rawShot, ['title', 'shotTitle', 'name']) ??
      `${scene.title} - Shot ${index + 1}`,
    scriptSegment:
      pickText(rawShot, ['scriptSegment', 'script', 'scriptText', 'segment']) ??
      scene.scriptSegment ??
      scene.title,
    sceneDesc: pickText(rawShot, ['sceneDesc']) ?? scene.sceneDesc,
    subjectDesc:
      pickText(rawShot, [
        'subjectDesc',
        'subject',
        'subjectDescription',
        'visualAnchor',
        'description',
      ]) ?? null,
    actionDesc:
      pickText(rawShot, ['actionDesc', 'action', 'cameraMotion', 'movement']) ??
      null,
    moodDesc: pickText(rawShot, ['moodDesc', 'mood', 'emotionalBeat']) ?? null,
    continuityNotes:
      pickText(rawShot, [
        'continuityNotes',
        'continuity',
        'transitionToNext',
      ]) ?? null,
  }));
}

function parseAgent6Structure(outputJson: StructuredObject) {
  const sceneMap = new Map<
    string,
    Omit<StoryboardScenePlan, 'sceneIndex' | 'shots'> & {
      shots: Array<
        Omit<StoryboardShotPlan, 'shotIndexInScene' | 'shotIndexGlobal'>
      >;
    }
  >();

  const rawScenes = asObjectArray(outputJson.scenes);
  for (const rawScene of rawScenes) {
    const title =
      pickText(rawScene, ['title', 'sceneTitle', 'name']) ??
      `Scene ${sceneMap.size + 1}`;
    const sceneDesc = pickText(rawScene, [
      'sceneDesc',
      'description',
      'summary',
      'purpose',
    ]);
    const scriptSegment = pickText(rawScene, [
      'scriptSegment',
      'script',
      'scriptSummary',
    ]);
    const key = createSceneKey(title, sceneDesc, scriptSegment);
    const existing = sceneMap.get(key) ?? {
      title,
      sceneDesc,
      scriptSegment,
      shots: [],
    };

    const rawSceneShots = asObjectArray(rawScene.shots);
    const normalizedRawShots =
      rawSceneShots.length > 0
        ? rawSceneShots
        : pickText(rawScene, [
              'subjectDesc',
              'subject',
              'actionDesc',
              'moodDesc',
              'continuityNotes',
            ])
          ? [rawScene]
          : [];

    existing.shots.push(
      ...normalizeSceneShots(normalizedRawShots, {
        title,
        sceneDesc,
        scriptSegment,
      }),
    );
    sceneMap.set(key, existing);
  }

  if (sceneMap.size === 0) {
    const rawShots = asObjectArray(
      outputJson.shots ?? outputJson.shotList ?? outputJson.storyboardShots,
    );
    for (const rawShot of rawShots) {
      const sceneTitle =
        pickText(rawShot, ['sceneTitle', 'scene', 'sceneName']) ?? 'Scene 1';
      const sceneDesc = pickText(rawShot, ['sceneDesc']);
      const scriptSegment = pickText(rawShot, [
        'scriptSegment',
        'script',
        'scriptText',
      ]);
      const key = createSceneKey(sceneTitle, sceneDesc, scriptSegment);
      const existing = sceneMap.get(key) ?? {
        title: sceneTitle,
        sceneDesc,
        scriptSegment,
        shots: [],
      };

      existing.shots.push(
        ...normalizeSceneShots([rawShot], {
          title: sceneTitle,
          sceneDesc,
          scriptSegment,
        }),
      );
      sceneMap.set(key, existing);
    }
  }

  const scenes = [...sceneMap.values()]
    .filter((scene) => scene.shots.length > 0)
    .map((scene, sceneIndex) => ({
      title: scene.title,
      scriptSegment: scene.scriptSegment,
      sceneDesc: scene.sceneDesc,
      sceneIndex: sceneIndex + 1,
      shots: scene.shots.map((shot, shotIndex) => ({
        ...shot,
        shotIndexInScene: shotIndex + 1,
        shotIndexGlobal: 0,
      })),
    }));

  if (scenes.length === 0) {
    throw new Error(
      'Agent6 未返回可落库的 scene/shot 结构，无法更新 Part 2 工作台。',
    );
  }

  let shotIndexGlobal = 1;
  const scenesWithGlobalIndexes = scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => ({
      ...shot,
      shotIndexGlobal: shotIndexGlobal++,
    })),
  }));

  return {
    scenes: scenesWithGlobalIndexes,
    sceneCount: scenesWithGlobalIndexes.length,
    shotCount: scenesWithGlobalIndexes.reduce(
      (count, scene) => count + scene.shots.length,
      0,
    ),
  };
}

function parseAgent7Expansions(
  outputJson: StructuredObject,
  shots: Array<Record<string, unknown>>,
) {
  const rawExpansions = asObjectArray(
    outputJson.shotExpansions ?? outputJson.expansions ?? outputJson.shots,
  );

  if (rawExpansions.length === 0) {
    throw new Error('Agent7 未返回可供 Agent8 使用的 shot 扩写结果。');
  }

  const availableShots = [...shots];
  const orderedShots = [...shots].sort(
    (left, right) =>
      Number(left.shotIndexGlobal ?? Number.MAX_SAFE_INTEGER) -
      Number(right.shotIndexGlobal ?? Number.MAX_SAFE_INTEGER),
  );
  const usedShotIds = new Set<string>();

  function findMatchingShot(
    expansion: StructuredObject,
    fallbackIndex: number,
  ) {
    const shotId = asNonEmptyText(expansion.shotId);
    if (shotId) {
      const match = availableShots.find((shot) => shot.id === shotId);
      if (match) {
        return match;
      }
    }

    const shotIndexGlobal =
      typeof expansion.shotIndexGlobal === 'number'
        ? expansion.shotIndexGlobal
        : null;
    if (shotIndexGlobal !== null) {
      const match = availableShots.find(
        (shot) => Number(shot.shotIndexGlobal) === shotIndexGlobal,
      );
      if (match) {
        return match;
      }
    }

    const shotTitle = pickText(expansion, ['shotTitle', 'title', 'name']);
    if (shotTitle) {
      const match = availableShots.find(
        (shot) =>
          typeof shot.title === 'string' && shot.title.trim() === shotTitle,
      );
      if (match) {
        return match;
      }
    }

    return orderedShots[fallbackIndex] ?? null;
  }

  const expansions = rawExpansions.map((expansion, index) => {
    const matchedShot = findMatchingShot(expansion, index);
    const matchedShotId =
      matchedShot && typeof matchedShot.id === 'string' ? matchedShot.id : null;
    if (matchedShotId) {
      usedShotIds.add(matchedShotId);
    }

    return {
      shotId: matchedShotId,
      shotIndexGlobal:
        typeof expansion.shotIndexGlobal === 'number'
          ? expansion.shotIndexGlobal
          : matchedShot && typeof matchedShot.shotIndexGlobal === 'number'
            ? matchedShot.shotIndexGlobal
            : null,
      shotTitle:
        pickText(expansion, ['shotTitle', 'title', 'name']) ??
        (matchedShot && typeof matchedShot.title === 'string'
          ? matchedShot.title
          : null),
      scriptSegment:
        pickText(expansion, ['scriptSegment', 'script', 'scriptText']) ??
        (matchedShot && typeof matchedShot.scriptSegment === 'string'
          ? matchedShot.scriptSegment
          : null),
      sceneDesc:
        pickText(expansion, ['sceneDesc']) ??
        (matchedShot && typeof matchedShot.sceneDesc === 'string'
          ? matchedShot.sceneDesc
          : null),
      subjectDesc:
        pickText(expansion, ['subjectDesc', 'subject', 'subjectDescription']) ??
        (matchedShot && typeof matchedShot.subjectDesc === 'string'
          ? matchedShot.subjectDesc
          : null),
      actionDesc:
        pickText(expansion, ['actionDesc', 'action', 'actionDescription']) ??
        (matchedShot && typeof matchedShot.actionDesc === 'string'
          ? matchedShot.actionDesc
          : null),
      moodDesc:
        pickText(expansion, ['mood', 'moodDesc', 'emotionalBeat']) ??
        (matchedShot && typeof matchedShot.moodDesc === 'string'
          ? matchedShot.moodDesc
          : null),
      continuityNotes:
        pickText(expansion, ['continuityNotes', 'continuity']) ??
        (matchedShot && typeof matchedShot.continuityNotes === 'string'
          ? matchedShot.continuityNotes
          : null),
      visualPrompt: pickText(expansion, ['visualPrompt', 'prompt']),
      lighting: pickText(expansion, ['lighting', 'light']),
      cameraMotion: pickText(expansion, ['cameraMotion', 'camera', 'movement']),
      compositionNotes: pickText(expansion, [
        'compositionNotes',
        'composition',
        'framing',
      ]),
      styleNotes: pickText(expansion, ['styleNotes', 'style']),
    } satisfies StoryboardShotExpansion;
  });

  if (expansions.some((item) => !item.shotId || !item.visualPrompt)) {
    throw new Error(
      'Agent7 返回的 shot 扩写缺少关键映射或 visualPrompt，无法驱动 Agent8。',
    );
  }

  if (expansions.length !== shots.length || usedShotIds.size !== shots.length) {
    throw new Error(
      `Agent7 扩写数量与 Agent6 同步后的 shot 数不一致。期望 ${shots.length} 个，实际 ${expansions.length} 个。`,
    );
  }

  return expansions;
}

async function syncShotExpansions(
  projectId: string,
  runId: string,
  sourceTaskId: string,
  expansions: StoryboardShotExpansion[],
) {
  const updatedShots = [];
  let shotWriteConflictCount = 0;

  for (const expansion of expansions) {
    const shotId = expansion.shotId;
    if (!shotId) {
      continue;
    }

    const result = await shotRepository.updateForProject(projectId, shotId, {
      sourceTaskId,
      title: expansion.shotTitle,
      scriptSegment: expansion.scriptSegment,
      sceneDesc: expansion.sceneDesc,
      subjectDesc: expansion.subjectDesc,
      actionDesc: expansion.actionDesc,
      moodDesc: expansion.moodDesc,
      continuityNotes: expansion.continuityNotes,
      visualPrompt: expansion.visualPrompt,
      lighting: expansion.lighting,
      cameraMotion: expansion.cameraMotion,
      compositionNotes: expansion.compositionNotes,
      styleNotes: expansion.styleNotes,
    });

    if (!result.ok) {
      if (result.reason === 'shot_locked') {
        shotWriteConflictCount += 1;
        await recordShotMutationConflict({
          projectId,
          runId,
          taskId: sourceTaskId,
          operation: 'visual_expansion',
          failure: result,
        });
        continue;
      }
      throw new Error(`Shot visual expansion write rejected: ${result.reason}`);
    }

    updatedShots.push(result.value);
  }

  return { updatedShots, shotWriteConflictCount };
}

function chunkShotsForAgent7<T>(shots: T[], chunkSize = 1) {
  const chunks: T[][] = [];
  for (let index = 0; index < shots.length; index += chunkSize) {
    chunks.push(shots.slice(index, index + chunkSize));
  }
  return chunks;
}

async function syncStoryboardStructure(
  projectId: string,
  runId: string,
  sourceTaskId: string,
  structure: ReturnType<typeof parseAgent6Structure>,
) {
  const existingShots = (await shotRepository.list(projectId, false)) as Array<{
    id: string;
    sourceTaskId?: string | null;
    sortVersion?: number | null;
  }>;
  const existingScenes = await sceneRepository.list(projectId);
  const expectedShotCount = structure.scenes.reduce(
    (count, scene) => count + scene.shots.length,
    0,
  );

  // Durable-job replay of the same approved Agent6 output must not replace
  // scene identities or increment shot sort versions a second time.
  if (
    existingScenes.length === structure.scenes.length &&
    existingShots.length === expectedShotCount &&
    existingScenes.every((scene) => scene.sourceTaskId === sourceTaskId) &&
    existingShots.every((shot) => shot.sourceTaskId === sourceTaskId)
  ) {
    return {
      scenes: existingScenes,
      shots: existingShots,
      removedShotCount: 0,
      shotWriteConflictCount: 0,
    };
  }
  const lockedShots = [];
  for (const shot of existingShots) {
    const lock = await lockRepository.getStatus('shot', shot.id);
    if (lock.locked) {
      lockedShots.push({ shotId: shot.id, lockId: lock.lockId ?? null });
    }
  }

  if (lockedShots.length > 0) {
    for (const lockedShot of lockedShots) {
      await recordShotMutationConflict({
        projectId,
        runId,
        taskId: sourceTaskId,
        operation: 'structure_sync',
        failure: {
          reason: 'shot_locked',
          shotId: lockedShot.shotId,
          lockId: lockedShot.lockId,
        },
      });
    }
    return {
      scenes: await sceneRepository.list(projectId),
      shots: existingShots,
      removedShotCount: 0,
      shotWriteConflictCount: lockedShots.length,
    };
  }

  const nextScenes = structure.scenes.map((scene) => ({
    projectId,
    sourceTaskId,
    sceneIndex: scene.sceneIndex,
    title: scene.title,
    scriptSegment: scene.scriptSegment,
    sceneDesc: scene.sceneDesc,
    status: 'active' as const,
    note: null,
  }));

  const scenes = await sceneRepository.replaceForProject(projectId, nextScenes);

  const flattenedPlans = structure.scenes.flatMap((scene, sceneIndex) =>
    scene.shots.map((shot) => ({
      ...shot,
      sceneId: scenes[sceneIndex]?.id ?? null,
      sceneDesc: shot.sceneDesc ?? scene.sceneDesc,
    })),
  );

  const syncedShots: Array<{ id: string }> = [];
  let previousShotId: string | undefined;
  let shotWriteConflictCount = 0;

  for (const [index, plan] of flattenedPlans.entries()) {
    const existing = existingShots[index];
    if (existing) {
      const result = await shotRepository.updateForProject(
        projectId,
        existing.id,
        {
          sceneId: plan.sceneId,
          sourceTaskId,
          shotIndexGlobal: plan.shotIndexGlobal,
          shotIndexInScene: plan.shotIndexInScene,
          title: plan.title,
          scriptSegment: plan.scriptSegment,
          sceneDesc: plan.sceneDesc,
          subjectDesc: plan.subjectDesc,
          actionDesc: plan.actionDesc,
          moodDesc: plan.moodDesc,
          continuityNotes: plan.continuityNotes,
          visualPrompt: null,
          lighting: null,
          cameraMotion: null,
          compositionNotes: null,
          styleNotes: null,
          status: 'active',
          isUserAdded: false,
          sortVersion: ((existing.sortVersion ?? 0) || 0) + 1,
          note: null,
        },
      );
      if (!result.ok) {
        if (result.reason === 'shot_locked') {
          shotWriteConflictCount += 1;
          await recordShotMutationConflict({
            projectId,
            runId,
            taskId: sourceTaskId,
            operation: 'structure_sync',
            failure: result,
          });
          continue;
        }
        throw new Error(`Shot structure update rejected: ${result.reason}`);
      }
      syncedShots.push(result.value);
      previousShotId = result.value.id;
      continue;
    }

    const result = await shotRepository.createForProject(
      projectId,
      {
        sceneId: plan.sceneId,
        sourceTaskId,
        shotIndexInScene: plan.shotIndexInScene,
        title: plan.title,
        scriptSegment: plan.scriptSegment,
        sceneDesc: plan.sceneDesc,
        subjectDesc: plan.subjectDesc,
        actionDesc: plan.actionDesc,
        moodDesc: plan.moodDesc,
        continuityNotes: plan.continuityNotes,
        visualPrompt: null,
        lighting: null,
        cameraMotion: null,
        compositionNotes: null,
        styleNotes: null,
        status: 'active',
        isUserAdded: false,
        note: null,
      },
      previousShotId,
    );
    if (!result.ok) {
      if (result.reason === 'shot_locked') {
        shotWriteConflictCount += 1;
        await recordShotMutationConflict({
          projectId,
          runId,
          taskId: sourceTaskId,
          operation: 'structure_sync',
          failure: result,
        });
        continue;
      }
      throw new Error(`Shot structure create rejected: ${result.reason}`);
    }
    syncedShots.push(result.value);
    previousShotId = result.value.id;
  }

  for (const extraShot of existingShots.slice(flattenedPlans.length)) {
    const result = await shotRepository.softDeleteForProject(
      projectId,
      extraShot.id,
    );
    if (!result.ok) {
      if (result.reason === 'shot_locked') {
        shotWriteConflictCount += 1;
        await recordShotMutationConflict({
          projectId,
          runId,
          taskId: sourceTaskId,
          operation: 'structure_sync',
          failure: result,
        });
        continue;
      }
      throw new Error(`Shot structure delete rejected: ${result.reason}`);
    }
  }

  return {
    scenes,
    shots: (await shotRepository.list(projectId, false)) as Array<{
      id: string;
    }>,
    removedShotCount: Math.max(0, existingShots.length - flattenedPlans.length),
    shotWriteConflictCount,
  };
}

export async function runStoryboardWorkflow(
  projectId: string,
  scriptSourceTaskId?: string,
  options?: { reviewPlan?: ReviewPlan } & WorkflowExecutionControl,
) {
  throwIfWorkflowAborted(options?.signal);
  const project = await projectRepository.get(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const definition = getWorkflowDefinition('storyboard');
  const scriptGate = await manualGateRepository.getScriptGateState(projectId);
  let engineState = createWorkflowExecutionState(definition, {
    confirmedPrerequisiteGates: scriptGate.confirmed
      ? ['script_user_confirm']
      : [],
  });
  const entryPlan = planWorkflowExecution(definition, engineState);
  if (
    entryPlan.kind === 'await_manual_gate' &&
    entryPlan.node === 'script_user_confirm'
  ) {
    throw new Error('最终脚本尚未由用户确认，不能启动分镜工作流');
  }

  const createInput = {
    workflowType: definition.type,
    triggerMode: 'manual',
    startFromNode: definition.startNode,
    endAtNode: definition.nodes.at(-1),
    currentNode: engineState.currentNode,
    runReason: '启动第二部分 storyboard 工作流',
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
  const resumeFailedNode =
    !runBinding.created && run.status === 'failed' ? run.currentNode : null;
  await options?.onRunReady?.(run.id);
  if (
    !runBinding.created &&
    run.status !== 'running' &&
    !options?.resumeExistingRun
  ) {
    return run;
  }
  throwIfWorkflowAborted(options?.signal);

  let totalRetries = 0;
  let requiresManualReview = false;
  const overviewBeforeStoryboard =
    await projectRepository.getOverview(projectId);
  const upstreamScriptSnapshot = isRecord(
    overviewBeforeStoryboard?.activeSnapshots?.script,
  )
    ? (overviewBeforeStoryboard.activeSnapshots.script as StructuredObject)
    : null;
  const upstreamScriptSections = asObjectArray(
    isRecord(upstreamScriptSnapshot?.snapshotJson)
      ? upstreamScriptSnapshot.snapshotJson.scriptSections
      : null,
  ).map((section, index) => ({
    sectionIndex: index + 1,
    sectionTitle:
      pickText(section, ['sectionTitle', 'title']) ?? `Section ${index + 1}`,
    keyBeat: pickText(section, ['keyBeat', 'purpose']),
    narration: pickText(section, ['narration', 'voiceover']),
    visuals: Array.isArray(section.visuals)
      ? section.visuals
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
          .slice(0, 4)
      : pickText(section, ['visuals'])
        ? [pickText(section, ['visuals']) as string]
        : [],
    transitionToNext: pickText(section, ['transitionToNext']),
  }));
  const upstreamScriptExcerpt =
    typeof upstreamScriptSnapshot?.snapshotMarkdown === 'string'
      ? upstreamScriptSnapshot.snapshotMarkdown.slice(0, 2500)
      : null;

  const agent6Plan = planWorkflowExecution(definition, engineState);
  if (
    agent6Plan.kind !== 'execute_reviewed_agent' ||
    agent6Plan.agentName !== 'agent6'
  ) {
    throw new Error(
      `Storyboard workflow expected Agent6, got ${agent6Plan.kind}.`,
    );
  }
  await persistEngineState(run.id, engineState, totalRetries);
  const agent6Result = await runReviewedNode({
    runId: run.id,
    projectId,
    stageName: 'storyboard',
    projectTitle: project.title,
    sourceIdea: project.sourceIdea,
    agentName: 'agent6',
    inputPayload: {
      scriptSourceTaskId,
      scriptSections: upstreamScriptSections,
      scriptExcerpt: upstreamScriptExcerpt,
    },
    allowedSnapshotStages: ['script'],
    reviewPlan: options?.reviewPlan,
    startNode: agent6Plan.node,
    reviewNode: agent6Plan.reviewNode,
    persistRunProgress: false,
    signal: options?.signal,
    idempotencyKey:
      resumeFailedNode === 'agent6' &&
      options?.resumeExistingRun &&
      options.resumeCount
        ? scopedIdempotencyKey(
            options?.idempotencyKey,
            definition.type,
            agent6Plan.agentName,
            'resume',
            options.resumeCount,
          )
        : scopedIdempotencyKey(
            options?.idempotencyKey,
            definition.type,
            agent6Plan.agentName,
          ),
  });

  totalRetries += agent6Result.retryCount;
  requiresManualReview =
    requiresManualReview || agent6Result.requiresManualReview;

  engineState = agent6Result.approved
    ? transitionWorkflowExecution(definition, engineState, {
        type: 'reviewed_agent_passed',
        node: agent6Plan.node,
        reviewNode: agent6Plan.reviewNode,
        requiresManualReview: agent6Result.requiresManualReview,
      })
    : transitionWorkflowExecution(definition, engineState, {
        type: 'step_failed',
        node: agent6Plan.node,
        errorType: agent6Result.errorType ?? 'content',
        errorMessage:
          agent6Result.errorMessage ?? 'Agent6 在重规划后仍未通过审核',
        requiresManualReview: agent6Result.requiresManualReview,
      });
  await persistEngineState(run.id, engineState, totalRetries);

  if (!agent6Result.approvedTask) {
    await projectRepository.update(projectId, {
      currentStage: 'storyboard',
      status: 'failed',
    });
    return runRepository.get(run.id);
  }
  throwIfWorkflowAborted(options?.signal);
  const storyboardStructure = parseAgent6Structure(
    agent6Result.approvedTask.outputJson ?? {},
  );
  const syncedStructure = await syncStoryboardStructure(
    projectId,
    run.id,
    agent6Result.approvedTask.id,
    storyboardStructure,
  );
  let shots = syncedStructure.shots as any[];
  let shotWriteConflicts = syncedStructure.shotWriteConflictCount;
  requiresManualReview = requiresManualReview || shotWriteConflicts > 0;
  const scriptSections = upstreamScriptSections;

  await eventRepository.create({
    projectId,
    runId: run.id,
    taskId: agent6Result.approvedTask.id,
    eventType: 'task_updated',
    eventLevel: 'info',
    userVisible: true,
    summary:
      syncedStructure.shotWriteConflictCount > 0
        ? `Agent6 的 Shot 结构候选已保留；${syncedStructure.shotWriteConflictCount} 个锁冲突等待人工处理`
        : `已按 Agent6 拆解结果同步 ${storyboardStructure.sceneCount} 个 scene、${storyboardStructure.shotCount} 个 shot`,
    eventPayload: {
      sceneCount: storyboardStructure.sceneCount,
      shotCount: storyboardStructure.shotCount,
      removedShotCount: syncedStructure.removedShotCount,
      shotWriteConflictCount: syncedStructure.shotWriteConflictCount,
    },
  });

  const shotChunks = chunkShotsForAgent7(shots, 1);
  const priorRunTasks = await taskRepository.listByRun(run.id);
  const mergedShotExpansions: StoryboardShotExpansion[] = [];
  let latestAgent7ApprovedTask: { id: string } | null = null;
  const agent7Plan = planWorkflowExecution(definition, engineState);
  if (
    agent7Plan.kind !== 'execute_reviewed_agent' ||
    agent7Plan.agentName !== 'agent7'
  ) {
    throw new Error(
      `Storyboard workflow expected Agent7, got ${agent7Plan.kind}.`,
    );
  }
  await persistEngineState(run.id, engineState, totalRetries);

  for (const [chunkIndex, shotChunk] of shotChunks.entries()) {
    throwIfWorkflowAborted(options?.signal);
    const currentShot = shotChunk[0];
    const currentShotLabel =
      typeof currentShot?.title === 'string' &&
      currentShot.title.trim().length > 0
        ? currentShot.title.trim()
        : `Shot ${chunkIndex + 1}`;
    const chunkSceneOutline = storyboardStructure.scenes
      .map((scene) => ({
        sceneIndex: scene.sceneIndex,
        title: scene.title,
        sceneDesc: scene.sceneDesc,
        shotCount: scene.shots.length,
        shotTitles: scene.shots
          .map((shot) => shot.title)
          .filter((title): title is string => Boolean(title))
          .filter((title) =>
            shotChunk.some(
              (chunkShot) =>
                typeof chunkShot.title === 'string' &&
                chunkShot.title === title,
            ),
          ),
      }))
      .filter((scene) => scene.shotTitles.length > 0);

    const existingApprovedChunk = priorRunTasks.find((task) => {
      if (task.agentName !== 'agent7' || task.status !== 'approved') {
        return false;
      }
      const taskShots = Array.isArray(task.inputPayload.shots)
        ? task.inputPayload.shots
        : [];
      return taskShots.some(
        (item) =>
          isRecord(item) &&
          typeof item.shotId === 'string' &&
          item.shotId === currentShot?.id,
      );
    });
    const baseChunkExecutionKey = scopedIdempotencyKey(
      options?.idempotencyKey,
      definition.type,
      agent7Plan.agentName,
      currentShot?.id ?? chunkIndex + 1,
    );
    const chunkExecutionKey =
      !existingApprovedChunk &&
      resumeFailedNode === 'agent7' &&
      options?.resumeExistingRun &&
      options.resumeCount
        ? scopedIdempotencyKey(
            baseChunkExecutionKey,
            'resume',
            options.resumeCount,
          )
        : baseChunkExecutionKey;

    const agent7ChunkResult = await runReviewedNode({
      runId: run.id,
      projectId,
      stageName: 'storyboard',
      projectTitle: project.title,
      sourceIdea: project.sourceIdea,
      agentName: 'agent7',
      inputPayload: {
        sceneCount: storyboardStructure.sceneCount,
        totalShotCount: shots.length,
        shotCount: shotChunk.length,
        shotOrdinal: chunkIndex + 1,
        shotTotal: shotChunks.length,
        batchIndex: chunkIndex + 1,
        batchCount: shotChunks.length,
        currentShotTitle: currentShotLabel,
        basedOnTaskId: agent6Result.approvedTask.id,
        scriptSections,
        sceneOutline: chunkSceneOutline,
        shots: shotChunk.map((shot) => ({
          shotId: shot.id,
          shotIndexGlobal: shot.shotIndexGlobal,
          shotIndexInScene: shot.shotIndexInScene,
          title: shot.title,
          scriptSegment: shot.scriptSegment,
          sceneDesc: shot.sceneDesc,
          subjectDesc: shot.subjectDesc,
          actionDesc: shot.actionDesc,
          moodDesc: shot.moodDesc,
          continuityNotes: shot.continuityNotes,
        })),
      },
      allowedSnapshotStages: ['script'],
      reviewPlan: options?.reviewPlan,
      startNode: agent7Plan.node,
      reviewNode: agent7Plan.reviewNode,
      persistRunProgress: false,
      signal: options?.signal,
      idempotencyKey: chunkExecutionKey,
    });

    totalRetries += agent7ChunkResult.retryCount;
    requiresManualReview =
      requiresManualReview || agent7ChunkResult.requiresManualReview;

    if (!agent7ChunkResult.approvedTask) {
      engineState = transitionWorkflowExecution(definition, engineState, {
        type: 'step_failed',
        node: agent7Plan.node,
        errorType: agent7ChunkResult.errorType ?? 'content',
        errorMessage:
          agent7ChunkResult.errorMessage ??
          `Agent7 在处理 ${currentShotLabel} (${chunkIndex + 1}/${shotChunks.length}) 时未通过审核`,
        requiresManualReview: agent7ChunkResult.requiresManualReview,
      });
      await persistEngineState(run.id, engineState, totalRetries);
      await projectRepository.update(projectId, {
        currentStage: 'storyboard',
        status: 'failed',
      });
      return runRepository.get(run.id);
    }

    latestAgent7ApprovedTask = agent7ChunkResult.approvedTask;
    mergedShotExpansions.push(
      ...parseAgent7Expansions(
        agent7ChunkResult.approvedTask.outputJson ?? {},
        shotChunk,
      ),
    );

    await eventRepository.create({
      projectId,
      runId: run.id,
      taskId: agent7ChunkResult.approvedTask.id,
      eventType: 'task_updated',
      eventLevel: 'info',
      userVisible: true,
      summary: `Agent7 已完成 ${currentShotLabel} 的视觉扩写 (${chunkIndex + 1}/${shotChunks.length})`,
      eventPayload: {
        shotOrdinal: chunkIndex + 1,
        shotTotal: shotChunks.length,
        shotId: currentShot?.id ?? null,
        shotTitle: currentShotLabel,
      },
    });
  }

  if (!latestAgent7ApprovedTask) {
    const message = 'Agent7 未产出任何可用的 shot 扩写结果。';
    engineState = failCurrentExecutionStep(definition, engineState, message, {
      errorType: 'content',
      requiresManualReview: true,
    });
    await persistEngineState(run.id, engineState, totalRetries);
    await projectRepository.update(projectId, {
      currentStage: 'storyboard',
      status: 'failed',
    });
    return runRepository.get(run.id);
  }

  engineState = transitionWorkflowExecution(definition, engineState, {
    type: 'reviewed_agent_passed',
    node: agent7Plan.node,
    reviewNode: agent7Plan.reviewNode,
    requiresManualReview,
  });
  await persistEngineState(run.id, engineState, totalRetries);
  throwIfWorkflowAborted(options?.signal);

  const expansionSync = await syncShotExpansions(
    projectId,
    run.id,
    latestAgent7ApprovedTask.id,
    mergedShotExpansions,
  );
  shotWriteConflicts += expansionSync.shotWriteConflictCount;
  requiresManualReview = requiresManualReview || shotWriteConflicts > 0;
  shots = (await shotRepository.list(projectId, false)) as any[];

  await eventRepository.create({
    projectId,
    runId: run.id,
    taskId: latestAgent7ApprovedTask.id,
    eventType: 'task_updated',
    eventLevel: 'info',
    userVisible: true,
    summary: `Agent7 已逐 shot 完成 ${mergedShotExpansions.length} 个镜头的视觉扩写并写回工作台`,
    eventPayload: {
      shotCount: mergedShotExpansions.length,
      shotTotal: shotChunks.length,
      enrichedFields: [
        'visualPrompt',
        'lighting',
        'cameraMotion',
        'compositionNotes',
        'styleNotes',
      ],
    },
  });

  const agent8Plan = planWorkflowExecution(definition, engineState);
  if (
    agent8Plan.kind !== 'execute_agent' ||
    agent8Plan.agentName !== 'agent8'
  ) {
    throw new Error(
      `Storyboard workflow expected Agent8, got ${agent8Plan.kind}.`,
    );
  }
  await persistEngineState(run.id, engineState, totalRetries);
  throwIfWorkflowAborted(options?.signal);
  await settingsRepository.ensureDefaults(projectId);
  const imageBinding = await settingsRepository.getActiveModelBinding(
    projectId,
    'agent8',
  );
  const imageBindingHealth = evaluateBindingHealth('agent8', imageBinding);
  const allowMockInStoryboardWorkflow = process.env.NODE_ENV === 'test';

  if (imageBindingHealth.state === 'mock' && !allowMockInStoryboardWorkflow) {
    const message =
      '第二部分工作流已禁用 mock。请先在后端为 Agent8 配置真实文生图 API Key，再重新运行。';
    await eventRepository.create({
      projectId,
      runId: run.id,
      taskId: latestAgent7ApprovedTask.id,
      eventType: 'binding_error',
      eventLevel: 'error',
      userVisible: true,
      summary: message,
      eventPayload: {
        reason: 'mock_provider_disabled_for_storyboard_workflow',
        provider: imageBinding?.provider ?? 'mock',
        modelName: imageBinding?.modelName ?? '未配置',
      },
    });
    await projectRepository.update(projectId, {
      currentStage: 'storyboard',
      status: 'failed',
    });
    engineState = failCurrentExecutionStep(definition, engineState, message, {
      errorType: 'system',
      requiresManualReview,
    });
    await persistEngineState(run.id, engineState, totalRetries);
    return runRepository.get(run.id);
  }

  if (
    imageBindingHealth.state !== 'ready' &&
    imageBindingHealth.state !== 'mock'
  ) {
    const message = `第二部分工作流当前配置未就绪，Agent8 还不能执行真实 API。`;
    await eventRepository.create({
      projectId,
      runId: run.id,
      taskId: latestAgent7ApprovedTask.id,
      eventType: 'binding_error',
      eventLevel: 'error',
      userVisible: true,
      summary: message,
      eventPayload: {
        reason: 'invalid_provider_configuration',
        provider: imageBinding?.provider ?? 'unknown',
        modelName: imageBinding?.modelName ?? 'unknown',
        state: imageBindingHealth.state,
        issues: imageBindingHealth.issues,
        summary: imageBindingHealth.summary,
      },
    });
    await projectRepository.update(projectId, {
      currentStage: 'storyboard',
      status: 'failed',
    });
    engineState = failCurrentExecutionStep(definition, engineState, message, {
      errorType: 'system',
      requiresManualReview,
    });
    await persistEngineState(run.id, engineState, totalRetries);
    return runRepository.get(run.id);
  }

  const imageProvider = createImageProvider(imageBinding);
  let failed = 0;
  let failedCandidates = 0;
  let activationConflicts = 0;

  for (const shot of shots) {
    throwIfWorkflowAborted(options?.signal);
    const shotLocked = await lockRepository.isLocked('shot', shot.id);
    if (shotLocked) {
      await eventRepository.create({
        projectId,
        runId: run.id,
        taskId: latestAgent7ApprovedTask.id,
        eventType: 'task_skipped',
        eventLevel: 'info',
        userVisible: true,
        summary: `${shot.title ?? 'Shot'} 已锁定，自动跳过分镜更新`,
        eventPayload: { shotId: shot.id },
      });
      continue;
    }

    const storyboard = await artifactRepository.getShotStoryboard(shot.id);
    const activeStoryboardVersionId = storyboard?.group?.activeVersionId;
    if (activeStoryboardVersionId) {
      const storyboardLocked = await lockRepository.isLocked(
        'artifact_version',
        activeStoryboardVersionId,
      );
      if (storyboardLocked) {
        await eventRepository.create({
          projectId,
          runId: run.id,
          taskId: latestAgent7ApprovedTask.id,
          eventType: 'task_skipped',
          eventLevel: 'warn',
          userVisible: true,
          summary: `${shot.title ?? 'Shot'} 的当前分镜版本已锁定，自动跳过覆盖`,
          eventPayload: {
            shotId: shot.id,
            versionId: activeStoryboardVersionId,
          },
        });
        continue;
      }
    }

    const storyboardGroup =
      storyboard?.group ??
      (await artifactRepository.getOrCreateGroup({
        projectId,
        scopeType: 'shot',
        scopeId: shot.id,
        artifactType: 'image',
        role: 'storyboard_image',
        name: `${shot.title ?? 'Shot'} 分镜图`,
        activeVersionId: null,
        status: 'active',
        isUserManaged: true,
        note: null,
      }));
    if (!storyboard?.group) {
      await artifactRepository.bindAssetOnce({
        projectId,
        shotId: shot.id,
        artifactGroupId: storyboardGroup.id,
        bindingRole: 'storyboard_main',
        isPrimary: true,
        influenceScope: 'current_shot',
        note: null,
      });
    }

    const activationExpectation = captureActivationExpectation(storyboardGroup);
    const prompt = buildStoryboardImagePrompt(project.title, shot);
    const baseExecutionKey = scopedIdempotencyKey(
      options?.idempotencyKey,
      definition.type,
      agent8Plan.agentName,
      shot.id,
    );
    let executionKey = baseExecutionKey;
    let existingExecutionVersion = executionKey
      ? storyboard?.versions.find(
          (version) => version.generationInput.executionKey === executionKey,
        )
      : null;
    if (
      existingExecutionVersion?.status === 'failed' &&
      options?.resumeExistingRun &&
      options.resumeCount &&
      baseExecutionKey
    ) {
      executionKey = scopedIdempotencyKey(
        baseExecutionKey,
        'resume',
        options.resumeCount,
      );
      existingExecutionVersion = storyboard?.versions.find(
        (version) => version.generationInput.executionKey === executionKey,
      );
    }
    if (existingExecutionVersion) {
      if (
        existingExecutionVersion.status === 'generated' &&
        storyboardGroup.activeVersionId !== existingExecutionVersion.id
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
          storyboardGroup.id,
          existingExecutionVersion.id,
          replayExpectation,
        );
        if (!activation.ok) {
          activationConflicts += 1;
          await recordStoryboardActivationConflict({
            projectId,
            runId: run.id,
            taskId: latestAgent7ApprovedTask.id,
            shotId: shot.id,
            shotTitle: shot.title ?? 'Shot',
            artifactGroupId: storyboardGroup.id,
            candidateVersionId: existingExecutionVersion.id,
            expectation: replayExpectation,
            result: activation,
          });
        }
      } else if (existingExecutionVersion.status === 'failed') {
        failed += 1;
        failedCandidates += 1;
      }
      continue;
    }
    let generatedCandidateId: string | null = null;
    try {
      const image = await imageProvider.generate({
        prompt,
        width: 1280,
        height: 720,
        signal: options?.signal,
        idempotencyKey: executionKey,
      });
      throwIfWorkflowAborted(options?.signal);
      const stored = await materializeMediaOutput({
        output: image,
        prefix: `storyboard-${shot.id}`,
        fallbackMimeType: 'image/png',
        fallbackExtension: 'png',
      });

      const versionInput = {
        groupId: storyboardGroup.id,
        generatedByAgent: 'agent8',
        sourceTaskId: latestAgent7ApprovedTask.id,
        mimeType: image.mimeType ?? 'image/png',
        storageBucket: stored.storageBucket,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        fileSizeBytes: stored.fileSizeBytes,
        width: 1280,
        height: 720,
        durationMs: null,
        generationInput: {
          prompt,
          jobId: options?.jobId ?? null,
          ...activationExpectation,
        },
        metadata: {
          provider: imageBinding?.provider ?? 'mock',
          model: imageBinding?.modelName ?? 'mock',
          ...(image.metadata ?? {}),
        },
        status: 'generated',
        versionNote: storyboard?.group ? '重生成版本' : '自动生成版本',
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
        throw new Error('分镜 artifact group 在版本写入前已失效');
      }
      generatedCandidateId = version.id;

      const activation = await artifactRepository.activateVersionIfExpected(
        storyboardGroup.id,
        version.id,
        activationExpectation,
      );
      if (!activation.ok) {
        activationConflicts += 1;
        await recordStoryboardActivationConflict({
          projectId,
          runId: run.id,
          taskId: latestAgent7ApprovedTask.id,
          shotId: shot.id,
          shotTitle: shot.title ?? 'Shot',
          artifactGroupId: storyboardGroup.id,
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
      const message =
        error instanceof Error ? error.message : 'Storyboard generation failed';
      const failedCandidateInput = {
        groupId: storyboardGroup.id,
        generatedByAgent: 'agent8',
        sourceTaskId: latestAgent7ApprovedTask.id,
        mimeType: null,
        storageBucket: null,
        storagePath: null,
        publicUrl: null,
        fileSizeBytes: null,
        width: 1280,
        height: 720,
        durationMs: null,
        generationInput: {
          prompt,
          jobId: options?.jobId ?? null,
          ...activationExpectation,
        },
        metadata: {
          provider: imageBinding?.provider ?? 'unknown',
          error: message,
        },
        status: 'failed',
        versionNote: '分镜生成失败记录；此前生效版本保持不变',
        isPlaceholder: false,
      } as const;
      const failedCandidate = executionKey
        ? (
            await artifactRepository.createNextVersionOnce(
              executionKey,
              failedCandidateInput,
            )
          ).version
        : await artifactRepository.createNextVersion(failedCandidateInput);
      if (failedCandidate) {
        failedCandidates += 1;
      }

      await eventRepository.create({
        projectId,
        runId: run.id,
        taskId: latestAgent7ApprovedTask.id,
        eventType: 'user_alert',
        eventLevel: 'warn',
        userVisible: true,
        summary: `${shot.title ?? 'Shot'} 分镜生成失败，失败记录已保留且不会覆盖已有可用版本`,
        eventPayload: {
          shotId: shot.id,
          message,
          failedVersionId: failedCandidate?.id ?? null,
        },
      });
    }
  }

  await eventRepository.create({
    projectId,
    runId: run.id,
    taskId: latestAgent7ApprovedTask.id,
    eventType: 'workflow_progress',
    eventLevel: 'info',
    userVisible: true,
    summary:
      failed > 0 || activationConflicts > 0 || shotWriteConflicts > 0
        ? `分镜工作流完成：${failed} 个生成失败，${activationConflicts} 个版本激活冲突，${shotWriteConflicts} 个 Shot 写冲突等待人工处理`
        : `已为 ${shots.length} 个 shot 生成分镜图版本`,
    eventPayload: {
      retryCount: totalRetries,
      requiresManualReview,
      failed,
      failedCandidates,
      activationConflicts,
      shotWriteConflicts,
    },
  });

  const needsManualReview =
    requiresManualReview ||
    failed > 0 ||
    activationConflicts > 0 ||
    shotWriteConflicts > 0;
  engineState =
    failed > 0
      ? transitionWorkflowExecution(definition, engineState, {
          type: 'step_failed',
          node: agent8Plan.node,
          errorType: 'system',
          errorMessage: `${failed} 个 Shot 的分镜生成失败`,
          requiresManualReview: true,
        })
      : transitionWorkflowExecution(definition, engineState, {
          type: 'agent_succeeded',
          node: agent8Plan.node,
          requiresManualReview: needsManualReview,
        });
  await persistEngineState(run.id, engineState, totalRetries);
  const runProjection = projectWorkflowRunState(engineState);
  await projectRepository.update(projectId, {
    currentStage: 'storyboard',
    status:
      runProjection.status === 'failed'
        ? 'failed'
        : needsManualReview
          ? 'running'
          : 'completed',
  });

  return runRepository.get(run.id);
}
