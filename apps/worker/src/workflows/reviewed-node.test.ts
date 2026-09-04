import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('@video-agent-studio/agents', () => ({
  executeAgent: vi.fn(async () => {
    throw new Error(
      'MiniMax request failed (401): {"type":"error","error":{"type":"authorized_error","message":"invalid api key (2049)","http_code":"401"}}',
    );
  }),
}));

import { executeAgent } from '@video-agent-studio/agents';
import { ensureDb, projectRepository, readDb, runRepository } from '@video-agent-studio/db';
import { runReviewedNode } from './reviewed-node';

describe('runReviewedNode', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'vas-reviewed-node-test-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDir, 'db.json');
    await ensureDb();
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    vi.clearAllMocks();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns system execution errors without mutating engine-owned run state', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const run = await runRepository.create(project.id, {
      workflowType: 'script',
      triggerMode: 'manual',
      startFromNode: 'agent2',
      endAtNode: 'script_user_confirm',
      currentNode: 'agent2',
      runReason: 'test system error propagation',
    });

    const signal = new AbortController().signal;
    const result = await runReviewedNode({
      runId: run.id,
      projectId: project.id,
      stageName: 'script',
      projectTitle: project.title,
      sourceIdea: project.sourceIdea,
      agentName: 'agent2',
      inputPayload: {},
      startNode: 'agent2',
      reviewNode: 'agent2_review',
      signal,
      idempotencyKey: 'job-1:script:agent2',
    });

    const db = await readDb();
    const latestRun = db.workflowRuns.find((item) => item.id === run.id);
    const failureEvent = db.taskEvents.find(
      (event) =>
        event.projectId === project.id &&
        event.runId === run.id &&
        event.eventType === 'task_failed',
    );

    expect(result.approved).toBe(false);
    expect(result.errorType).toBe('system');
    expect(result.errorMessage).toContain('invalid api key');
    expect(latestRun).toMatchObject({
      currentNode: 'agent2',
      status: 'running',
      errorType: null,
      errorMessage: null,
    });
    expect(failureEvent?.eventPayload.message).toContain('invalid api key');
    expect(vi.mocked(executeAgent)).toHaveBeenCalledWith(
      expect.objectContaining({
        signal,
        idempotencyKey: 'job-1:script:agent2:agent2:round-1',
      }),
    );
  });

  it('honors durable cancellation before invoking an Agent provider', async () => {
    const project = (await projectRepository.list())[0];
    const run = await runRepository.create(project.id, {
      workflowType: 'script',
      triggerMode: 'manual',
      startFromNode: 'agent2',
      endAtNode: 'script_user_confirm',
      currentNode: 'agent2',
      runReason: 'test cancellation propagation',
    });
    const controller = new AbortController();
    controller.abort(new Error('job cancelled'));

    await expect(
      runReviewedNode({
        runId: run.id,
        projectId: project.id,
        stageName: 'script',
        projectTitle: project.title,
        sourceIdea: project.sourceIdea,
        agentName: 'agent2',
        inputPayload: {},
        signal: controller.signal,
        idempotencyKey: 'job-cancelled',
      }),
    ).rejects.toThrow('job cancelled');
    expect(vi.mocked(executeAgent)).not.toHaveBeenCalled();
  });
});
