import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  configRepository,
  ensureDb,
  projectRepository,
  readDb,
  runRepository,
} from '@video-agent-studio/db';
import { runScriptWorkflow } from './run-script.workflow';

describe('runScriptWorkflow', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'vas-worker-test-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDir, 'db.json');
    await ensureDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('creates a failure summary and agent1 replanning task after three review failures', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const run = await runScriptWorkflow(project.id, undefined, {
      reviewPlan: {
        agent2: ['revise', 'revise', 'revise', 'pass'],
      },
    });

    const db = await readDb();
    const latestRun = db.workflowRuns.find((item) => item.id === run?.id);
    const failureSummary = db.failureSummaryDocs.find(
      (doc) => doc.projectId === project.id && doc.isActive,
    );
    const agent1Task = db.agentTasks.find(
      (task) =>
        task.projectId === project.id &&
        task.runId === run?.id &&
        task.agentName === 'agent1',
    );
    const recoveredAgent2Task = db.agentTasks.find(
      (task) =>
        task.projectId === project.id &&
        task.runId === run?.id &&
        task.agentName === 'agent2' &&
        task.roundNo === 4,
    );

    expect(failureSummary).toBeTruthy();
    expect(agent1Task?.status).toBe('approved');
    expect(recoveredAgent2Task?.status).toBe('approved');
    expect(latestRun?.requiresManualReview).toBe(true);
  }, 15_000);

  it('does not create a run before the persisted Agent1 gate is confirmed', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();
    const before = await readDb();
    const draft = await configRepository.createDraft(project.id, {
      scriptType: '未确认测试',
    });

    await expect(runScriptWorkflow(project.id, draft.id)).rejects.toThrow(
      'Agent1 配置尚未由用户确认',
    );

    const after = await readDb();
    expect(after.workflowRuns).toHaveLength(before.workflowRuns.length);
  });

  it('persists only workflow-engine projections, never helper-owned review nodes', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();
    const updateSpy = vi.spyOn(runRepository, 'update');

    const run = await runScriptWorkflow(project.id);
    const runPatches = updateSpy.mock.calls
      .filter(([runId]) => runId === run?.id)
      .map(([, patch]) => patch);
    const currentNodes = runPatches
      .map((patch) => patch.currentNode)
      .filter(Boolean);

    expect(currentNodes).toContain('agent2');
    expect(currentNodes).toContain('agent3');
    expect(currentNodes).toContain('agent4');
    expect(currentNodes).toContain('script_user_confirm');
    expect(currentNodes).not.toContain('agent2_review');
    expect(currentNodes).not.toContain('agent3_review');
    expect(currentNodes).not.toContain('agent4_review');
    expect(runPatches.at(-1)).toMatchObject({
      currentNode: 'script_user_confirm',
      status: 'reviewing',
      requiresManualReview: true,
    });
  });

  it('warns when script agents are still on mock and still completes the default workflow', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const run = await runScriptWorkflow(project.id);
    const db = await readDb();

    const mockWarning = db.taskEvents.find(
      (event) =>
        event.projectId === project.id &&
        event.runId === run?.id &&
        event.eventType === 'binding_warning',
    );
    const latestRun = db.workflowRuns.find((item) => item.id === run?.id);
    const approvedScriptTask = db.agentTasks.find(
      (task) =>
        task.projectId === project.id &&
        task.runId === run?.id &&
        task.agentName === 'agent4' &&
        task.status === 'approved',
    );

    expect(mockWarning?.summary).toContain('mock');
    expect(latestRun?.status).toBe('reviewing');
    expect(approvedScriptTask?.promptTokens).toBe(0);
  });

  it('fails fast outside test mode when script workflow bindings are still mock', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const run = await runScriptWorkflow(project.id);
      const db = await readDb();

      const latestRun = db.workflowRuns.find((item) => item.id === run?.id);
      const configError = db.taskEvents.find(
        (event) =>
          event.projectId === project.id &&
          event.runId === run?.id &&
          event.eventType === 'binding_error',
      );
      const scriptTasks = db.agentTasks.filter(
        (task) =>
          task.projectId === project.id &&
          task.runId === run?.id &&
          task.stageName === 'script',
      );

      expect(latestRun?.status).toBe('failed');
      expect(latestRun?.errorType).toBe('system');
      expect(configError?.summary).toContain('已禁用 mock');
      expect(scriptTasks).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
