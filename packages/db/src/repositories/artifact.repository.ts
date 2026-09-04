import type {
  ArtifactGroupRecord,
  ArtifactVersionRecord,
  ShotAssetBindingRecord,
} from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';
import type { DatabaseState } from '../types';
import { appendTaskEvent } from './event.repository';

export type ArtifactVersionCreateInput = Omit<
  ArtifactVersionRecord,
  'createdAt' | 'updatedAt' | 'deletedAt' | 'id' | 'versionNo'
>;

/**
 * A caller must carry at least one value observed before it started work.
 * This prevents a late completion from blindly replacing a newer active result.
 */
export type ArtifactActivationExpectation =
  | {
      expectedActiveVersionId: string | null;
      expectedGroupUpdatedAt?: string;
    }
  | {
      expectedActiveVersionId?: string | null;
      expectedGroupUpdatedAt: string;
    };

export type ArtifactActivationFailureReason =
  | 'invalid_expectation'
  | 'group_not_found'
  | 'version_not_found'
  | 'active_version_conflict'
  | 'group_revision_conflict'
  | 'shot_locked'
  | 'active_version_locked'
  | 'target_version_locked';

export type ArtifactActivationResult =
  | {
      ok: true;
      changed: boolean;
      group: ArtifactGroupRecord;
      version: ArtifactVersionRecord;
      previousActiveVersionId: string | null;
    }
  | {
      ok: false;
      reason: ArtifactActivationFailureReason;
      group: ArtifactGroupRecord | null;
      version: ArtifactVersionRecord | null;
      actualActiveVersionId: string | null;
      actualGroupUpdatedAt: string | null;
      lockId: string | null;
    };

function failedActivation(
  reason: ArtifactActivationFailureReason,
  group: ArtifactGroupRecord | null,
  version: ArtifactVersionRecord | null,
  lockId: string | null = null,
): ArtifactActivationResult {
  return {
    ok: false,
    reason,
    group,
    version,
    actualActiveVersionId: group?.activeVersionId ?? null,
    actualGroupUpdatedAt: group?.updatedAt ?? null,
    lockId,
  };
}

function nextRevision(previous: string): string {
  const now = Date.now();
  const previousTime = Date.parse(previous);
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now,
  ).toISOString();
}

function findActiveLock(
  db: DatabaseState,
  objectType: 'shot' | 'artifact_version',
  objectId: string,
) {
  return db.objectLocks.find(
    (lock) =>
      lock.objectType === objectType &&
      lock.objectId === objectId &&
      lock.isActive &&
      !lock.deletedAt,
  );
}

function activateVersionInDb(
  db: DatabaseState,
  groupId: string,
  versionId: string,
  expectation?: ArtifactActivationExpectation,
): ArtifactActivationResult {
  const group = db.artifactGroups.find(
    (item) =>
      item.id === groupId && item.status !== 'deleted' && !item.deletedAt,
  );
  if (!group) {
    return failedActivation('group_not_found', null, null);
  }

  const version = db.artifactVersions.find(
    (item) =>
      item.id === versionId &&
      item.groupId === groupId &&
      item.status !== 'deleted' &&
      !item.deletedAt,
  );
  if (!version) {
    return failedActivation('version_not_found', group, null);
  }

  const previousActiveVersionId = group.activeVersionId ?? null;

  // A retry after the desired version was already committed is a safe no-op,
  // including when the newly active object has since been locked.
  if (previousActiveVersionId === versionId) {
    return {
      ok: true,
      changed: false,
      group,
      version,
      previousActiveVersionId,
    };
  }

  if (expectation) {
    const hasExpectedActive = Object.prototype.hasOwnProperty.call(
      expectation,
      'expectedActiveVersionId',
    );
    const hasExpectedRevision =
      typeof expectation.expectedGroupUpdatedAt === 'string' &&
      expectation.expectedGroupUpdatedAt.length > 0;

    if (!hasExpectedActive && !hasExpectedRevision) {
      return failedActivation('invalid_expectation', group, version);
    }

    if (
      hasExpectedActive &&
      previousActiveVersionId !== expectation.expectedActiveVersionId
    ) {
      return failedActivation('active_version_conflict', group, version);
    }

    if (
      hasExpectedRevision &&
      group.updatedAt !== expectation.expectedGroupUpdatedAt
    ) {
      return failedActivation('group_revision_conflict', group, version);
    }
  }

  if (group.scopeType === 'shot') {
    const shotLock = findActiveLock(db, 'shot', group.scopeId);
    if (shotLock) {
      return failedActivation('shot_locked', group, version, shotLock.id);
    }
  }

  if (previousActiveVersionId) {
    const activeVersionLock = findActiveLock(
      db,
      'artifact_version',
      previousActiveVersionId,
    );
    if (activeVersionLock) {
      return failedActivation(
        'active_version_locked',
        group,
        version,
        activeVersionLock.id,
      );
    }
  }

  const targetVersionLock = findActiveLock(db, 'artifact_version', versionId);
  if (targetVersionLock) {
    return failedActivation(
      'target_version_locked',
      group,
      version,
      targetVersionLock.id,
    );
  }

  group.activeVersionId = versionId;
  group.updatedAt = nextRevision(group.updatedAt);
  const sourceTask = version.sourceTaskId
    ? db.agentTasks.find(
        (task) => task.id === version.sourceTaskId && !task.deletedAt,
      )
    : null;
  const jobId =
    typeof version.generationInput.jobId === 'string'
      ? version.generationInput.jobId
      : null;
  appendTaskEvent(db, {
    projectId: group.projectId,
    runId: sourceTask?.runId ?? null,
    taskId: sourceTask?.id ?? null,
    jobId,
    eventType: 'artifact_version_activated',
    eventLevel: 'info',
    userVisible: true,
    summary: `${group.name} 已切换为 v${version.versionNo}`,
    eventPayload: {
      artifactGroupId: group.id,
      artifactVersionId: version.id,
      artifactRole: group.role,
      scopeType: group.scopeType,
      scopeId: group.scopeId,
      previousActiveVersionId,
      versionNo: version.versionNo,
    },
  });
  appendTaskEvent(db, {
    projectId: group.projectId,
    runId: sourceTask?.runId ?? null,
    taskId: sourceTask?.id ?? null,
    jobId,
    eventType: 'artifact_publish_committed',
    eventLevel: 'info',
    userVisible: false,
    summary: 'Artifact CAS activation committed after lock validation',
    eventPayload: {
      artifactGroupId: group.id,
      artifactVersionId: version.id,
      previousActiveVersionId,
      expectedActiveVersionId:
        expectation && 'expectedActiveVersionId' in expectation
          ? expectation.expectedActiveVersionId
          : null,
      expectedGroupUpdatedAt: expectation?.expectedGroupUpdatedAt ?? null,
      committedGroupUpdatedAt: group.updatedAt,
    },
  });
  return {
    ok: true,
    changed: true,
    group,
    version,
    previousActiveVersionId,
  };
}

export const artifactRepository = {
  async listKeyElements(projectId: string) {
    const db = await readDb();
    return db.artifactGroups
      .filter(
        (group) =>
          group.projectId === projectId &&
          [
            'character_ref',
            'scene_ref',
            'prop_ref',
            'style_ref',
            'effect_ref',
          ].includes(group.role) &&
          !group.deletedAt,
      )
      .map((group) => {
        const activeVersion = db.artifactVersions.find(
          (version) =>
            version.id === group.activeVersionId && !version.deletedAt,
        );
        const referencedShotIds = db.shotAssetBindings
          .filter(
            (binding) =>
              binding.artifactGroupId === group.id && !binding.deletedAt,
          )
          .map((binding) => binding.shotId);

        return {
          ...group,
          activeVersion,
          referencedShotIds,
        };
      });
  },

  async getGroup(groupId: string) {
    const db = await readDb();
    return (
      db.artifactGroups.find(
        (group) => group.id === groupId && !group.deletedAt,
      ) ?? null
    );
  },

  async getVersion(versionId: string) {
    const db = await readDb();
    return (
      db.artifactVersions.find(
        (version) => version.id === versionId && !version.deletedAt,
      ) ?? null
    );
  },

  async getGroupByVersion(versionId: string) {
    const db = await readDb();
    const version = db.artifactVersions.find(
      (item) => item.id === versionId && !item.deletedAt,
    );
    if (!version) {
      return null;
    }
    return (
      db.artifactGroups.find(
        (group) => group.id === version.groupId && !group.deletedAt,
      ) ?? null
    );
  },

  async getVersions(groupId: string) {
    const db = await readDb();
    const group = db.artifactGroups.find(
      (item) => item.id === groupId && !item.deletedAt,
    );
    const versions = db.artifactVersions
      .filter((version) => version.groupId === groupId && !version.deletedAt)
      .sort((a, b) => b.versionNo - a.versionNo);
    return {
      group,
      versions,
    };
  },

  async createGroup(
    input: Omit<
      ArtifactGroupRecord,
      'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
    >,
  ) {
    return mutateDb((db) => {
      const group = audited<ArtifactGroupRecord>({
        ...input,
        id: id(),
      });
      db.artifactGroups.push(group);
      return group;
    });
  },

  /**
   * Resolves the logical artifact stream before slow provider work begins.
   * This closes the first-generation race where two workers previously created
   * separate groups for the same shot and role.
   */
  async getOrCreateGroup(
    input: Omit<
      ArtifactGroupRecord,
      'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
    >,
  ) {
    return mutateDb((db) => {
      const existing = db.artifactGroups.find(
        (group) =>
          group.projectId === input.projectId &&
          group.scopeType === input.scopeType &&
          group.scopeId === input.scopeId &&
          group.artifactType === input.artifactType &&
          group.role === input.role &&
          group.status !== 'deleted' &&
          !group.deletedAt,
      );
      if (existing) {
        return existing;
      }

      const group = audited<ArtifactGroupRecord>({
        ...input,
        id: id(),
      });
      db.artifactGroups.push(group);
      return group;
    });
  },

  /** @deprecated Use createNextVersion so versionNo is allocated atomically. */
  async createVersion(
    input: Omit<
      ArtifactVersionRecord,
      'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
    >,
  ) {
    return mutateDb((db) => {
      const group = db.artifactGroups.find(
        (item) =>
          item.id === input.groupId &&
          item.status !== 'deleted' &&
          !item.deletedAt,
      );
      if (!group) {
        throw new Error(`Artifact group ${input.groupId} does not exist`);
      }

      const duplicateVersionNo = db.artifactVersions.some(
        (item) =>
          item.groupId === input.groupId && item.versionNo === input.versionNo,
      );
      if (duplicateVersionNo) {
        throw new Error(
          `Artifact version ${input.groupId}@${input.versionNo} already exists`,
        );
      }

      const version = audited<ArtifactVersionRecord>({
        ...input,
        id: id(),
      });
      db.artifactVersions.push(version);
      return version;
    });
  },

  /**
   * Allocates versionNo and creates the immutable version in one mutation.
   * Callers doing concurrent regeneration should prefer this over read-max + createVersion.
   */
  async createNextVersion(input: ArtifactVersionCreateInput) {
    return mutateDb((db) => {
      const group = db.artifactGroups.find(
        (item) =>
          item.id === input.groupId &&
          item.status !== 'deleted' &&
          !item.deletedAt,
      );
      if (!group) {
        return null;
      }

      // Include soft-deleted versions because the SQL migration's unique(group_id, version_no)
      // constraint reserves their version numbers as well.
      const versionNo =
        db.artifactVersions
          .filter((item) => item.groupId === input.groupId)
          .reduce((highest, item) => Math.max(highest, item.versionNo), 0) + 1;
      const version = audited<ArtifactVersionRecord>({
        ...input,
        versionNo,
        id: id(),
      });
      db.artifactVersions.push(version);
      return version;
    });
  },

  /**
   * Idempotent append for a logical provider execution. A worker retry receives
   * the original immutable candidate instead of allocating another version.
   */
  async createNextVersionOnce(
    executionKey: string,
    input: ArtifactVersionCreateInput,
  ) {
    const normalizedKey = executionKey.trim();
    if (!normalizedKey || normalizedKey.length > 500) {
      throw new Error('executionKey must contain between 1 and 500 characters');
    }

    return mutateDb((db) => {
      const group = db.artifactGroups.find(
        (item) =>
          item.id === input.groupId &&
          item.status !== 'deleted' &&
          !item.deletedAt,
      );
      if (!group) {
        return { version: null, created: false as const };
      }
      const existing = db.artifactVersions.find(
        (version) =>
          version.groupId === input.groupId &&
          version.generationInput.executionKey === normalizedKey &&
          !version.deletedAt,
      );
      if (existing) {
        return { version: existing, created: false as const };
      }

      const versionNo =
        db.artifactVersions
          .filter((item) => item.groupId === input.groupId)
          .reduce((highest, item) => Math.max(highest, item.versionNo), 0) + 1;
      const version = audited<ArtifactVersionRecord>({
        ...input,
        generationInput: {
          ...input.generationInput,
          executionKey: normalizedKey,
        },
        versionNo,
        id: id(),
      });
      db.artifactVersions.push(version);
      return { version, created: true as const };
    });
  },

  async updateVersion(
    versionId: string,
    patch: Partial<ArtifactVersionRecord>,
  ) {
    return mutateDb((db) => {
      const version = db.artifactVersions.find(
        (item) => item.id === versionId && !item.deletedAt,
      );
      if (!version) {
        return null;
      }

      const group = db.artifactGroups.find(
        (item) =>
          item.id === version.groupId &&
          item.status !== 'deleted' &&
          !item.deletedAt,
      );
      const shotLocked =
        group?.scopeType === 'shot' &&
        group.activeVersionId === versionId &&
        Boolean(findActiveLock(db, 'shot', group.scopeId));
      if (shotLocked || findActiveLock(db, 'artifact_version', versionId)) {
        return null;
      }

      Object.assign(version, patch, {
        updatedAt: timestamp(),
      });
      return version;
    });
  },

  /**
   * Compare-and-swap activation. The expectation and all lock checks are evaluated
   * in the same database mutation as the activeVersionId write.
   */
  async activateVersionIfExpected(
    groupId: string,
    versionId: string,
    expectation: ArtifactActivationExpectation,
  ): Promise<ArtifactActivationResult> {
    return mutateDb((db) =>
      activateVersionInDb(db, groupId, versionId, expectation),
    );
  },

  /**
   * Compatibility API. It is now lock-aware, but callers that can complete out of
   * order must migrate to activateVersionIfExpected to get stale-write protection.
   * @deprecated Use activateVersionIfExpected for every new write path.
   */
  async activateVersion(groupId: string, versionId: string) {
    return mutateDb((db) => {
      const result = activateVersionInDb(db, groupId, versionId);
      return result.ok ? result.group : null;
    });
  },

  /** @deprecated Use replaceKeyElementIfExpected for compare-and-swap publishing. */
  async replaceKeyElement(
    groupId: string,
    versionId: string,
    impactScope: ShotAssetBindingRecord['influenceScope'],
  ) {
    return mutateDb((db) => {
      const activation = activateVersionInDb(db, groupId, versionId);
      if (!activation.ok) {
        return null;
      }

      db.shotAssetBindings
        .filter(
          (binding) =>
            binding.artifactGroupId === groupId && !binding.deletedAt,
        )
        .forEach((binding) => {
          binding.influenceScope = impactScope ?? null;
          binding.updatedAt = timestamp();
        });

      return activation.group;
    });
  },

  async replaceKeyElementIfExpected(
    groupId: string,
    versionId: string,
    impactScope: ShotAssetBindingRecord['influenceScope'],
    expectation: ArtifactActivationExpectation,
  ): Promise<ArtifactActivationResult> {
    return mutateDb((db) => {
      const activation = activateVersionInDb(
        db,
        groupId,
        versionId,
        expectation,
      );
      if (!activation.ok) {
        return activation;
      }

      db.shotAssetBindings
        .filter(
          (binding) =>
            binding.artifactGroupId === groupId && !binding.deletedAt,
        )
        .forEach((binding) => {
          binding.influenceScope = impactScope ?? null;
          binding.updatedAt = timestamp();
        });

      return activation;
    });
  },

  async bindAsset(
    input: Omit<
      ShotAssetBindingRecord,
      'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
    >,
  ) {
    return mutateDb((db) => {
      const binding = audited<ShotAssetBindingRecord>({
        ...input,
        id: id(),
      });
      db.shotAssetBindings.push(binding);
      return binding;
    });
  },

  async bindAssetOnce(
    input: Omit<
      ShotAssetBindingRecord,
      'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
    >,
  ) {
    return mutateDb((db) => {
      const existing = db.shotAssetBindings.find(
        (binding) =>
          binding.projectId === input.projectId &&
          binding.shotId === input.shotId &&
          binding.artifactGroupId === input.artifactGroupId &&
          binding.bindingRole === input.bindingRole &&
          !binding.deletedAt,
      );
      if (existing) {
        return existing;
      }

      const binding = audited<ShotAssetBindingRecord>({
        ...input,
        id: id(),
      });
      db.shotAssetBindings.push(binding);
      return binding;
    });
  },

  async getShotStoryboard(shotId: string) {
    const db = await readDb();
    const binding = db.shotAssetBindings.find(
      (item) =>
        item.shotId === shotId &&
        item.bindingRole === 'storyboard_main' &&
        !item.deletedAt,
    );
    if (!binding) {
      return null;
    }
    const group = db.artifactGroups.find(
      (item) => item.id === binding.artifactGroupId && !item.deletedAt,
    );
    const versions = db.artifactVersions
      .filter(
        (version) =>
          version.groupId === binding.artifactGroupId && !version.deletedAt,
      )
      .sort((a, b) => b.versionNo - a.versionNo);
    return { group, versions };
  },

  async getShotVideo(shotId: string) {
    const db = await readDb();
    const binding = db.shotAssetBindings.find(
      (item) =>
        item.shotId === shotId &&
        item.bindingRole === 'video_main' &&
        !item.deletedAt,
    );
    if (!binding) {
      return null;
    }
    const group = db.artifactGroups.find(
      (item) => item.id === binding.artifactGroupId && !item.deletedAt,
    );
    const versions = db.artifactVersions
      .filter(
        (version) =>
          version.groupId === binding.artifactGroupId && !version.deletedAt,
      )
      .sort((a, b) => b.versionNo - a.versionNo);
    return { group, versions };
  },
};
