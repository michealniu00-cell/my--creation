import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  artifactRepository,
  jobRepository,
  readDb,
} from '@video-agent-studio/db';
import {
  createWorkflowJobHandlers,
  DurableJobRunner,
} from '@video-agent-studio/worker';
import { POST } from './route';
import { createTempApiTestEnv, getDemoProject } from '../../../test-helpers';

describe('POST /api/key-elements/[artifactGroupId]/regenerate', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-key-element-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('enqueues key-element generation and publishes a new immutable version in the worker', async () => {
    const project = await getDemoProject();
    const db = await readDb();
    const group = db.artifactGroups.find(
      (candidate) =>
        candidate.projectId === project.id &&
        candidate.scopeType === 'project' &&
        candidate.role === 'character_ref',
    );
    expect(group).toBeTruthy();
    const before = await artifactRepository.getVersions(group!.id);

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'key-element-regeneration-command',
        },
        body: JSON.stringify({ promptHint: 'blue travel jacket' }),
      }),
      { params: Promise.resolve({ artifactGroupId: group!.id }) },
    );
    const payload = (await response.json()) as {
      data: { jobId: string; taskId: string; status: string };
    };

    expect(response.status).toBe(202);
    expect(payload.data.status).toBe('queued');
    expect(
      (await jobRepository.get(payload.data.jobId))?.payload,
    ).toMatchObject({
      action: 'regenerate_key_element',
      artifactGroupId: group!.id,
    });
    expect(
      (await artifactRepository.getVersions(group!.id)).versions,
    ).toHaveLength(before.versions.length + 1);

    const outcome = await new DurableJobRunner({
      workerId: 'key-element-route-test-worker',
      handlers: createWorkflowJobHandlers(),
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
    }).runOnce();
    expect(outcome.state).toBe('succeeded');
    const completed = await artifactRepository.getVersions(group!.id);
    expect(completed.group?.activeVersionId).toBe(payload.data.taskId);
    expect(
      completed.versions.find((version) => version.id === payload.data.taskId)
        ?.status,
    ).toBe('generated');
  });
});
