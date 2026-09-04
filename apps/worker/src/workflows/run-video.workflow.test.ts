import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  artifactRepository,
  ensureDb,
  lockRepository,
  mutateDb,
  projectRepository,
  readDb,
  runRepository,
  settingsRepository,
  shotRepository,
} from '@video-agent-studio/db';
import { MockVideoProvider } from '@video-agent-studio/providers';
import { runVideoWorkflow } from './run-video.workflow';

describe('runVideoWorkflow', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'vas-video-test-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDir, 'db.json');
    await ensureDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('skips regenerating a shot when its active video version is locked', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const shots = (await shotRepository.list(project.id, false)) as Array<{ id: string; title?: string | null }>;
    const targetShot = shots.find((shot) => shot.title?.includes('转场')) ?? shots[1];
    expect(targetShot).toBeTruthy();

    const currentVideo = await artifactRepository.getShotVideo(targetShot.id);
    expect(currentVideo?.group?.activeVersionId).toBeTruthy();

    const beforeVersionCount = currentVideo?.versions.length ?? 0;
    const lockedVersionId = currentVideo?.group?.activeVersionId!;

    await lockRepository.lock({
      projectId: project.id,
      objectType: 'artifact_version',
      objectId: lockedVersionId,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: '测试锁定当前视频版本',
      isActive: true,
    });

    await runVideoWorkflow(project.id, 'all');

    const updatedVideo = await artifactRepository.getShotVideo(targetShot.id);
    const db = await readDb();
    const skippedEvent = db.taskEvents.find(
      (event) =>
        event.projectId === project.id &&
        event.eventType === 'task_skipped' &&
        String(event.summary).includes(targetShot.title ?? ''),
    );

    expect(updatedVideo?.versions.length).toBe(beforeVersionCount);
    expect(updatedVideo?.group?.activeVersionId).toBe(lockedVersionId);
    expect(skippedEvent).toBeTruthy();
  });

  it('fails fast when video workflow is still configured to use mock outside tests', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const run = await runVideoWorkflow(project.id, 'all');
      expect(run?.status).toBe('failed');
      expect(run?.errorType).toBe('system');
      expect(run?.errorMessage).toContain('已禁用 mock');

      const db = await readDb();
      const bindingError = db.taskEvents.find(
        (event) =>
          event.projectId === project.id &&
          event.eventType === 'binding_error' &&
          String(event.summary).includes('已禁用 mock'),
      );
      expect(bindingError).toBeTruthy();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('limits selected-shot generation to the explicitly requested Shot', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();
    const shots = (await shotRepository.list(project.id, false)) as Array<{ id: string }>;
    const selectedShot = shots[1];
    const untouchedShot = shots[2];
    expect(selectedShot).toBeTruthy();
    expect(untouchedShot).toBeTruthy();

    const selectedBefore = await artifactRepository.getShotVideo(selectedShot.id);
    const untouchedBefore = await artifactRepository.getShotVideo(untouchedShot.id);

    const run = await runVideoWorkflow(project.id, 'selected_shots', [selectedShot.id]);

    const selectedAfter = await artifactRepository.getShotVideo(selectedShot.id);
    const untouchedAfter = await artifactRepository.getShotVideo(untouchedShot.id);
    expect(run?.status).toBe('completed');
    expect(selectedAfter?.versions.length).toBe((selectedBefore?.versions.length ?? 0) + 1);
    expect(untouchedAfter?.versions.length).toBe(untouchedBefore?.versions.length);
  });

  it('rejects selected Shot ids that do not belong to the project', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const run = await runVideoWorkflow(project.id, 'selected_shots', ['not-a-project-shot']);
    expect(run?.status).toBe('failed');
    expect(run?.errorMessage).toContain('不属于当前项目');
  });

  it('purges legacy page-level provider credentials when defaults are ensured', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    let db = await readDb();
    expect((db.providerCredentials ?? []).length).toBe(0);

    await mutateDb((draft) => {
      draft.providerCredentials.push({
        id: 'legacy-credential',
        projectId: project.id,
        bindingId: 'legacy-binding',
        providerLabel: 'Legacy',
        baseUrl: 'https://example.com',
        apiKeyCiphertext: 'ciphertext',
        apiKeyHint: '••••test',
        isActive: true,
        note: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      });
    });

    await settingsRepository.ensureDefaults(project.id);
    db = await readDb();
    expect(db.providerCredentials).toEqual([]);
  });

  it('persists only engine projections and forwards stable Agent9 request controls', async () => {
    const project = (await projectRepository.list())[0];
    const shots = (await shotRepository.list(project.id, false)) as Array<{
      id: string;
    }>;
    const target = (
      await Promise.all(
        shots.map(async (shot) => ({
          shot,
          locked: await lockRepository.isLocked('shot', shot.id),
        })),
      )
    ).find((item) => !item.locked)?.shot;
    expect(target).toBeTruthy();
    if (!target) {
      throw new Error('Expected an unlocked demo shot');
    }
    const signal = new AbortController().signal;
    const updateSpy = vi.spyOn(runRepository, 'update');
    const providerSpy = vi.spyOn(MockVideoProvider.prototype, 'generate');

    const run = await runVideoWorkflow(
      project.id,
      'selected_shots',
      [target.id],
      { signal, idempotencyKey: 'job-video-control' },
    );

    const runPatches = updateSpy.mock.calls
      .filter(([runId]) => runId === run?.id)
      .map(([, patch]) => patch);
    expect(run).toMatchObject({
      currentNode: 'video_review',
      status: 'completed',
    });
    expect(runPatches.map((patch) => patch.currentNode)).toEqual([
      'agent9',
      'video_review',
    ]);
    expect(providerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        signal,
        idempotencyKey: `job-video-control:video:agent9:${target.id}`,
      }),
    );
  });
});
