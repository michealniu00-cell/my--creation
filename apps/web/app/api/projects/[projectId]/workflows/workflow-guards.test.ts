import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  jobRepository,
  mutateDb,
  readDb,
  taskRepository,
} from '@video-agent-studio/db';
import { POST as runScript } from './script/run/route';
import { POST as runStoryboard } from './storyboard/run/route';
import { POST as runVideo } from './video/run/route';
import { POST as confirmScript } from '../script/confirm/route';
import { createTempApiTestEnv, getDemoProject } from '../../../test-helpers';

function request(body: string, idempotencyKey?: string) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body,
  });
}

describe('workflow API guards', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-workflow-guards-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('rejects malformed JSON instead of silently treating it as defaults', async () => {
    const project = await getDemoProject();
    const context = { params: Promise.resolve({ projectId: project.id }) };

    const responses = await Promise.all([
      runScript(request('{'), context),
      runStoryboard(request('{'), context),
      runVideo(request('{'), context),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      400, 400, 400,
    ]);
  });

  it('requires explicit confirmation for full-project video regeneration', async () => {
    const project = await getDemoProject();
    const response = await runVideo(request(JSON.stringify({ mode: 'all' })), {
      params: Promise.resolve({ projectId: project.id }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_WORKFLOW_INPUT');
  });

  it('accepts the explicit full-project confirmation before checking prerequisites', async () => {
    const project = await getDemoProject();
    const response = await runVideo(
      request(
        JSON.stringify({ mode: 'all', confirmFullProjectRegeneration: true }),
      ),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('WORKFLOW_PREREQUISITE_REQUIRED');
  });

  it('requires at least one Shot for selected-shot video generation', async () => {
    const project = await getDemoProject();
    const response = await runVideo(
      request(JSON.stringify({ mode: 'selected_shots', selectedShotIds: [] })),
      { params: Promise.resolve({ projectId: project.id }) },
    );

    expect(response.status).toBe(400);
  });

  it('requires explicit confirmation before rerunning a stage with historical runs', async () => {
    const project = await getDemoProject();
    const context = { params: Promise.resolve({ projectId: project.id }) };
    const [agent4Task] = await taskRepository.listByProjectAndAgent(
      project.id,
      'agent4',
    );
    expect(agent4Task).toBeTruthy();
    const gateResponse = await confirmScript(
      request(JSON.stringify({ taskId: agent4Task.id })),
      context,
    );
    expect(gateResponse.status).toBe(200);
    const [scriptResponse, storyboardResponse] = await Promise.all([
      runScript(request(JSON.stringify({ startFromNode: 'agent2' })), context),
      runStoryboard(
        request(JSON.stringify({ startFromNode: 'agent6' })),
        context,
      ),
    ]);
    const [scriptPayload, storyboardPayload] = await Promise.all([
      scriptResponse.json(),
      storyboardResponse.json(),
    ]);

    expect(scriptResponse.status).toBe(409);
    expect(scriptPayload.error.code).toBe(
      'STAGE_REGENERATION_CONFIRMATION_REQUIRED',
    );
    expect(storyboardResponse.status).toBe(409);
    expect(storyboardPayload.error.code).toBe(
      'STAGE_REGENERATION_CONFIRMATION_REQUIRED',
    );
  });

  it('requires script-stage confirmation when outputs exist even if run history is missing', async () => {
    const project = await getDemoProject();
    await mutateDb((db) => {
      db.workflowRuns = db.workflowRuns.filter(
        (run) =>
          !(run.projectId === project.id && run.workflowType === 'script'),
      );
    });

    const response = await runScript(
      request(JSON.stringify({ startFromNode: 'agent2' })),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('STAGE_REGENERATION_CONFIRMATION_REQUIRED');
  });

  it('requires storyboard-stage confirmation when Shot outputs exist without run history', async () => {
    const project = await getDemoProject();
    await mutateDb((db) => {
      db.workflowRuns = db.workflowRuns.filter(
        (run) =>
          !(run.projectId === project.id && run.workflowType === 'storyboard'),
      );
      db.agentTasks = db.agentTasks.filter(
        (task) => task.stageName !== 'storyboard',
      );
    });

    const response = await runStoryboard(
      request(JSON.stringify({ startFromNode: 'agent6' })),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('STAGE_REGENERATION_CONFIRMATION_REQUIRED');
  });

  it('only enqueues a confirmed stage rerun and deduplicates the HTTP command', async () => {
    const project = await getDemoProject();
    const context = { params: Promise.resolve({ projectId: project.id }) };
    const beforeRunCount = (await readDb()).workflowRuns.length;
    const body = JSON.stringify({
      startFromNode: 'agent2',
      confirmStageRegeneration: true,
    });
    const first = await runScript(
      request(body, 'script-rerun-command'),
      context,
    );
    const firstPayload = await first.json();
    const replay = await runScript(
      request(body, 'script-rerun-command'),
      context,
    );
    const replayPayload = await replay.json();

    expect(first.status).toBe(202);
    expect(firstPayload.data.status).toBe('queued');
    expect(replay.status).toBe(200);
    expect(replayPayload.data.jobId).toBe(firstPayload.data.jobId);
    expect(replayPayload.data.deduplicated).toBe(true);
    expect((await readDb()).workflowRuns).toHaveLength(beforeRunCount);
    expect((await jobRepository.get(firstPayload.data.jobId))?.status).toBe(
      'queued',
    );
  });

  it('enqueues video generation after prerequisites without running it in the HTTP request', async () => {
    const project = await getDemoProject();
    await mutateDb((db) => {
      const storyboardRun = db.workflowRuns.find(
        (run) =>
          run.projectId === project.id && run.workflowType === 'storyboard',
      );
      if (storyboardRun) storyboardRun.status = 'completed';
    });
    const beforeRunCount = (await readDb()).workflowRuns.length;
    const response = await runVideo(
      request(
        JSON.stringify({ mode: 'missing_only' }),
        'video-missing-command',
      ),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.data.status).toBe('queued');
    expect((await readDb()).workflowRuns).toHaveLength(beforeRunCount);
    expect((await jobRepository.get(payload.data.jobId))?.payload).toEqual({
      mode: 'missing_only',
    });
  });

  it('recognizes the seeded latest approved Agent4 confirmation and stays idempotent', async () => {
    const project = await getDemoProject();
    const [agent4Task] = await taskRepository.listByProjectAndAgent(
      project.id,
      'agent4',
    );
    expect(agent4Task).toBeTruthy();

    const response = await confirmScript(
      request(JSON.stringify({ taskId: agent4Task.id })),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );
    const payload = await response.json();
    const replay = await confirmScript(
      request(JSON.stringify({ taskId: agent4Task.id })),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );
    const replayPayload = await replay.json();

    expect(response.status).toBe(200);
    expect(payload.data.confirmed).toBe(true);
    expect(payload.data.alreadyConfirmed).toBe(true);
    expect(replay.status).toBe(200);
    expect(replayPayload.data.alreadyConfirmed).toBe(true);
    const db = await readDb();
    expect(
      db.taskEvents.filter(
        (event) =>
          event.runId === payload.data.runId &&
          event.eventType === 'manual_gate_confirmed',
      ),
    ).toHaveLength(1);
    expect(
      db.outboxEvents.filter(
        (event) =>
          event.aggregateId === payload.data.runId &&
          event.eventType === 'manual_gate_confirmed',
      ),
    ).toHaveLength(1);
  });

  it('rejects a task that is not an approved Agent4 final script', async () => {
    const project = await getDemoProject();
    const [agent3Task] = await taskRepository.listByProjectAndAgent(
      project.id,
      'agent3',
    );
    expect(agent3Task).toBeTruthy();

    const response = await confirmScript(
      request(JSON.stringify({ taskId: agent3Task.id })),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('SCRIPT_VERSION_NOT_APPROVED');
  });
});
