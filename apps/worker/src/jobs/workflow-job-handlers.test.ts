import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  artifactRepository,
  ensureDb,
  jobRepository,
  lockRepository,
  readDb,
  runRepository,
} from '@video-agent-studio/db';
import { MockVideoProvider } from '@video-agent-studio/providers';
import { DurableJobRunner } from './job-runner';
import {
  createWorkflowJobHandlers,
  type WorkflowJobHandlerDependencies,
} from './workflow-job-handlers';

describe('workflow durable job recovery', () => {
  let tempDirectory = '';
  let projectId = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'vas-workflow-job-recovery-'),
    );
    process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(
      tempDirectory,
      'db.json',
    );
    const db = await ensureDb();
    projectId = db.projects[0].id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('resumes a local video supplier task from the durable checkpoint without another submission', async () => {
    const db = await readDb();
    const candidates = await Promise.all(db.shots.filter((s) => s.projectId === projectId).map(async (shot) => ({
      shot, video: await artifactRepository.getShotVideo(shot.id),
      locked: await lockRepository.isLocked('shot', shot.id),
    })));
    const target = candidates.find((item) => item.video?.group && !item.locked);
    if (!target?.video?.group) throw new Error('Expected an unlocked video fixture');
    const beforeCount = target.video.versions.length;
    const { job } = await jobRepository.enqueue({
      projectId, jobType: 'video', idempotencyKey: 'local-remote-video-recovery',
      payload: { action: 'regenerate_shot_video', shotId: target.shot.id, promptHint: 'recovery test' },
      maxAttempts: 2, timeoutMs: 5000,
    });
    let submissions = 0;
    vi.spyOn(MockVideoProvider.prototype, 'generate').mockImplementation(async (input) => {
      if (!input.resumeRemoteTaskId) {
        submissions += 1;
        await input.onRemoteTaskSubmitted?.('durable-remote-1');
        throw new Error('connection interrupted after submission');
      }
      expect(input.resumeRemoteTaskId).toBe('durable-remote-1');
      return { url: 'https://example.test/recovered.mp4', remoteId: input.resumeRemoteTaskId, mimeType: 'video/mp4' };
    });
    const runner = new DurableJobRunner({
      workerId: 'remote-recovery-worker', leaseDurationMs: 1000,
      heartbeatIntervalMs: 100, retryDelayMs: () => 0,
      handlers: createWorkflowJobHandlers(),
    });
    expect((await runner.runOnce()).state).toBe('retry_scheduled');
    expect((await jobRepository.get(job.id))?.checkpoint.remoteVideoTasks).toBeTruthy();
    expect((await runner.runOnce()).state).toBe('succeeded');
    const after = await artifactRepository.getShotVideo(target.shot.id);
    expect(submissions).toBe(1);
    expect(after?.versions).toHaveLength(beforeCount + 1);
    expect(after?.versions.find((v) => v.id === after.group?.activeVersionId)?.metadata.remoteTaskId).toBe('durable-remote-1');
  });

  it('reuses the bound run when the workflow settled before its completed checkpoint', async () => {
    const { job } = await jobRepository.enqueue({
      projectId,
      jobType: 'script',
      idempotencyKey: 'crash-after-workflow-side-effects',
      payload: {},
      maxAttempts: 2,
      timeoutMs: 1_000,
    });

    let workflowExecutions = 0;
    const workflow: WorkflowJobHandlerDependencies['runScriptWorkflow'] =
      async (workflowProjectId, _configVersionId, options) => {
        if (!options?.jobId) {
          throw new Error('Expected the durable job identity');
        }
        workflowExecutions += 1;
        const resolution = await runRepository.createOnceForJob(
          workflowProjectId,
          options.jobId,
          {
            workflowType: 'script',
            triggerMode: 'manual',
            startFromNode: 'agent2',
            endAtNode: 'script_user_confirm',
            currentNode: 'agent2',
            runReason: 'durable recovery test',
          },
        );
        await options.onRunReady?.(resolution.run.id);

        const group = await artifactRepository.getOrCreateGroup({
          projectId: workflowProjectId,
          scopeType: 'project',
          scopeId: workflowProjectId,
          artifactType: 'document',
          role: 'script_doc',
          name: 'Durable recovery output',
          activeVersionId: null,
          status: 'active',
          isUserManaged: false,
          note: null,
        });
        await artifactRepository.createNextVersion({
          groupId: group.id,
          generatedByAgent: 'agent4',
          sourceTaskId: null,
          mimeType: 'text/markdown',
          storageBucket: null,
          storagePath: null,
          publicUrl: null,
          fileSizeBytes: null,
          width: null,
          height: null,
          durationMs: null,
          generationInput: { jobId: options.jobId },
          metadata: { test: true },
          status: 'generated',
          versionNote: 'side effect before simulated crash',
          isPlaceholder: false,
        });
        await runRepository.update(resolution.run.id, {
          currentNode: 'script_user_confirm',
          status: 'reviewing',
          requiresManualReview: true,
          finishedAt: new Date().toISOString(),
        });
        return runRepository.get(resolution.run.id);
      };

    const saveCheckpoint = jobRepository.saveCheckpoint.bind(jobRepository);
    let dropFirstCompletedCheckpoint = true;
    vi.spyOn(jobRepository, 'saveCheckpoint').mockImplementation(
      async (jobId, workerId, checkpoint, now) => {
        if (
          dropFirstCompletedCheckpoint &&
          checkpoint.phase === 'workflow_completed'
        ) {
          dropFirstCompletedCheckpoint = false;
          throw new Error('simulated worker crash before completed checkpoint');
        }
        return saveCheckpoint(jobId, workerId, checkpoint, now);
      },
    );

    const runner = new DurableJobRunner({
      workerId: 'recovery-worker',
      leaseDurationMs: 500,
      heartbeatIntervalMs: 50,
      retryDelayMs: () => 0,
      handlers: createWorkflowJobHandlers({ runScriptWorkflow: workflow }),
    });

    expect((await runner.runOnce()).state).toBe('retry_scheduled');
    const interruptedJob = await jobRepository.get(job.id);
    expect(interruptedJob?.checkpoint).toMatchObject({
      phase: 'workflow_running',
      workflowRunId: expect.any(String),
    });
    expect((await runner.runOnce()).state).toBe('succeeded');

    const db = await readDb();
    const linkedRuns = db.workflowRuns.filter(
      (run) => run.originJobId === job.id && !run.deletedAt,
    );
    const recoveryGroup = db.artifactGroups.find(
      (group) =>
        group.projectId === projectId &&
        group.name === 'Durable recovery output' &&
        !group.deletedAt,
    );
    const versions = db.artifactVersions.filter(
      (version) => version.groupId === recoveryGroup?.id && !version.deletedAt,
    );
    const persistedJob = await jobRepository.get(job.id);

    expect(workflowExecutions).toBe(1);
    expect(linkedRuns).toHaveLength(1);
    expect(versions).toHaveLength(1);
    expect(persistedJob?.result).toMatchObject({
      runId: linkedRuns[0].id,
      workflowType: 'script',
      runStatus: 'reviewing',
    });
    expect(persistedJob?.checkpoint).toMatchObject({
      phase: 'workflow_completed',
      workflowRunId: linkedRuns[0].id,
    });
    expect(
      (await jobRepository.listAttempts(job.id)).map(
        (attempt) => attempt.status,
      ),
    ).toEqual(['failed', 'succeeded']);
  });

  it('can explicitly resume a failed bound run without creating a second run', async () => {
    const { job } = await jobRepository.enqueue({
      projectId,
      jobType: 'script',
      idempotencyKey: 'resume-failed-bound-run',
      payload: {},
      maxAttempts: 1,
      timeoutMs: 1_000,
    });
    let workflowExecutions = 0;
    const workflow: WorkflowJobHandlerDependencies['runScriptWorkflow'] =
      async (workflowProjectId, _configVersionId, options) => {
        if (!options?.jobId) {
          throw new Error('Expected the durable job identity');
        }
        workflowExecutions += 1;
        const resolution = await runRepository.createOnceForJob(
          workflowProjectId,
          options.jobId,
          {
            workflowType: 'script',
            triggerMode: 'manual',
            startFromNode: 'agent2',
            endAtNode: 'script_user_confirm',
            currentNode: 'agent2',
            runReason: 'explicit resume test',
          },
        );
        await options.onRunReady?.(resolution.run.id);

        if (workflowExecutions === 1) {
          await runRepository.update(resolution.run.id, {
            status: 'failed',
            errorType: 'system',
            errorMessage: 'configuration unavailable',
            finishedAt: new Date().toISOString(),
          });
        } else {
          expect(options.resumeExistingRun).toBe(true);
          await runRepository.update(resolution.run.id, {
            currentNode: 'script_user_confirm',
            status: 'reviewing',
            requiresManualReview: true,
            errorType: null,
            errorMessage: null,
            finishedAt: new Date().toISOString(),
          });
        }
        return runRepository.get(resolution.run.id);
      };
    const runner = new DurableJobRunner({
      workerId: 'resume-worker',
      leaseDurationMs: 500,
      heartbeatIntervalMs: 50,
      handlers: createWorkflowJobHandlers({ runScriptWorkflow: workflow }),
    });

    expect((await runner.runOnce()).state).toBe('failed');
    expect((await jobRepository.get(job.id))?.lastErrorCode).toBe(
      'WORKFLOW_CONFIG_ERROR',
    );
    expect((await jobRepository.resume(job.id)).applied).toBe(true);
    expect((await runner.runOnce()).state).toBe('succeeded');

    const db = await readDb();
    expect(workflowExecutions).toBe(2);
    expect(
      db.workflowRuns.filter(
        (run) => run.originJobId === job.id && !run.deletedAt,
      ),
    ).toHaveLength(1);
    expect((await jobRepository.get(job.id))?.result).toMatchObject({
      workflowType: 'script',
      runStatus: 'reviewing',
    });
  });
});
