import type {
  LockStatusView,
  ObjectLockRecord,
} from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';
import { appendTaskEvent } from './event.repository';

function validateLockOwnership(
  db: Awaited<ReturnType<typeof readDb>>,
  input: Pick<ObjectLockRecord, 'projectId' | 'objectType' | 'objectId'>,
) {
  if (input.objectType === 'shot') {
    return db.shots.some(
      (shot) =>
        shot.id === input.objectId &&
        shot.projectId === input.projectId &&
        !shot.deletedAt,
    );
  }
  const version = db.artifactVersions.find(
    (item) => item.id === input.objectId && !item.deletedAt,
  );
  return Boolean(
    version &&
    db.artifactGroups.some(
      (group) =>
        group.id === version.groupId &&
        group.projectId === input.projectId &&
        !group.deletedAt,
    ),
  );
}

function appendLockEvents(
  db: Awaited<ReturnType<typeof readDb>>,
  lock: ObjectLockRecord,
  action: 'locked' | 'unlocked',
) {
  appendTaskEvent(db, {
    projectId: lock.projectId,
    runId: null,
    taskId: null,
    eventType: `object_${action}`,
    eventLevel: 'info',
    userVisible: true,
    summary:
      action === 'locked'
        ? '对象已锁定，自动生成不会覆盖它'
        : '对象已解锁，可以继续编辑或生成',
    eventPayload: {
      lockId: lock.id,
      objectType: lock.objectType,
      objectId: lock.objectId,
      lockScope: lock.lockScope,
      cascadeChildren: lock.cascadeChildren,
    },
  });
  appendTaskEvent(db, {
    projectId: lock.projectId,
    runId: null,
    taskId: null,
    eventType: 'lock_state_transitioned',
    eventLevel: 'info',
    userVisible: false,
    summary: `Lock state atomically transitioned to ${action}`,
    eventPayload: {
      command: action === 'locked' ? 'lock_object' : 'unlock_object',
      lockId: lock.id,
      objectType: lock.objectType,
      objectId: lock.objectId,
      projectOwnershipValidated: true,
    },
  });
}

export const lockRepository = {
  async getStatus(
    objectType: ObjectLockRecord['objectType'],
    objectId: string,
  ): Promise<LockStatusView> {
    const db = await readDb();
    const lock = db.objectLocks.find(
      (item) =>
        item.objectType === objectType &&
        item.objectId === objectId &&
        item.isActive &&
        !item.deletedAt,
    );
    return {
      locked: Boolean(lock),
      lockId: lock?.id ?? null,
      lockScope: lock?.lockScope ?? null,
    };
  },

  async isLocked(objectType: ObjectLockRecord['objectType'], objectId: string) {
    const status = await this.getStatus(objectType, objectId);
    return status.locked;
  },

  async lock(
    input: Omit<
      ObjectLockRecord,
      'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
    >,
  ) {
    return mutateDb((db) => {
      if (!validateLockOwnership(db, input)) {
        throw new Error(
          'Lock target was not found inside the requested project',
        );
      }
      const existing = db.objectLocks.find(
        (item) =>
          item.objectType === input.objectType &&
          item.objectId === input.objectId &&
          item.isActive &&
          !item.deletedAt,
      );
      if (existing) {
        existing.lockScope = input.lockScope;
        existing.cascadeChildren = input.cascadeChildren;
        existing.lockedByUserId = input.lockedByUserId ?? null;
        existing.lockReason = input.lockReason ?? null;
        existing.isActive = true;
        existing.updatedAt = timestamp();
        appendLockEvents(db, existing, 'locked');
        return existing;
      }

      const lock = audited<ObjectLockRecord>({
        ...input,
        id: id(),
      });
      db.objectLocks.push(lock);
      appendLockEvents(db, lock, 'locked');
      return lock;
    });
  },

  async unlock(objectType: ObjectLockRecord['objectType'], objectId: string) {
    return mutateDb((db) => {
      const lock = db.objectLocks.find(
        (item) =>
          item.objectType === objectType &&
          item.objectId === objectId &&
          item.isActive &&
          !item.deletedAt,
      );
      if (!lock) {
        return false;
      }
      lock.isActive = false;
      lock.updatedAt = timestamp();
      appendLockEvents(db, lock, 'unlocked');
      return true;
    });
  },
};
