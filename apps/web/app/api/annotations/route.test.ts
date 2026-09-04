import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectRepository, readDb } from '@video-agent-studio/db';
import {
  createTempApiTestEnv,
  getDemoProject,
  getDemoShot,
} from '../test-helpers';
import { GET, POST } from './route';

function createAnnotation(body: unknown) {
  return new Request('http://localhost/api/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('annotation API project ownership', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-annotation-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => cleanup());

  it('requires a project scope when listing annotations', async () => {
    const response = await GET(
      new Request('http://localhost/api/annotations?objectType=shot'),
    );
    expect(response.status).toBe(400);
  });

  it('rejects an annotation target owned by another project', async () => {
    const sourceProject = await getDemoProject();
    const sourceShot = await getDemoShot(sourceProject.id);
    const otherProject = await projectRepository.create({
      title: 'Other project',
      sourceIdea: 'Ownership boundary test',
      targetPlatform: 'test',
      language: 'zh-CN',
    });

    const response = await POST(
      createAnnotation({
        projectId: otherProject.id,
        objectType: 'shot',
        objectId: sourceShot.id,
        noteType: 'comment',
        content: 'Must not cross the project boundary',
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: 'ANNOTATION_TARGET_NOT_FOUND',
        details: { reason: 'object_project_mismatch' },
      },
    });
  });

  it('creates and lists an annotation only within its owning project', async () => {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    const created = await POST(
      createAnnotation({
        projectId: project.id,
        objectType: 'shot',
        objectId: shot.id,
        noteType: 'comment',
        content: 'Keep this camera move',
      }),
    );
    expect(created.status).toBe(200);

    const listed = await GET(
      new Request(
        `http://localhost/api/annotations?projectId=${project.id}&objectType=shot&objectId=${shot.id}`,
      ),
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      success: true,
      data: {
        items: [
          {
            projectId: project.id,
            objectType: 'shot',
            objectId: shot.id,
            content: 'Keep this camera move',
          },
        ],
      },
    });

    const db = await readDb();
    const auditEvents = db.taskEvents.filter(
      (event) =>
        event.projectId === project.id &&
        ['annotation_created', 'control_plane_command_recorded'].includes(
          event.eventType,
        ),
    );
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents.map((event) => event.userVisible).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      db.outboxEvents.filter((event) =>
        auditEvents.some((auditEvent) => auditEvent.id === event.aggregateId),
      ),
    ).toHaveLength(2);
  });
});
