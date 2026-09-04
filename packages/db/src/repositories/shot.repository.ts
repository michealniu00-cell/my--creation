import type { ShotRecord, ShotWithAssets } from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';
import type { DatabaseState } from '../types';

export type ShotMutationFailureReason =
  | 'project_not_found'
  | 'shot_not_found'
  | 'shot_project_mismatch'
  | 'insert_after_shot_not_found'
  | 'insert_after_shot_project_mismatch'
  | 'shot_locked'
  | 'duplicate_shot_ids'
  | 'reorder_set_mismatch';

export type ShotMutationFailure = {
  ok: false;
  reason: ShotMutationFailureReason;
  projectId: string;
  shotId?: string;
  actualProjectId?: string;
  lockId?: string | null;
  expectedShotIds?: string[];
  receivedShotIds?: string[];
};

export type ShotMutationResult<T> =
  | { ok: true; value: T }
  | ShotMutationFailure;

type ShotCreateInput = Partial<ShotRecord> &
  Pick<ShotRecord, 'title' | 'scriptSegment'>;

type ShotUpdatePatch = Partial<
  Omit<ShotRecord, 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'deletedAt'>
>;

function writableShotPatch(patch: Partial<ShotRecord>): ShotUpdatePatch {
  const {
    id: _id,
    projectId: _projectId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    deletedAt: _deletedAt,
    ...writable
  } = patch;
  return writable;
}

function activeProject(db: DatabaseState, projectId: string) {
  return db.projects.find(
    (project) => project.id === projectId && !project.deletedAt,
  );
}

function activeShot(db: DatabaseState, shotId: string) {
  return db.shots.find(
    (shot) =>
      shot.id === shotId && shot.status !== 'deleted' && !shot.deletedAt,
  );
}

function activeShotLock(db: DatabaseState, shotId: string) {
  return db.objectLocks.find(
    (lock) =>
      lock.objectType === 'shot' &&
      lock.objectId === shotId &&
      lock.isActive &&
      !lock.deletedAt,
  );
}

function failure(
  projectId: string,
  reason: ShotMutationFailureReason,
  details: Omit<ShotMutationFailure, 'ok' | 'reason' | 'projectId'> = {},
): ShotMutationFailure {
  return { ok: false, reason, projectId, ...details };
}

async function createForProject(
  projectId: string,
  input: ShotCreateInput,
  insertAfterShotId?: string,
): Promise<ShotMutationResult<ShotRecord>> {
  return mutateDb((db) => {
    if (!activeProject(db, projectId)) {
      return failure(projectId, 'project_not_found');
    }

    const projectShots = db.shots
      .filter(
        (item) =>
          item.projectId === projectId &&
          item.status !== 'deleted' &&
          !item.deletedAt,
      )
      .sort((a, b) => a.shotIndexGlobal - b.shotIndexGlobal);

    let insertIndex =
      projectShots.reduce(
        (highest, shot) => Math.max(highest, shot.shotIndexGlobal),
        0,
      ) + 1;

    if (insertAfterShotId) {
      const anchor = activeShot(db, insertAfterShotId);
      if (!anchor) {
        return failure(projectId, 'insert_after_shot_not_found', {
          shotId: insertAfterShotId,
        });
      }
      if (anchor.projectId !== projectId) {
        return failure(projectId, 'insert_after_shot_project_mismatch', {
          shotId: insertAfterShotId,
          actualProjectId: anchor.projectId,
        });
      }

      const anchorLock = activeShotLock(db, anchor.id);
      if (anchorLock) {
        return failure(projectId, 'shot_locked', {
          shotId: anchor.id,
          lockId: anchorLock.id,
        });
      }
      insertIndex = anchor.shotIndexGlobal + 1;
    }

    const shiftedShots = projectShots.filter(
      (shot) => shot.shotIndexGlobal >= insertIndex,
    );
    for (const shiftedShot of shiftedShots) {
      const lock = activeShotLock(db, shiftedShot.id);
      if (lock) {
        return failure(projectId, 'shot_locked', {
          shotId: shiftedShot.id,
          lockId: lock.id,
        });
      }
    }

    const now = timestamp();
    for (const shiftedShot of shiftedShots) {
      shiftedShot.shotIndexGlobal += 1;
      shiftedShot.updatedAt = now;
    }

    const shot = audited<ShotRecord>({
      id: id(),
      projectId,
      sceneId: input.sceneId ?? projectShots.at(-1)?.sceneId ?? null,
      sourceTaskId: input.sourceTaskId ?? null,
      shotIndexGlobal: insertIndex,
      shotIndexInScene: input.shotIndexInScene ?? null,
      title: input.title,
      scriptSegment: input.scriptSegment,
      sceneDesc: input.sceneDesc ?? null,
      subjectDesc: input.subjectDesc ?? null,
      actionDesc: input.actionDesc ?? null,
      moodDesc: input.moodDesc ?? null,
      continuityNotes: input.continuityNotes ?? null,
      visualPrompt: input.visualPrompt ?? null,
      lighting: input.lighting ?? null,
      cameraMotion: input.cameraMotion ?? null,
      compositionNotes: input.compositionNotes ?? null,
      styleNotes: input.styleNotes ?? null,
      status: input.status ?? 'active',
      isUserAdded: input.isUserAdded ?? true,
      sortVersion: 1,
      note: input.note ?? null,
    });

    db.shots.push(shot);
    return { ok: true as const, value: shot };
  });
}

async function updateForProject(
  projectId: string,
  shotId: string,
  patch: ShotUpdatePatch,
): Promise<ShotMutationResult<ShotRecord>> {
  return mutateDb((db) => {
    if (!activeProject(db, projectId)) {
      return failure(projectId, 'project_not_found');
    }

    const shot = activeShot(db, shotId);
    if (!shot) {
      return failure(projectId, 'shot_not_found', { shotId });
    }
    if (shot.projectId !== projectId) {
      return failure(projectId, 'shot_project_mismatch', {
        shotId,
        actualProjectId: shot.projectId,
      });
    }

    const lock = activeShotLock(db, shotId);
    if (lock) {
      return failure(projectId, 'shot_locked', {
        shotId,
        lockId: lock.id,
      });
    }

    Object.assign(shot, writableShotPatch(patch), {
      updatedAt: timestamp(),
    });
    return { ok: true as const, value: shot };
  });
}

async function softDeleteForProject(
  projectId: string,
  shotId: string,
): Promise<ShotMutationResult<true>> {
  return mutateDb((db) => {
    if (!activeProject(db, projectId)) {
      return failure(projectId, 'project_not_found');
    }

    const shot = activeShot(db, shotId);
    if (!shot) {
      return failure(projectId, 'shot_not_found', { shotId });
    }
    if (shot.projectId !== projectId) {
      return failure(projectId, 'shot_project_mismatch', {
        shotId,
        actualProjectId: shot.projectId,
      });
    }

    const lock = activeShotLock(db, shotId);
    if (lock) {
      return failure(projectId, 'shot_locked', {
        shotId,
        lockId: lock.id,
      });
    }

    const deletedAt = timestamp();
    shot.status = 'deleted';
    shot.deletedAt = deletedAt;
    shot.updatedAt = deletedAt;
    return { ok: true as const, value: true as const };
  });
}

async function reorderForProject(
  projectId: string,
  orderedShotIds: string[],
): Promise<ShotMutationResult<true>> {
  return mutateDb((db) => {
    if (!activeProject(db, projectId)) {
      return failure(projectId, 'project_not_found');
    }

    const shots = db.shots
      .filter(
        (shot) =>
          shot.projectId === projectId &&
          shot.status !== 'deleted' &&
          !shot.deletedAt,
      )
      .sort((a, b) => a.shotIndexGlobal - b.shotIndexGlobal);
    const uniqueShotIds = new Set(orderedShotIds);
    if (uniqueShotIds.size !== orderedShotIds.length) {
      return failure(projectId, 'duplicate_shot_ids', {
        expectedShotIds: shots.map((shot) => shot.id),
        receivedShotIds: orderedShotIds,
      });
    }

    for (const shotId of orderedShotIds) {
      const shot = activeShot(db, shotId);
      if (shot && shot.projectId !== projectId) {
        return failure(projectId, 'shot_project_mismatch', {
          shotId,
          actualProjectId: shot.projectId,
          expectedShotIds: shots.map((item) => item.id),
          receivedShotIds: orderedShotIds,
        });
      }
    }

    const expectedShotIds = shots.map((shot) => shot.id);
    const exactSet =
      orderedShotIds.length === expectedShotIds.length &&
      expectedShotIds.every((shotId) => uniqueShotIds.has(shotId));
    if (!exactSet) {
      return failure(projectId, 'reorder_set_mismatch', {
        expectedShotIds,
        receivedShotIds: orderedShotIds,
      });
    }

    for (const shotId of orderedShotIds) {
      const lock = activeShotLock(db, shotId);
      if (lock) {
        return failure(projectId, 'shot_locked', {
          shotId,
          lockId: lock.id,
        });
      }
    }

    const shotsById = new Map(shots.map((shot) => [shot.id, shot]));
    const updatedAt = timestamp();
    orderedShotIds.forEach((shotId, index) => {
      const shot = shotsById.get(shotId)!;
      shot.shotIndexGlobal = index + 1;
      shot.updatedAt = updatedAt;
    });
    return { ok: true as const, value: true as const };
  });
}

export const shotRepository = {
  async list(
    projectId: string,
    includeAssets = false,
  ): Promise<ShotRecord[] | ShotWithAssets[]> {
    const db = await readDb();
    const shots = db.shots
      .filter(
        (item) =>
          item.projectId === projectId &&
          item.status !== 'deleted' &&
          !item.deletedAt,
      )
      .sort((a, b) => a.shotIndexGlobal - b.shotIndexGlobal);

    if (!includeAssets) {
      return shots;
    }

    const processingVersionView = (
      version: (typeof db.artifactVersions)[number] | undefined,
    ) => {
      if (!version) return null;
      const jobId =
        typeof version.generationInput.jobId === 'string'
          ? version.generationInput.jobId
          : null;
      const job = jobId
        ? db.workflowJobs.find(
            (candidate) => candidate.id === jobId && !candidate.deletedAt,
          )
        : null;
      const jobUnavailable =
        version.status === 'pending' &&
        (!job || job.status === 'succeeded' || job.status === 'cancelled');
      const failedJob = job?.status === 'failed';
      const status = jobUnavailable || failedJob ? 'failed' : version.status;
      const storedError =
        typeof version.metadata?.error === 'string'
          ? version.metadata.error
          : null;
      const error = failedJob
        ? (job.lastErrorMessage ?? storedError)
        : jobUnavailable
          ? '原后台任务记录不可用，此候选版本不会继续处理。请重新生成以追加一个新版本。'
          : storedError;
      return {
        versionId: version.id,
        jobId,
        jobUnavailable,
        versionNo: version.versionNo,
        status,
        versionNote: version.versionNote ?? null,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
        error,
      };
    };

    return shots.map((shot) => {
      const storyboardBinding = db.shotAssetBindings.find(
        (binding) =>
          binding.shotId === shot.id &&
          binding.bindingRole === 'storyboard_main' &&
          !binding.deletedAt,
      );
      const videoBinding = db.shotAssetBindings.find(
        (binding) =>
          binding.shotId === shot.id &&
          binding.bindingRole === 'video_main' &&
          !binding.deletedAt,
      );
      const storyboardGroup = db.artifactGroups.find(
        (group) =>
          group.id === storyboardBinding?.artifactGroupId && !group.deletedAt,
      );
      const videoGroup = db.artifactGroups.find(
        (group) =>
          group.id === videoBinding?.artifactGroupId && !group.deletedAt,
      );
      const storyboardVersion = db.artifactVersions.find(
        (version) =>
          version.id === storyboardGroup?.activeVersionId && !version.deletedAt,
      );
      const videoVersion = db.artifactVersions.find(
        (version) =>
          version.id === videoGroup?.activeVersionId && !version.deletedAt,
      );
      const storyboardVersions = storyboardGroup
        ? db.artifactVersions
            .filter(
              (version) =>
                version.groupId === storyboardGroup.id && !version.deletedAt,
            )
            .sort((a, b) => b.versionNo - a.versionNo)
        : [];
      const videoVersions = videoGroup
        ? db.artifactVersions
            .filter(
              (version) =>
                version.groupId === videoGroup.id && !version.deletedAt,
            )
            .sort((a, b) => b.versionNo - a.versionNo)
        : [];
      const storyboardProcessingVersion = storyboardVersions.find(
        (version) =>
          version.id !== storyboardGroup?.activeVersionId &&
          (version.status === 'pending' || version.status === 'failed'),
      );
      const videoProcessingVersion = videoVersions.find(
        (version) =>
          version.id !== videoGroup?.activeVersionId &&
          (version.status === 'pending' || version.status === 'failed'),
      );

      return {
        ...shot,
        locked: db.objectLocks.some(
          (lock) =>
            lock.objectType === 'shot' &&
            lock.objectId === shot.id &&
            lock.isActive &&
            !lock.deletedAt,
        ),
        assets: {
          storyboardMain: storyboardGroup
            ? {
                artifactGroupId: storyboardGroup.id,
                activeVersionId: storyboardGroup.activeVersionId,
                url: storyboardVersion?.publicUrl ?? null,
                versionNote: storyboardVersion?.versionNote ?? null,
                isPlaceholder: storyboardVersion?.isPlaceholder ?? false,
                processingVersion: processingVersionView(
                  storyboardProcessingVersion,
                ),
              }
            : undefined,
          videoMain: videoGroup
            ? {
                artifactGroupId: videoGroup.id,
                activeVersionId: videoGroup.activeVersionId,
                url: videoVersion?.publicUrl ?? null,
                versionNote: videoVersion?.versionNote ?? null,
                isPlaceholder: videoVersion?.isPlaceholder ?? false,
                processingVersion: processingVersionView(
                  videoProcessingVersion,
                ),
              }
            : undefined,
        },
      };
    });
  },

  async get(shotId: string) {
    const db = await readDb();
    return (
      db.shots.find(
        (item) =>
          item.id === shotId && item.status !== 'deleted' && !item.deletedAt,
      ) ?? null
    );
  },

  createForProject,

  async create(
    projectId: string,
    input: ShotCreateInput,
    insertAfterShotId?: string,
  ) {
    const result = await createForProject(projectId, input, insertAfterShotId);
    if (!result.ok) {
      throw new Error(`Shot creation rejected: ${result.reason}`);
    }
    return result.value;
  },

  updateForProject,

  async update(shotId: string, patch: Partial<ShotRecord>) {
    const shot = await this.get(shotId);
    if (!shot) {
      return null;
    }
    const result = await updateForProject(shot.projectId, shotId, patch);
    return result.ok ? result.value : null;
  },

  softDeleteForProject,

  async softDelete(shotId: string) {
    const shot = await this.get(shotId);
    if (!shot) {
      return false;
    }
    const result = await softDeleteForProject(shot.projectId, shotId);
    return result.ok;
  },

  reorderForProject,

  async reorder(projectId: string, orderedShotIds: string[]) {
    const result = await reorderForProject(projectId, orderedShotIds);
    return result.ok;
  },
};
