import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDb, readDb } from '../dev-file-db';
import { lockRepository } from './lock.repository';

describe('lockRepository ownership and audit', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'vas-lock-test-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDir, 'db.json');
    await ensureDb();
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('validates project ownership and records user/developer events with outbox intents', async () => {
    const db = await readDb();
    const shot = db.shots.find(
      (candidate) =>
        !candidate.deletedAt &&
        !db.objectLocks.some(
          (lock) =>
            lock.objectType === 'shot' &&
            lock.objectId === candidate.id &&
            lock.isActive,
        ),
    );
    if (!shot) throw new Error('Seeded unlocked Shot not found');

    await expect(
      lockRepository.lock({
        projectId: 'another-project',
        objectType: 'shot',
        objectId: shot.id,
        lockScope: 'self',
        cascadeChildren: [],
        lockedByUserId: null,
        lockReason: null,
        isActive: true,
      }),
    ).rejects.toThrow('not found inside the requested project');

    await lockRepository.lock({
      projectId: shot.projectId,
      objectType: 'shot',
      objectId: shot.id,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'protect approved shot',
      isActive: true,
    });
    await lockRepository.unlock('shot', shot.id);

    const after = await readDb();
    const events = after.taskEvents.filter(
      (event) =>
        event.projectId === shot.projectId &&
        event.eventPayload.objectId === shot.id &&
        [
          'object_locked',
          'object_unlocked',
          'lock_state_transitioned',
        ].includes(event.eventType),
    );
    expect(events).toHaveLength(4);
    expect(events.filter((event) => event.userVisible)).toHaveLength(2);
    expect(
      after.outboxEvents.filter((outbox) =>
        events.some((event) => event.id === outbox.aggregateId),
      ),
    ).toHaveLength(4);
  });
});
