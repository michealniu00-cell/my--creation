import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockRepository, projectRepository, shotRepository } from '@video-agent-studio/db';
import { POST } from './route';
import { createTempApiTestEnv } from '../../../test-helpers';

function request(body: unknown) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/[projectId]/shots', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-shot-create-route-');
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

  it('returns 404 when the path project does not exist', async () => {
    const response = await POST(
      request({ title: 'No project', scriptSegment: 'No project' }),
      { params: Promise.resolve({ projectId: 'missing-project' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe('PROJECT_NOT_FOUND');
    expect(payload.error.details.reason).toBe('project_not_found');
  });

  it('rejects a cross-project insertion anchor', async () => {
    const project = await createProject('Target');
    const otherProject = await createProject('Other');
    const foreignShot = await createShot(otherProject.id, 'Foreign');

    const response = await POST(
      request({
        insertAfterShotId: foreignShot.id,
        title: 'Invalid insertion',
        scriptSegment: 'Invalid insertion',
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe('SHOT_NOT_FOUND');
    expect(payload.error.details.reason).toBe(
      'insert_after_shot_project_mismatch',
    );
    expect(await shotRepository.list(project.id, false)).toHaveLength(0);
  });

  it('maps a commit-time shot lock to a stable 409 response', async () => {
    const project = await createProject('Locked insertion');
    const anchor = await createShot(project.id, 'Anchor');
    const lock = await lockRepository.lock({
      projectId: project.id,
      objectType: 'shot',
      objectId: anchor.id,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'route test',
      isActive: true,
    });

    const response = await POST(
      request({
        insertAfterShotId: anchor.id,
        title: 'Blocked insertion',
        scriptSegment: 'Blocked insertion',
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('LOCK_CONFLICT');
    expect(payload.error.details).toMatchObject({
      reason: 'shot_locked',
      shotId: anchor.id,
      lockId: lock.id,
    });
    expect(await shotRepository.list(project.id, false)).toHaveLength(1);
  });
});
