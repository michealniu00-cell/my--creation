import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDb, mutateDb } from './dev-file-db';

describe('dev file database safety', () => {
  let tempDirectory: string | null = null;
  const inheritedOverride = process.env.VIDEO_AGENT_STUDIO_DB_FILE;

  afterEach(async () => {
    if (inheritedOverride) {
      process.env.VIDEO_AGENT_STUDIO_DB_FILE = inheritedOverride;
    } else {
      delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    }
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
      tempDirectory = null;
    }
  });

  it('refuses to fall back to the product database during tests', async () => {
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;

    await expect(ensureDb()).rejects.toThrow(
      'Tests must set VIDEO_AGENT_STUDIO_DB_FILE',
    );
  });

  it('keeps the previous valid state beside each committed mutation', async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'vas-db-backup-'));
    const dbFile = path.join(tempDirectory, 'db.json');
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = dbFile;
    const initial = await ensureDb();

    await mutateDb((db) => {
      db.projects[0].title = 'Changed after backup';
    });

    const backup = JSON.parse(await readFile(`${dbFile}.bak`, 'utf8')) as typeof initial;
    expect(backup.projects[0].title).toBe(initial.projects[0].title);
  });
});
