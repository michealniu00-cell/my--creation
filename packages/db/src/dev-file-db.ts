import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseState } from './types';
import { createDemoState } from './seed/demo';

function resolveWorkspaceRoot(start = process.cwd()): string {
  let current = start;
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

function getDbFilePath() {
  const override = process.env.VIDEO_AGENT_STUDIO_DB_FILE;
  if (override) {
    return override;
  }
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    throw new Error(
      'Tests must set VIDEO_AGENT_STUDIO_DB_FILE to an isolated temporary file; refusing to use the local product database.',
    );
  }
  const root = resolveWorkspaceRoot();
  return path.join(root, '.data', 'video-agent-studio.json');
}

export async function ensureDb(): Promise<DatabaseState> {
  const dbFile = getDbFilePath();
  if (existsSync(dbFile)) {
    return readDb();
  }

  await mkdir(path.dirname(dbFile), { recursive: true });
  const initial = createDemoState();
  await writeFile(dbFile, JSON.stringify(initial, null, 2), 'utf8');
  return initial;
}

function normalizeDbState(db: DatabaseState): DatabaseState {
  return {
    ...db,
    agentProfiles: db.agentProfiles ?? [],
    agentModelBindings: db.agentModelBindings ?? [],
    providerCredentials: db.providerCredentials ?? [],
    workflowJobs: db.workflowJobs ?? [],
    workflowJobAttempts: db.workflowJobAttempts ?? [],
    agentPermissions: db.agentPermissions ?? [],
    agentTasks: db.agentTasks ?? [],
    reviewRecords: db.reviewRecords ?? [],
    projectStageSnapshots: db.projectStageSnapshots ?? [],
    failureSummaryDocs: db.failureSummaryDocs ?? [],
    scenes: db.scenes ?? [],
    shots: db.shots ?? [],
    artifactGroups: db.artifactGroups ?? [],
    artifactVersions: db.artifactVersions ?? [],
    shotAssetBindings: db.shotAssetBindings ?? [],
    objectLocks: db.objectLocks ?? [],
    userAnnotations: db.userAnnotations ?? [],
    taskEvents: db.taskEvents ?? [],
    outboxEvents: db.outboxEvents ?? [],
  };
}

export async function readDb(): Promise<DatabaseState> {
  const dbFile = getDbFilePath();
  const content = await readFile(dbFile, 'utf8');
  return normalizeDbState(JSON.parse(content) as DatabaseState);
}

export async function writeDb(db: DatabaseState): Promise<void> {
  const dbFile = getDbFilePath();
  await mkdir(path.dirname(dbFile), { recursive: true });
  const tempFile = `${dbFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, JSON.stringify(db, null, 2), 'utf8');
  if (existsSync(dbFile)) {
    await copyFile(dbFile, `${dbFile}.bak`);
  }
  await rename(tempFile, dbFile);
}

let mutationQueue: Promise<unknown> = Promise.resolve();

const mutationLockStaleMs = 120_000;
const mutationLockRetryMs = 25;
const mutationLockMaxWaitMs = 30_000;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function acquireMutationFileLock(dbFile: string) {
  const lockDirectory = `${dbFile}.mutation-lock`;
  const deadline = Date.now() + mutationLockMaxWaitMs;

  while (Date.now() < deadline) {
    try {
      await mkdir(lockDirectory);
      return async () => {
        await rm(lockDirectory, { recursive: true, force: true });
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }

      try {
        const lockStat = await stat(lockDirectory);
        if (Date.now() - lockStat.mtimeMs > mutationLockStaleMs) {
          const staleDirectory = `${lockDirectory}.stale.${process.pid}.${randomUUID()}`;
          try {
            await rename(lockDirectory, staleDirectory);
            await rm(staleDirectory, { recursive: true, force: true });
            continue;
          } catch (recoveryError) {
            const recoveryCode = (recoveryError as NodeJS.ErrnoException).code;
            if (recoveryCode !== 'ENOENT') {
              throw recoveryError;
            }
          }
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw statError;
        }
      }

      await wait(mutationLockRetryMs);
    }
  }

  throw new Error(
    `Timed out waiting for database mutation lock: ${lockDirectory}`,
  );
}

export async function mutateDb<T>(
  mutator: (db: DatabaseState) => T,
): Promise<T> {
  const runMutation = async () => {
    const dbFile = getDbFilePath();
    await mkdir(path.dirname(dbFile), { recursive: true });
    const release = await acquireMutationFileLock(dbFile);
    try {
      const db = await ensureDb();
      const result = mutator(db);
      await writeDb(db);
      return result;
    } finally {
      await release();
    }
  };

  const task = mutationQueue.then(runMutation, runMutation);
  mutationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export function timestamp() {
  return new Date().toISOString();
}

export function id() {
  return randomUUID();
}

export function audited<
  T extends {
    id: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
  },
>(value: Omit<T, 'createdAt' | 'updatedAt' | 'deletedAt'>): T {
  const now = timestamp();
  return {
    ...value,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as T;
}
