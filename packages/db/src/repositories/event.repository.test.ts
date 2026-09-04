import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDb, readDb } from '../dev-file-db';
import { eventRepository } from './event.repository';

describe('eventRepository', () => {
  let tempDirectory = '';
  let projectId = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'vas-event-outbox-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDirectory, 'db.json');
    const db = await ensureDb();
    projectId = db.projects[0].id;
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('persists an outbox record in the same mutation as every task event', async () => {
    const event = await eventRepository.create({
      projectId,
      runId: null,
      taskId: null,
      jobId: null,
      eventType: 'artifact_activation_conflict',
      eventLevel: 'warn',
      userVisible: true,
      summary: 'Candidate version retained',
      eventPayload: { artifactVersionId: 'version-1' },
    });

    const db = await readDb();
    expect(db.taskEvents.find((candidate) => candidate.id === event.id)).toBeTruthy();
    expect(
      db.outboxEvents.filter(
        (candidate) =>
          candidate.aggregateType === 'task_event' &&
          candidate.aggregateId === event.id &&
          candidate.eventType === event.eventType,
      ),
    ).toHaveLength(1);
  });
});
