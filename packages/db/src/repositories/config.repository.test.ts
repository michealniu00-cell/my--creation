import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDb, readDb } from '../dev-file-db';
import { configRepository } from './config.repository';

describe('configRepository confirmation gate', () => {
  let tempDirectory = '';
  let projectId = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'vas-config-gate-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDirectory, 'db.json');
    const db = await ensureDb();
    projectId = db.projects[0].id;
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('atomically activates a draft and persists user, developer and outbox evidence', async () => {
    const draft = await configRepository.createDraft(projectId, {
      note: 'second configuration',
    });

    const confirmed = await configRepository.confirm(projectId, draft.id);
    expect(confirmed).toMatchObject({
      id: draft.id,
      confirmedByUser: true,
      isActive: true,
    });

    const db = await readDb();
    expect(db.projects.find((project) => project.id === projectId)?.currentConfigVersionId).toBe(
      draft.id,
    );
    expect(
      db.projectConfigVersions.filter(
        (config) => config.projectId === projectId && config.isActive,
      ),
    ).toHaveLength(1);
    expect(
      db.taskEvents.filter(
        (event) =>
          event.eventType === 'manual_gate_confirmed' &&
          event.eventPayload.configVersionId === draft.id,
      ),
    ).toHaveLength(1);
    expect(
      db.taskEvents.filter(
        (event) =>
          event.eventType === 'workflow_prerequisite_satisfied' &&
          event.eventPayload.configVersionId === draft.id,
      ),
    ).toHaveLength(1);
    expect(
      db.outboxEvents.filter(
        (event) =>
          event.aggregateId === draft.id && event.eventType === 'manual_gate_confirmed',
      ),
    ).toHaveLength(1);
  });

  it('does not duplicate confirmation evidence when the same command is replayed', async () => {
    const draft = await configRepository.createDraft(projectId, {});
    await configRepository.confirm(projectId, draft.id);
    await configRepository.confirm(projectId, draft.id);

    const db = await readDb();
    expect(
      db.taskEvents.filter(
        (event) =>
          event.eventType === 'manual_gate_confirmed' &&
          event.eventPayload.configVersionId === draft.id,
      ),
    ).toHaveLength(1);
    expect(
      db.outboxEvents.filter(
        (event) =>
          event.aggregateId === draft.id && event.eventType === 'manual_gate_confirmed',
      ),
    ).toHaveLength(1);
  });
});
