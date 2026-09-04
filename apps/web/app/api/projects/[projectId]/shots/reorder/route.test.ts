import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockRepository, projectRepository, shotRepository } from '@video-agent-studio/db';
import { POST } from './route';
import { createTempApiTestEnv } from '../../../../test-helpers';

function request(orderedShotIds: string[]) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderedShotIds }),
  });
}

describe('POST /api/projects/[projectId]/shots/reorder', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-shot-reorder-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  async function createProject(label: string) {
    return projectRepository.create({
      title: label,
      sourceIdea: 'Shot route test',
      targetPlatform: null,
      language: 'zh-CN',
    });
  }

  async function createShot(projectId: string, title: string) {
    const result = await shotRepository.createForProject(projectId, {
      title,
      scriptSegment: title,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  }

  it('accepts the empty exact set for a project with no active shots', async () => {
    const project = await createProject('Empty');
    const response = await POST(request([]), {
      params: Promise.resolve({ projectId: project.id }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data.updated).toBe(true);
  });

  it('rejects missing, extra, and cross-project reorder members', async () => {
    const project = await createProject('Target');
    const other = await createProject('Other');
    const first = await createShot(project.id, 'First');
    const second = await createShot(project.id, 'Second');
    const foreign = await createShot(other.id, 'Foreign');

    const missingResponse = await POST(request([first.id]), {
      params: Promise.resolve({ projectId: project.id }),
    });
    const missingPayload = await missingResponse.json();
    expect(missingResponse.status).toBe(400);
    expect(missingPayload.error.code).toBe('INVALID_SHOT_ORDER');
    expect(missingPayload.error.details.reason).toBe('reorder_set_mismatch');

    const extraResponse = await POST(
      request([first.id, second.id, 'missing-shot']),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(extraResponse.status).toBe(400);
    expect((await extraResponse.json()).error.details.reason).toBe(
      'reorder_set_mismatch',
    );

    const foreignResponse = await POST(request([first.id, foreign.id]), {
      params: Promise.resolve({ projectId: project.id }),
    });
    const foreignPayload = await foreignResponse.json();
    expect(foreignResponse.status).toBe(404);
    expect(foreignPayload.error.details.reason).toBe('shot_project_mismatch');

    expect(
      (await shotRepository.list(project.id, false)).map((shot) => shot.id),
    ).toEqual([first.id, second.id]);
  });

  it('maps a locked member to 409 and preserves the full order', async () => {
    const project = await createProject('Locked order');
    const first = await createShot(project.id, 'First');
    const second = await createShot(project.id, 'Second');
    const lock = await lockRepository.lock({
      projectId: project.id,
      objectType: 'shot',
      objectId: first.id,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'route test',
      isActive: true,
    });

    const response = await POST(request([second.id, first.id]), {
      params: Promise.resolve({ projectId: project.id }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('LOCK_CONFLICT');
    expect(payload.error.details).toMatchObject({
      reason: 'shot_locked',
      shotId: first.id,
      lockId: lock.id,
    });
    expect(
      (await shotRepository.list(project.id, false)).map((shot) => shot.id),
    ).toEqual([first.id, second.id]);
  });
});
