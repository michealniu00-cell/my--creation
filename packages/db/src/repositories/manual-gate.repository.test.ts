import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDb, mutateDb, readDb } from '../dev-file-db';
import { manualGateRepository } from './manual-gate.repository';

describe('manualGateRepository', () => {
  let tempDirectory = '';
  let projectId = '';
  let runId = '';
  let taskId = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'vas-manual-gate-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDirectory, 'db.json');
    const db = await ensureDb();
    const project = db.projects[0];
    const run = db.workflowRuns.find(
      (candidate) =>
        candidate.projectId === project.id && candidate.workflowType === 'script',
    );
    const task = db.agentTasks.find(
      (candidate) =>
        candidate.projectId === project.id && candidate.agentName === 'agent4',
    );
    if (!run || !task) throw new Error('Demo script gate fixture is incomplete');
    projectId = project.id;
    runId = run.id;
    taskId = task.id;

    await mutateDb((state) => {
      state.taskEvents = state.taskEvents.filter(
        (event) =>
          !(
            event.runId === runId &&
            (event.eventType === 'manual_gate_confirmed' ||
              event.eventType === 'workflow_state_transitioned')
          ),
      );
      state.outboxEvents = state.outboxEvents.filter(
        (event) =>
          !(event.aggregateId === runId && event.eventType === 'manual_gate_confirmed'),
      );
    });
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('atomically commits the gate, stage transition, audit events and outbox record', async () => {
    await mutateDb((db) => {
      const project = db.projects.find((candidate) => candidate.id === projectId);
      const run = db.workflowRuns.find((candidate) => candidate.id === runId);
      if (!project || !run) throw new Error('Missing test records');
      project.currentStage = 'script';
      run.status = 'reviewing';
      run.currentNode = 'script_user_confirm';
      run.finishedAt = null;
    });

    const result = await manualGateRepository.confirmFinalScript(projectId, taskId);
    expect(result).toMatchObject({
      ok: true,
      alreadyConfirmed: false,
      runId,
      taskId,
      nextStage: 'storyboard',
    });

    const db = await readDb();
    expect(db.projects.find((project) => project.id === projectId)?.currentStage).toBe(
      'storyboard',
    );
    expect(db.workflowRuns.find((run) => run.id === runId)?.status).toBe('completed');
    expect(
      db.taskEvents.filter(
        (event) => event.runId === runId && event.eventType === 'manual_gate_confirmed',
      ),
    ).toHaveLength(1);
    expect(
      db.taskEvents.filter(
        (event) =>
          event.runId === runId && event.eventType === 'workflow_state_transitioned',
      ),
    ).toHaveLength(1);
    expect(
      db.outboxEvents.filter(
        (event) =>
          event.aggregateId === runId && event.eventType === 'manual_gate_confirmed',
      ),
    ).toHaveLength(1);
  });

  it('is idempotent once persisted evidence exists', async () => {
    await manualGateRepository.confirmFinalScript(projectId, taskId);
    const replay = await manualGateRepository.confirmFinalScript(projectId, taskId);

    expect(replay).toMatchObject({ ok: true, alreadyConfirmed: true });
    const db = await readDb();
    expect(
      db.taskEvents.filter(
        (event) => event.runId === runId && event.eventType === 'manual_gate_confirmed',
      ),
    ).toHaveLength(1);
    expect(
      db.outboxEvents.filter(
        (event) =>
          event.aggregateId === runId && event.eventType === 'manual_gate_confirmed',
      ),
    ).toHaveLength(1);
  });

  it('does not trust a completed run without evidence and repairs it only after explicit confirmation', async () => {
    const before = await manualGateRepository.getScriptGateState(projectId);
    expect(before).toMatchObject({
      confirmed: false,
      inconsistentCompletedRun: true,
    });

    const result = await manualGateRepository.confirmFinalScript(projectId, taskId);
    expect(result).toMatchObject({ ok: true, alreadyConfirmed: false });
    await expect(manualGateRepository.getScriptGateState(projectId)).resolves.toMatchObject({
      confirmed: true,
      inconsistentCompletedRun: false,
    });
  });

  it('rejects an output that does not belong to the latest approved Agent4 task', async () => {
    const db = await readDb();
    const agent3Task = db.agentTasks.find(
      (task) => task.projectId === projectId && task.agentName === 'agent3',
    );
    if (!agent3Task) throw new Error('Missing Agent3 fixture');

    await expect(
      manualGateRepository.confirmFinalScript(projectId, agent3Task.id),
    ).resolves.toEqual({
      ok: false,
      reason: 'script_version_not_approved',
    });
  });

  it('requires persisted Agent1 confirmation for the exact config used by the run', async () => {
    await mutateDb((db) => {
      const activeConfig = db.projectConfigVersions.find(
        (config) => config.projectId === projectId && config.isActive,
      );
      if (!activeConfig) throw new Error('Missing active config fixture');
      activeConfig.confirmedByUser = false;
    });

    await expect(
      manualGateRepository.confirmFinalScript(projectId, taskId),
    ).resolves.toEqual({
      ok: false,
      reason: 'agent1_gate_evidence_missing',
    });

    const db = await readDb();
    expect(
      db.taskEvents.some(
        (event) => event.runId === runId && event.eventType === 'manual_gate_confirmed',
      ),
    ).toBe(false);
  });
});
