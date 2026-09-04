import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockRepository, projectRepository, shotRepository } from '@video-agent-studio/db';
import { DELETE, PATCH } from './route';
import { createTempApiTestEnv } from '../../../../test-helpers';

function patchRequest(body: unknown) {
  return new Request('http://localhost', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/projects/[projectId]/shots/[shotId] writes', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-shot-write-route-');
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

  async function createShot(projectId: string) {
    const result = await shotRepository.createForProject(projectId, {
      title: 'Original title',
      scriptSegment: 'Original script',
    });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  }

  it('does not update or delete a shot through another project path', async () => {
    const owner = await createProject('Owner');
    const other = await createProject('Other');
    const shot = await createShot(owner.id);

    const updateResponse = await PATCH(patchRequest({ title: 'Illicit' }), {
      params: Promise.resolve({ projectId: other.id, shotId: shot.id }),
    });
    const updatePayload = await updateResponse.json();
    expect(updateResponse.status).toBe(404);
    expect(updatePayload.error.details.reason).toBe('shot_project_mismatch');

    const deleteResponse = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ projectId: other.id, shotId: shot.id }),
    });
    const deletePayload = await deleteResponse.json();
    expect(deleteResponse.status).toBe(404);
    expect(deletePayload.error.details.reason).toBe('shot_project_mismatch');
    expect(await shotRepository.get(shot.id)).toMatchObject({
      projectId: owner.id,
      title: 'Original title',
    });
  });

  it('returns stable 409 lock conflicts for update and delete', async () => {
    const project = await createProject('Locked owner');
    const shot = await createShot(project.id);
    const lock = await lockRepository.lock({
      projectId: project.id,
      objectType: 'shot',
      objectId: shot.id,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'route test',
      isActive: true,
    });

    const updateResponse = await PATCH(patchRequest({ title: 'Blocked' }), {
      params: Promise.resolve({ projectId: project.id, shotId: shot.id }),
    });
    const updatePayload = await updateResponse.json();
    expect(updateResponse.status).toBe(409);
    expect(updatePayload.error.code).toBe('LOCK_CONFLICT');
    expect(updatePayload.error.details).toMatchObject({
      reason: 'shot_locked',
      shotId: shot.id,
      lockId: lock.id,
    });

    const deleteResponse = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ projectId: project.id, shotId: shot.id }),
    });
    const deletePayload = await deleteResponse.json();
    expect(deleteResponse.status).toBe(409);
    expect(deletePayload.error.code).toBe('LOCK_CONFLICT');
    expect(deletePayload.error.details.reason).toBe('shot_locked');
    expect(await shotRepository.get(shot.id)).toMatchObject({
      title: 'Original title',
    });
  });
});
