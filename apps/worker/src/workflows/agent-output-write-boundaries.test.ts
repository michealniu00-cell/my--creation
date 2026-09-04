import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ensureDb,
  projectRepository,
  readDb,
  reviewRepository,
  snapshotRepository,
  taskRepository,
} from '@video-agent-studio/db';
import type {
  AgentName,
  AgentTaskRecord,
  ReviewRecord,
  StageName,
} from '@video-agent-studio/shared';
import { AgentOutputWriteDeniedError } from '@video-agent-studio/workflow-engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type TaskCreateInput = Omit<
  AgentTaskRecord,
  'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
>;

function createTaskInput(
  projectId: string,
  agentName: AgentName,
  overrides: Partial<TaskCreateInput> = {},
): TaskCreateInput {
  const stageByAgent: Record<AgentName, StageName> = {
    agent1: 'script',
    agent2: 'script',
    agent3: 'script',
    agent4: 'script',
    agent5: 'script',
    agent6: 'storyboard',
    agent7: 'storyboard',
    agent8: 'storyboard',
    agent9: 'video',
  };

  return {
    runId: `run-${agentName}`,
    projectId,
    agentName,
    stageName: stageByAgent[agentName],
    roundNo: 1,
    parentTaskId: null,
    inputPayload: {},
    outputJson: { owner: agentName },
    outputMarkdown: `## ${agentName} output`,
    outputSummary: `${agentName} output`,
    profileVersionId: null,
    modelBindingId: null,
    providerName: 'mock',
    modelName: 'mock',
    credentialSource: 'none',
    promptVersion: 'test-v1',
    status: 'succeeded',
    errorType: null,
    errorMessage: null,
    latencyMs: 1,
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createReviewInput(
  task: AgentTaskRecord,
): Omit<ReviewRecord, 'createdAt' | 'updatedAt' | 'deletedAt' | 'id'> {
  return {
    projectId: task.projectId,
    runId: task.runId,
    sourceTaskId: task.id,
    reviewerType: 'agent',
    reviewerName: 'agent5',
    decision: 'pass',
    reviewStyle: 'balanced',
    score: 90,
    failedRules: [],
    feedbackMarkdown: '审核通过。',
    revisionBrief: null,
    reviewRound: task.roundNo,
    isFinal: true,
  };
}

describe('persisted Agent output write boundaries', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'vas-agent-boundary-test-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDir, 'db.json');
    await ensureDb();
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects cross-Agent task writes and Agent5 production output', async () => {
    const project = (await projectRepository.list())[0]!;

    await expect(
      taskRepository.createAgentOutput(
        'agent3',
        createTaskInput(project.id, 'agent4'),
      ),
    ).rejects.toMatchObject({
      code: 'cross_agent_write_denied',
    });

    await expect(
      taskRepository.createAgentOutput(
        'agent5',
        createTaskInput(project.id, 'agent5'),
      ),
    ).rejects.toMatchObject({
      code: 'agent5_review_feedback_only',
    });
  });

  it('creates Agent5 feedback against the persisted source without editing it', async () => {
    const project = (await projectRepository.list())[0]!;
    const sourceTask = await taskRepository.createAgentOutput(
      'agent4',
      createTaskInput(project.id, 'agent4', {
        outputMarkdown: '## 不可修改的已审核脚本',
      }),
    );

    const review = await reviewRepository.createAgentFeedback(
      'agent5',
      createReviewInput(sourceTask),
    );
    expect(review.reviewerName).toBe('agent5');
    expect(review.sourceTaskId).toBe(sourceTask.id);

    await expect(
      reviewRepository.createAgentFeedback('agent4', {
        ...createReviewInput(sourceTask),
        reviewerName: 'agent4',
      }),
    ).rejects.toMatchObject({
      code: 'review_feedback_reserved_for_agent5',
    });

    await expect(
      reviewRepository.createAgentFeedback('agent5', {
        ...createReviewInput(sourceTask),
        runId: 'another-run',
      }),
    ).rejects.toThrow('lineage does not match');

    const persistedSource = await taskRepository.get(sourceTask.id);
    expect(persistedSource?.outputMarkdown).toBe('## 不可修改的已审核脚本');
  });

  it('deduplicates a recovered Agent execution, review, and snapshot', async () => {
    const project = (await projectRepository.list())[0]!;
    const input = createTaskInput(project.id, 'agent2', {
      runId: 'run-idempotent-agent-output',
    });

    const first = await taskRepository.createAgentOutputOnce(
      'agent2',
      'job-1:script:agent2:round-1',
      input,
    );
    const replay = await taskRepository.createAgentOutputOnce(
      'agent2',
      'job-1:script:agent2:round-1',
      input,
    );
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.task.id).toBe(first.task.id);

    const reviewInput = createReviewInput(first.task);
    const firstReview = await reviewRepository.createAgentFeedback(
      'agent5',
      reviewInput,
    );
    const replayReview = await reviewRepository.createAgentFeedback(
      'agent5',
      reviewInput,
    );
    expect(replayReview.id).toBe(firstReview.id);

    const firstSnapshot = await snapshotRepository.createFromAgentTask(
      'agent2',
      first.task.id,
    );
    const replaySnapshot = await snapshotRepository.createFromAgentTask(
      'agent2',
      first.task.id,
    );
    expect(replaySnapshot.id).toBe(firstSnapshot.id);

    const db = await readDb();
    expect(
      db.agentTasks.filter(
        (task) =>
          task.runId === input.runId &&
          task.executionKey === 'job-1:script:agent2:round-1',
      ),
    ).toHaveLength(1);
    expect(
      db.reviewRecords.filter(
        (review) => review.sourceTaskId === first.task.id,
      ),
    ).toHaveLength(1);
    expect(
      db.projectStageSnapshots.filter(
        (snapshot) => snapshot.sourceTaskId === first.task.id,
      ),
    ).toHaveLength(1);
  });

  it('keeps Agent6 original output and appends traceable Agent7 enhancement snapshots', async () => {
    const project = (await projectRepository.list())[0]!;
    const before = await snapshotRepository.listByProjectAndStage(
      project.id,
      'storyboard_spec',
    );
    const agent6Task = await taskRepository.createAgentOutput(
      'agent6',
      createTaskInput(project.id, 'agent6', {
        runId: 'run-storyboard-boundary',
        outputMarkdown: '## Agent6 原始 Shot 结构',
        outputJson: { shots: [{ id: 'shot-source', title: '原始镜头' }] },
      }),
    );
    await snapshotRepository.createFromAgentTask('agent6', agent6Task.id);

    const firstEnhancement = await taskRepository.createAgentOutput(
      'agent7',
      createTaskInput(project.id, 'agent7', {
        runId: agent6Task.runId,
        inputPayload: { basedOnTaskId: agent6Task.id },
        outputMarkdown: '## Agent7 增强版本 1',
      }),
    );
    const firstSnapshot = await snapshotRepository.createFromAgentTask(
      'agent7',
      firstEnhancement.id,
    );

    const secondEnhancement = await taskRepository.createAgentOutput(
      'agent7',
      createTaskInput(project.id, 'agent7', {
        runId: agent6Task.runId,
        roundNo: 2,
        parentTaskId: firstEnhancement.id,
        inputPayload: { basedOnTaskId: agent6Task.id },
        outputMarkdown: '## Agent7 增强版本 2',
      }),
    );
    const secondSnapshot = await snapshotRepository.createFromAgentTask(
      'agent7',
      secondEnhancement.id,
    );

    const snapshots = await snapshotRepository.listByProjectAndStage(
      project.id,
      'storyboard_spec',
    );
    expect(snapshots).toHaveLength(before.length + 2);
    expect(
      snapshots.find((item) => item.id === firstSnapshot.id)?.isActive,
    ).toBe(false);
    expect(
      snapshots.find((item) => item.id === secondSnapshot.id)?.isActive,
    ).toBe(true);

    const persistedOriginal = await taskRepository.get(agent6Task.id);
    expect(persistedOriginal?.outputMarkdown).toBe('## Agent6 原始 Shot 结构');
    expect(firstEnhancement.inputPayload.basedOnTaskId).toBe(agent6Task.id);
    expect(secondEnhancement.inputPayload.basedOnTaskId).toBe(agent6Task.id);
  });

  it('rejects Agent7 output without a persisted same-project Agent6 source', async () => {
    const project = (await projectRepository.list())[0]!;
    await expect(
      taskRepository.createAgentOutput(
        'agent7',
        createTaskInput(project.id, 'agent7', {
          inputPayload: { basedOnTaskId: 'missing-agent6-task' },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'agent7_requires_agent6_source',
    });

    const otherProject = await projectRepository.create({
      title: '其他项目',
      sourceIdea: '用于验证 Agent7 不得跨项目引用 Agent6。',
      targetPlatform: null,
      language: 'zh-CN',
    });
    const otherProjectAgent6 = await taskRepository.createAgentOutput(
      'agent6',
      createTaskInput(otherProject.id, 'agent6'),
    );

    await expect(
      taskRepository.createAgentOutput(
        'agent7',
        createTaskInput(project.id, 'agent7', {
          inputPayload: { basedOnTaskId: otherProjectAgent6.id },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'agent7_requires_agent6_source',
    });
  });

  it('allows Agent8/9 task audit records but blocks text snapshots', async () => {
    const project = (await projectRepository.list())[0]!;

    for (const actorAgent of ['agent8', 'agent9'] as const) {
      const task = await taskRepository.createAgentOutput(
        actorAgent,
        createTaskInput(project.id, actorAgent),
      );

      await expect(
        snapshotRepository.createFromAgentTask(actorAgent, task.id),
      ).rejects.toBeInstanceOf(AgentOutputWriteDeniedError);
      await expect(
        snapshotRepository.createFromAgentTask(actorAgent, task.id),
      ).rejects.toMatchObject({
        code: 'media_agent_cannot_write_text_artifact',
      });
    }
  });

  it('allows execution-state changes but rejects task content mutation at runtime', async () => {
    const project = (await projectRepository.list())[0]!;
    const task = await taskRepository.createAgentOutput(
      'agent4',
      createTaskInput(project.id, 'agent4', {
        outputMarkdown: '## 原始脚本',
      }),
    );

    await taskRepository.updateExecutionState(task.id, { status: 'approved' });
    await expect(
      taskRepository.updateExecutionState(task.id, {
        outputMarkdown: '## 被篡改的脚本',
      } as never),
    ).rejects.toThrow('Task output is immutable');

    const persisted = await taskRepository.get(task.id);
    expect(persisted?.status).toBe('approved');
    expect(persisted?.outputMarkdown).toBe('## 原始脚本');

    const db = await readDb();
    expect(db.agentTasks.filter((item) => item.id === task.id)).toHaveLength(1);
  });
});
