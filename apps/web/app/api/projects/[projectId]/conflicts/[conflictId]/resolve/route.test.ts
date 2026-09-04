import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  controlPlaneRepository,
  projectRepository,
  readDb,
} from '@video-agent-studio/db';
import {
  createTempApiTestEnv,
  getDemoProject,
  getDemoShot,
} from '../../../../../test-helpers';
import { POST as legacyResolve } from '../../../../../conflicts/[conflictId]/resolve/route';
import { POST as resolveForProject } from './route';

function request(resolution = '用户确认继续') {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resolution }),
  });
}

describe('project-scoped conflict resolution', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-conflict-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => cleanup());

  it('rejects the global write endpoint', async () => {
    const response = await legacyResolve(request(), {
      params: Promise.resolve({ conflictId: 'conflict-1' }),
    });
    expect(response.status).toBe(410);
  });

  it('cannot resolve a conflict through a different project scope', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    const impact = await controlPlaneRepository.analyzeImpact(project.id, {
      objectType: 'shot',
      objectId: shot.id,
      changeType: 'regenerate',
    });
    expect(impact?.conflictId).toBeTruthy();

    const wrongScope = await resolveForProject(request(), {
      params: Promise.resolve({
        projectId: 'another-project',
        conflictId: impact!.conflictId!,
      }),
    });
    expect(wrongScope.status).toBe(404);

    const correctScope = await resolveForProject(request(), {
      params: Promise.resolve({
        projectId: project.id,
        conflictId: impact!.conflictId!,
      }),
    });
    expect(correctScope.status).toBe(200);

    const db = await readDb();
    const auditEvents = db.taskEvents.filter(
      (event) =>
        event.projectId === project.id &&
        [
          'conflict_detected',
          'control_plane_impact_analyzed',
          'conflict_resolved',
          'control_plane_command_recorded',
        ].includes(event.eventType),
    );
    expect(auditEvents).toHaveLength(4);
    expect(
      db.outboxEvents.filter((outbox) =>
        auditEvents.some((event) => event.id === outbox.aggregateId),
      ),
    ).toHaveLength(4);
  });

  it('cannot analyze a target through a different project scope', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    const otherProject = await projectRepository.create({
      title: 'Other project',
      sourceIdea: 'Cross-project impact analysis guard',
      targetPlatform: 'test',
      language: 'zh-CN',
    });

    await expect(
      controlPlaneRepository.analyzeImpact(otherProject.id, {
        objectType: 'shot',
        objectId: shot.id,
        changeType: 'regenerate',
      }),
    ).resolves.toBeNull();
  });
});
