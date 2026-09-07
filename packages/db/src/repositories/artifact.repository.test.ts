import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDb, mutateDb, readDb } from '../dev-file-db';
import { lockRepository } from './lock.repository';
import {
  artifactRepository,
  type ArtifactVersionCreateInput,
} from './artifact.repository';

const versionInput = (
  groupId: string,
  note: string,
): ArtifactVersionCreateInput => ({
  groupId,
  generatedByAgent: 'agent8',
  sourceTaskId: null,
  mimeType: 'image/png',
  storageBucket: 'test',
  storagePath: `${note}.png`,
  publicUrl: `/test/${note}.png`,
  fileSizeBytes: 1,
  width: 1280,
  height: 720,
  durationMs: null,
  generationInput: { note },
  metadata: {},
  status: 'generated',
  versionNote: note,
  isPlaceholder: false,
});

describe('artifactRepository atomic activation', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(
      path.join(os.tmpdir(), 'vas-artifact-repository-test-'),
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

  async function createShotGroup() {
    const db = await readDb();
    const shot = db.shots.find(
      (candidate) =>
        candidate.status !== 'deleted' &&
        !candidate.deletedAt &&
        !db.objectLocks.some(
          (lock) =>
            lock.objectType === 'shot' &&
            lock.objectId === candidate.id &&
            lock.isActive &&
            !lock.deletedAt,
        ),
    );
    if (!shot) throw new Error('Seeded test Shot not found');
    return artifactRepository.createGroup({
      projectId: shot.projectId,
      scopeType: 'shot',
      scopeId: shot.id,
      artifactType: 'image',
      role: 'storyboard_image',
      name: 'CAS test storyboard',
      activeVersionId: null,
      status: 'active',
      isUserManaged: true,
      note: null,
    });
  }

  it('allocates unique monotonically increasing version numbers under concurrent creation', async () => {
    const group = await createShotGroup();

    const versions = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        artifactRepository.createNextVersion(
          versionInput(group.id, `parallel-${index}`),
        ),
      ),
    );

    expect(versions.every(Boolean)).toBe(true);
    expect(
      versions.map((version) => version!.versionNo).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each(['pending', 'failed', 'rejected'] as const)('never activates a %s candidate or changes current content', async (status) => {
    const group = await createShotGroup();
    const active = await artifactRepository.createNextVersion(versionInput(group.id, 'active'));
    await artifactRepository.activateVersionIfExpected(group.id, active!.id, { expectedActiveVersionId: null });
    const candidate = await artifactRepository.createNextVersion({ ...versionInput(group.id, status), status });
    const before = await artifactRepository.getGroup(group.id);
    const result = await artifactRepository.activateVersionIfExpected(group.id, candidate!.id, { expectedActiveVersionId: active!.id });
    expect(result).toMatchObject({ ok: false, reason: 'version_not_ready' });
    expect(await artifactRepository.getGroup(group.id)).toEqual(before);
    expect(await artifactRepository.activateVersion(group.id, candidate!.id)).toBeNull();
    expect((await artifactRepository.getVersions(group.id)).versions).toHaveLength(2);
  });

  it('reuses one immutable version for concurrent retries of the same provider execution', async () => {
    const group = await createShotGroup();
    const executionKey = 'job-1:storyboard:agent8:shot-1';

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        artifactRepository.createNextVersionOnce(
          executionKey,
          versionInput(group.id, 'same-execution'),
        ),
      ),
    );

    expect(new Set(results.map((result) => result.version?.id))).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0]?.version?.versionNo).toBe(1);
    expect(results[0]?.version?.generationInput.executionKey).toBe(
      executionKey,
    );
  });

  it('deduplicates the artifact group and binding during concurrent first generation', async () => {
    const groupInput = {
      projectId: 'project-first-generation',
      scopeType: 'shot' as const,
      scopeId: 'shot-first-generation',
      artifactType: 'video' as const,
      role: 'video_clip' as const,
      name: 'First generation video',
      activeVersionId: null,
      status: 'active' as const,
      isUserManaged: true,
      note: null,
    };
    const groups = await Promise.all(
      Array.from({ length: 4 }, () =>
        artifactRepository.getOrCreateGroup(groupInput),
      ),
    );
    expect(new Set(groups.map((group) => group.id))).toHaveLength(1);

    const bindingInput = {
      projectId: groupInput.projectId,
      shotId: groupInput.scopeId,
      artifactGroupId: groups[0]!.id,
      bindingRole: 'video_main' as const,
      isPrimary: true,
      influenceScope: 'current_shot' as const,
      note: null,
    };
    const bindings = await Promise.all(
      Array.from({ length: 4 }, () =>
        artifactRepository.bindAssetOnce(bindingInput),
      ),
    );
    expect(new Set(bindings.map((binding) => binding.id))).toHaveLength(1);
  });

  it('rejects a late completion after a newer task changed the active version', async () => {
    const group = await createShotGroup();
    const expectation = {
      expectedActiveVersionId: group.activeVersionId ?? null,
      expectedGroupUpdatedAt: group.updatedAt,
    };
    const olderTaskVersion = await artifactRepository.createNextVersion(
      versionInput(group.id, 'older-task'),
    );
    const newerTaskVersion = await artifactRepository.createNextVersion(
      versionInput(group.id, 'newer-task'),
    );
    expect(olderTaskVersion).toBeTruthy();
    expect(newerTaskVersion).toBeTruthy();

    const newerCommit = await artifactRepository.activateVersionIfExpected(
      group.id,
      newerTaskVersion!.id,
      expectation,
    );
    const lateOlderCommit = await artifactRepository.activateVersionIfExpected(
      group.id,
      olderTaskVersion!.id,
      expectation,
    );

    expect(newerCommit).toMatchObject({ ok: true, changed: true });
    expect(lateOlderCommit).toMatchObject({
      ok: false,
      reason: 'active_version_conflict',
      actualActiveVersionId: newerTaskVersion!.id,
    });
    expect((await artifactRepository.getGroup(group.id))?.activeVersionId).toBe(
      newerTaskVersion!.id,
    );
  });

  it('rejects activation when the group revision changed even if activeVersionId did not', async () => {
    const group = await createShotGroup();
    const candidate = await artifactRepository.createNextVersion(
      versionInput(group.id, 'revision-candidate'),
    );
    expect(candidate).toBeTruthy();

    await mutateDb((db) => {
      const current = db.artifactGroups.find((item) => item.id === group.id)!;
      current.note = 'concurrent metadata update';
      current.updatedAt = new Date(
        Date.parse(group.updatedAt) + 1000,
      ).toISOString();
    });

    const result = await artifactRepository.activateVersionIfExpected(
      group.id,
      candidate!.id,
      {
        expectedActiveVersionId: null,
        expectedGroupUpdatedAt: group.updatedAt,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'group_revision_conflict',
    });
    expect(
      (await artifactRepository.getGroup(group.id))?.activeVersionId,
    ).toBeNull();
  });

  it('checks shot, active-version, and target-version locks in the activation mutation', async () => {
    const group = await createShotGroup();
    const active = await artifactRepository.createNextVersion(
      versionInput(group.id, 'active'),
    );
    expect(active).toBeTruthy();
    const first = await artifactRepository.activateVersionIfExpected(
      group.id,
      active!.id,
      {
        expectedActiveVersionId: null,
        expectedGroupUpdatedAt: group.updatedAt,
      },
    );
    expect(first.ok).toBe(true);

    const candidate = await artifactRepository.createNextVersion(
      versionInput(group.id, 'candidate'),
    );
    expect(candidate).toBeTruthy();
    const currentGroup = await artifactRepository.getGroup(group.id);
    expect(currentGroup).toBeTruthy();

    await lockRepository.lock({
      projectId: group.projectId,
      objectType: 'artifact_version',
      objectId: active!.id,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'protect active',
      isActive: true,
    });
    const activeLocked = await artifactRepository.activateVersionIfExpected(
      group.id,
      candidate!.id,
      {
        expectedActiveVersionId: active!.id,
        expectedGroupUpdatedAt: currentGroup!.updatedAt,
      },
    );
    expect(activeLocked).toMatchObject({
      ok: false,
      reason: 'active_version_locked',
    });

    await lockRepository.unlock('artifact_version', active!.id);
    await lockRepository.lock({
      projectId: group.projectId,
      objectType: 'artifact_version',
      objectId: candidate!.id,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'protect target',
      isActive: true,
    });
    const targetLocked = await artifactRepository.activateVersionIfExpected(
      group.id,
      candidate!.id,
      {
        expectedActiveVersionId: active!.id,
        expectedGroupUpdatedAt: currentGroup!.updatedAt,
      },
    );
    expect(targetLocked).toMatchObject({
      ok: false,
      reason: 'target_version_locked',
    });

    await lockRepository.unlock('artifact_version', candidate!.id);
    await lockRepository.lock({
      projectId: group.projectId,
      objectType: 'shot',
      objectId: group.scopeId,
      lockScope: 'cascade',
      cascadeChildren: [active!.id, candidate!.id],
      lockedByUserId: null,
      lockReason: 'protect shot',
      isActive: true,
    });
    const shotLocked = await artifactRepository.activateVersionIfExpected(
      group.id,
      candidate!.id,
      {
        expectedActiveVersionId: active!.id,
        expectedGroupUpdatedAt: currentGroup!.updatedAt,
      },
    );
    expect(shotLocked).toMatchObject({ ok: false, reason: 'shot_locked' });
    expect((await artifactRepository.getGroup(group.id))?.activeVersionId).toBe(
      active!.id,
    );
  });

  it('treats retrying the already committed target as an idempotent success', async () => {
    const group = await createShotGroup();
    const candidate = await artifactRepository.createNextVersion(
      versionInput(group.id, 'idempotent'),
    );
    expect(candidate).toBeTruthy();

    const first = await artifactRepository.activateVersionIfExpected(
      group.id,
      candidate!.id,
      {
        expectedActiveVersionId: null,
        expectedGroupUpdatedAt: group.updatedAt,
      },
    );
    expect(first).toMatchObject({ ok: true, changed: true });

    await lockRepository.lock({
      projectId: group.projectId,
      objectType: 'artifact_version',
      objectId: candidate!.id,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'locked after publish',
      isActive: true,
    });
    const retry = await artifactRepository.activateVersionIfExpected(
      group.id,
      candidate!.id,
      {
        expectedActiveVersionId: null,
        expectedGroupUpdatedAt: group.updatedAt,
      },
    );

    expect(retry).toMatchObject({ ok: true, changed: false });
  });
});
