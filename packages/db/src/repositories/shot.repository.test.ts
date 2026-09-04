import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDb } from '../dev-file-db';
import { artifactRepository } from './artifact.repository';
import { lockRepository } from './lock.repository';
import { projectRepository } from './project.repository';
import { shotRepository } from './shot.repository';

describe('shotRepository guarded writes', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(
      path.join(os.tmpdir(), 'vas-shot-repository-test-'),
    );
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDir, 'db.json');
    await ensureDb();
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProject(label: string) {
    return projectRepository.create({
      title: `Shot repository ${label}`,
      sourceIdea: 'Repository guard test',
      targetPlatform: null,
      language: 'zh-CN',
    });
  }

  async function createShot(projectId: string, label: string) {
    const result = await shotRepository.createForProject(projectId, {
      title: label,
      scriptSegment: `${label} script`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Failed to create fixture shot: ${result.reason}`);
    }
    return result.value;
  }

  async function lockShot(projectId: string, shotId: string) {
    return lockRepository.lock({
      projectId,
      objectType: 'shot',
      objectId: shotId,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'repository test lock',
      isActive: true,
    });
  }

  it('allocates unique indices for concurrent creates in one project', async () => {
    const project = await createProject('concurrent');

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        shotRepository.createForProject(project.id, {
          title: `Concurrent ${index + 1}`,
          scriptSegment: `Shot ${index + 1}`,
        }),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const shots = await shotRepository.list(project.id, false);
    expect(shots.map((shot) => shot.shotIndexGlobal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(new Set(shots.map((shot) => shot.id))).toHaveLength(8);
  });

  it('rejects missing projects and cross-project shot references without mutating data', async () => {
    const projectA = await createProject('owner-a');
    const projectB = await createProject('owner-b');
    const foreignShot = await createShot(projectB.id, 'Foreign shot');

    const missingProjectCreate = await shotRepository.createForProject(
      'missing-project',
      { title: 'Should not exist', scriptSegment: 'No project' },
    );
    expect(missingProjectCreate).toMatchObject({
      ok: false,
      reason: 'project_not_found',
    });

    const crossProjectInsert = await shotRepository.createForProject(
      projectA.id,
      { title: 'Cross project insert', scriptSegment: 'Invalid anchor' },
      foreignShot.id,
    );
    expect(crossProjectInsert).toMatchObject({
      ok: false,
      reason: 'insert_after_shot_project_mismatch',
      shotId: foreignShot.id,
    });

    const crossProjectUpdate = await shotRepository.updateForProject(
      projectA.id,
      foreignShot.id,
      { title: 'Illicit update' },
    );
    expect(crossProjectUpdate).toMatchObject({
      ok: false,
      reason: 'shot_project_mismatch',
      shotId: foreignShot.id,
    });

    const crossProjectDelete = await shotRepository.softDeleteForProject(
      projectA.id,
      foreignShot.id,
    );
    expect(crossProjectDelete).toMatchObject({
      ok: false,
      reason: 'shot_project_mismatch',
      shotId: foreignShot.id,
    });

    expect(await shotRepository.list(projectA.id, false)).toHaveLength(0);
    expect(await shotRepository.get(foreignShot.id)).toMatchObject({
      projectId: projectB.id,
      title: 'Foreign shot',
    });
  });

  it('rechecks the lock in the committing mutation for update, delete, create, and reorder', async () => {
    const project = await createProject('lock');
    const first = await createShot(project.id, 'First');
    const second = await createShot(project.id, 'Second');

    expect(await lockRepository.isLocked('shot', first.id)).toBe(false);
    const lock = await lockShot(project.id, first.id);

    const update = await shotRepository.updateForProject(project.id, first.id, {
      title: 'Overwritten',
    });
    expect(update).toMatchObject({
      ok: false,
      reason: 'shot_locked',
      shotId: first.id,
      lockId: lock.id,
    });

    const deletion = await shotRepository.softDeleteForProject(
      project.id,
      first.id,
    );
    expect(deletion).toMatchObject({
      ok: false,
      reason: 'shot_locked',
      shotId: first.id,
      lockId: lock.id,
    });

    const insertion = await shotRepository.createForProject(
      project.id,
      { title: 'Blocked insert', scriptSegment: 'Locked anchor' },
      first.id,
    );
    expect(insertion).toMatchObject({
      ok: false,
      reason: 'shot_locked',
      shotId: first.id,
      lockId: lock.id,
    });

    const reorder = await shotRepository.reorderForProject(project.id, [
      second.id,
      first.id,
    ]);
    expect(reorder).toMatchObject({
      ok: false,
      reason: 'shot_locked',
      shotId: first.id,
      lockId: lock.id,
    });

    expect(await shotRepository.get(first.id)).toMatchObject({
      title: 'First',
    });
    const shots = await shotRepository.list(project.id, false);
    expect(shots.map((shot) => shot.id)).toEqual([first.id, second.id]);

    await lockRepository.unlock('shot', first.id);
    const shiftedLock = await lockShot(project.id, second.id);
    const shiftedInsertion = await shotRepository.createForProject(
      project.id,
      { title: 'Blocked shift', scriptSegment: 'Locked shifted shot' },
      first.id,
    );
    expect(shiftedInsertion).toMatchObject({
      ok: false,
      reason: 'shot_locked',
      shotId: second.id,
      lockId: shiftedLock.id,
    });
  });

  it('requires reorder to be the exact duplicate-free set of active project shots', async () => {
    const project = await createProject('reorder');
    const otherProject = await createProject('reorder-foreign');
    const first = await createShot(project.id, 'First');
    const second = await createShot(project.id, 'Second');
    const third = await createShot(project.id, 'Third');
    const foreign = await createShot(otherProject.id, 'Foreign');
    const originalOrder = [first.id, second.id, third.id];

    const duplicate = await shotRepository.reorderForProject(project.id, [
      first.id,
      first.id,
      third.id,
    ]);
    expect(duplicate).toMatchObject({
      ok: false,
      reason: 'duplicate_shot_ids',
    });

    const missing = await shotRepository.reorderForProject(project.id, [
      first.id,
      second.id,
    ]);
    expect(missing).toMatchObject({
      ok: false,
      reason: 'reorder_set_mismatch',
    });

    const extra = await shotRepository.reorderForProject(project.id, [
      ...originalOrder,
      'missing-shot',
    ]);
    expect(extra).toMatchObject({
      ok: false,
      reason: 'reorder_set_mismatch',
    });

    const crossProject = await shotRepository.reorderForProject(project.id, [
      first.id,
      second.id,
      foreign.id,
    ]);
    expect(crossProject).toMatchObject({
      ok: false,
      reason: 'shot_project_mismatch',
      shotId: foreign.id,
    });

    expect(
      (await shotRepository.list(project.id, false)).map((shot) => shot.id),
    ).toEqual(originalOrder);

    const valid = await shotRepository.reorderForProject(
      project.id,
      [...originalOrder].reverse(),
    );
    expect(valid).toMatchObject({ ok: true });
    expect(
      (await shotRepository.list(project.id, false)).map((shot) => shot.id),
    ).toEqual([...originalOrder].reverse());
  });

  it('does not allow runtime patches to change shot ownership or audited identity', async () => {
    const project = await createProject('immutable');
    const otherProject = await createProject('immutable-other');
    const shot = await createShot(project.id, 'Owned shot');

    const result = await shotRepository.updateForProject(project.id, shot.id, {
      projectId: otherProject.id,
      id: 'replacement-id',
      deletedAt: new Date().toISOString(),
      title: 'Safe field changed',
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(await shotRepository.get(shot.id)).toMatchObject({
      id: shot.id,
      projectId: project.id,
      deletedAt: null,
      title: 'Safe field changed',
    });
    expect(await shotRepository.get('replacement-id')).toBeNull();
  });

  it('surfaces orphaned pending media as recoverable failure instead of polling forever', async () => {
    const project = await createProject('orphaned-pending');
    const shot = await createShot(project.id, 'Orphaned pending shot');
    const group = await artifactRepository.createGroup({
      projectId: project.id,
      scopeType: 'shot',
      scopeId: shot.id,
      artifactType: 'image',
      role: 'storyboard_image',
      name: 'Orphaned storyboard',
      activeVersionId: null,
      status: 'active',
      isUserManaged: true,
      note: null,
    });
    await artifactRepository.bindAssetOnce({
      projectId: project.id,
      shotId: shot.id,
      artifactGroupId: group.id,
      bindingRole: 'storyboard_main',
      isPrimary: true,
      influenceScope: 'current_shot',
      note: null,
    });
    await artifactRepository.createNextVersion({
      groupId: group.id,
      generatedByAgent: 'agent8',
      sourceTaskId: null,
      mimeType: 'image/png',
      storageBucket: null,
      storagePath: null,
      publicUrl: null,
      fileSizeBytes: null,
      width: 1280,
      height: 720,
      durationMs: null,
      generationInput: { jobId: 'missing-job' },
      metadata: {},
      status: 'pending',
      versionNote: 'legacy pending candidate',
      isPlaceholder: false,
    });

    const enriched = await shotRepository.list(project.id, true);
    expect(enriched[0]).toMatchObject({
      assets: {
        storyboardMain: {
          processingVersion: {
            status: 'failed',
            jobUnavailable: true,
            error: expect.stringContaining('原后台任务记录不可用'),
          },
        },
      },
    });
  });
});
