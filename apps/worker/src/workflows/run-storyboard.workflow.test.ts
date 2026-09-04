import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  artifactRepository,
  ensureDb,
  jobRepository,
  lockRepository,
  projectRepository,
  readDb,
  runRepository,
  sceneRepository,
  settingsRepository,
  shotRepository,
} from '@video-agent-studio/db';
import { MockImageProvider } from '@video-agent-studio/providers';
import { runStoryboardWorkflow } from './run-storyboard.workflow';

describe('runStoryboardWorkflow', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'vas-storyboard-test-'));
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDir, 'db.json');
    await ensureDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    delete process.env.VIDEO_AGENT_STUDIO_IMAGE_API_KEY;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('records a non-visual failed candidate without activating fake media when first generation fails', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const existingShots = await shotRepository.list(project.id, false);
    const afterShotId = existingShots.at(-1)?.id;
    const createdShot = await shotRepository.create(
      project.id,
      {
        title: '首次失败占位测试 shot',
        scriptSegment: '新的测试镜头',
        sceneId: null,
        sceneDesc: '测试场景',
        subjectDesc: '测试主体',
        actionDesc: '测试动作',
        moodDesc: '测试氛围',
        continuityNotes: '测试衔接',
      },
      afterShotId,
    );

    const beforeStoryboard = await artifactRepository.getShotStoryboard(
      createdShot.id,
    );
    expect(beforeStoryboard).toBeNull();

    await settingsRepository.ensureDefaults(project.id);
    const imageBinding = await settingsRepository.getActiveModelBinding(
      project.id,
      'agent8',
    );
    expect(imageBinding).toBeTruthy();
    await settingsRepository.updateModelBinding(project.id, imageBinding!.id, {
      provider: 'openai',
      providerLabel: 'OpenAI',
      modelName: 'gpt-image-1',
      temperature: imageBinding!.temperature ?? null,
      maxTokens: imageBinding!.maxTokens ?? null,
      timeoutSec: imageBinding!.timeoutSec ?? null,
      retryLimit: imageBinding!.retryLimit ?? null,
      extraConfig: imageBinding!.extraConfig ?? {},
    });
    process.env.VIDEO_AGENT_STUDIO_IMAGE_API_KEY = 'test-image-key';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'supplier outage' },
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await runStoryboardWorkflow(project.id);

    const storyboard = await artifactRepository.getShotStoryboard(
      createdShot.id,
    );
    expect(storyboard?.group).toBeTruthy();
    expect(storyboard?.group?.activeVersionId).toBeNull();
    const failedVersion = storyboard?.versions[0];
    expect(failedVersion).toMatchObject({
      status: 'failed',
      isPlaceholder: false,
      storageBucket: null,
      storagePath: null,
      publicUrl: null,
    });
  });

  it('fails fast when storyboard workflow is still configured to use mock outside tests', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const run = await runStoryboardWorkflow(project.id);
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

  it('preserves a locked shot and its active storyboard while tracing the Agent6 conflict candidate', async () => {
    const project = (await projectRepository.list())[0];
    expect(project).toBeTruthy();

    const shotsBefore = await shotRepository.list(project.id, false);
    const lockedShotBefore = (
      await Promise.all(
        shotsBefore.map(async (shot) => ({
          shot,
          locked: await lockRepository.isLocked('shot', shot.id),
        })),
      )
    ).find((item) => item.locked)?.shot;
    expect(lockedShotBefore).toBeTruthy();
    const storyboardBefore = await artifactRepository.getShotStoryboard(
      lockedShotBefore!.id,
    );
    const activeVersionBefore = storyboardBefore?.group?.activeVersionId;
    const versionCountBefore = storyboardBefore?.versions.length;

    const run = await runStoryboardWorkflow(project.id);
    expect(run).toMatchObject({
      currentNode: 'agent8',
      status: 'completed',
      requiresManualReview: true,
    });

    const scenes = await sceneRepository.list(project.id);
    const shots = await shotRepository.list(project.id, false);
    const lockedShotAfter = shots.find(
      (shot) => shot.id === lockedShotBefore!.id,
    );
    const storyboardAfter = await artifactRepository.getShotStoryboard(
      lockedShotBefore!.id,
    );
    const db = await readDb();
    const conflict = db.taskEvents.find(
      (event) =>
        event.projectId === project.id &&
        event.eventType === 'shot_write_conflict' &&
        event.eventPayload.shotId === lockedShotBefore!.id &&
        event.eventPayload.operation === 'structure_sync',
    );

    expect(scenes).toHaveLength(2);
    expect(shots).toHaveLength(shotsBefore.length);
    expect(lockedShotAfter).toEqual(lockedShotBefore);
    expect(storyboardAfter?.group?.activeVersionId).toBe(activeVersionBefore);
    expect(storyboardAfter?.versions).toHaveLength(versionCountBefore ?? 0);
    expect(conflict).toBeTruthy();
    expect(conflict?.taskId).toBeTruthy();
    expect(conflict?.eventPayload).toMatchObject({
      reason: 'shot_locked',
      operation: 'structure_sync',
      shotId: lockedShotBefore!.id,
      candidateTaskId: conflict?.taskId,
    });
  });

  it('uses engine projections and forwards one stable cancellation/idempotency scope per Agent8 Shot', async () => {
    const project = (await projectRepository.list())[0];
    const signal = new AbortController().signal;
    const updateSpy = vi.spyOn(runRepository, 'update');
    const providerSpy = vi.spyOn(MockImageProvider.prototype, 'generate');

    const run = await runStoryboardWorkflow(project.id, undefined, {
      signal,
      idempotencyKey: 'job-storyboard-control',
    });

    const runPatches = updateSpy.mock.calls
      .filter(([runId]) => runId === run?.id)
      .map(([, patch]) => patch);
    expect(runPatches.map((patch) => patch.currentNode)).toEqual(
      expect.arrayContaining(['agent6', 'agent7', 'agent8']),
    );
    expect(runPatches.map((patch) => patch.currentNode)).not.toEqual(
      expect.arrayContaining(['agent6_review', 'agent7_review']),
    );
    expect(providerSpy).toHaveBeenCalled();
    for (const [input] of providerSpy.mock.calls) {
      expect(input.signal).toBe(signal);
      expect(input.idempotencyKey).toMatch(
        /^job-storyboard-control:storyboard:agent8:/,
      );
    }
  });

  it('resumes only the failed Agent8 shot while preserving approved tasks and storyboard structure', async () => {
    const project = (await projectRepository.list())[0];
    const { job } = await jobRepository.enqueue({
      projectId: project.id,
      jobType: 'storyboard',
      idempotencyKey: 'storyboard-resume-job',
      payload: {},
      maxAttempts: 1,
      timeoutMs: 30_000,
    });
    const originalGenerate = MockImageProvider.prototype.generate;
    let shouldFailFirstShot = true;
    vi.spyOn(MockImageProvider.prototype, 'generate').mockImplementation(
      async function (input) {
        if (shouldFailFirstShot) {
          shouldFailFirstShot = false;
          throw new Error('one-shot provider interruption');
        }
        return originalGenerate(input);
      },
    );

    const firstRun = await runStoryboardWorkflow(project.id, undefined, {
      jobId: job.id,
      idempotencyKey: 'storyboard-resume-job',
    });
    expect(firstRun).toMatchObject({ status: 'failed', currentNode: 'agent8' });

    const firstDb = await readDb();
    const firstTaskIds = firstDb.agentTasks
      .filter((task) => task.runId === firstRun?.id && !task.deletedAt)
      .map((task) => task.id)
      .sort();
    const firstSceneIds = (await sceneRepository.list(project.id)).map(
      (scene) => scene.id,
    );
    const firstShotState = (await shotRepository.list(project.id, false)).map(
      (shot) => ({ id: shot.id, sortVersion: shot.sortVersion }),
    );
    const firstStoryboardVersions = firstDb.artifactVersions.filter(
      (version) =>
        version.generationInput.jobId === job.id && !version.deletedAt,
    );
    expect(
      firstStoryboardVersions.filter((version) => version.status === 'failed'),
    ).toHaveLength(1);

    const resumedRun = await runStoryboardWorkflow(project.id, undefined, {
      jobId: job.id,
      idempotencyKey: 'storyboard-resume-job',
      resumeExistingRun: true,
      resumeCount: 1,
    });
    expect(resumedRun).toMatchObject({
      id: firstRun?.id,
      status: 'completed',
      currentNode: 'agent8',
    });

    const resumedDb = await readDb();
    const resumedTaskIds = resumedDb.agentTasks
      .filter((task) => task.runId === firstRun?.id && !task.deletedAt)
      .map((task) => task.id)
      .sort();
    const resumedVersions = resumedDb.artifactVersions.filter(
      (version) =>
        version.generationInput.jobId === job.id && !version.deletedAt,
    );

    expect(resumedTaskIds).toEqual(firstTaskIds);
    expect(
      (await sceneRepository.list(project.id)).map((scene) => scene.id),
    ).toEqual(firstSceneIds);
    expect(
      (await shotRepository.list(project.id, false)).map((shot) => ({
        id: shot.id,
        sortVersion: shot.sortVersion,
      })),
    ).toEqual(firstShotState);
    expect(resumedVersions).toHaveLength(firstStoryboardVersions.length + 1);
    expect(
      resumedVersions.filter((version) => version.status === 'generated'),
    ).toHaveLength(firstStoryboardVersions.length);
  });
});
