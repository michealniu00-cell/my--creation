import {
  artifactRepository,
  jobRepository,
  type ArtifactActivationExpectation,
  type ArtifactVersionCreateInput,
} from '@video-agent-studio/db';
import type { WorkflowType } from '@video-agent-studio/shared';
import { resolveWorkflowIdempotencyKey } from './workflow-job-command';

export async function enqueueShotRegeneration(input: {
  request: Request;
  idempotencyKey?: string;
  projectId: string;
  jobType: Extract<WorkflowType, 'storyboard' | 'video'>;
  groupId: string;
  payload: Record<string, unknown>;
  maxAttempts: number;
  timeoutMs: number;
  createPendingVersion: (
    jobId: string,
    expectation: ArtifactActivationExpectation,
  ) => ArtifactVersionCreateInput;
}) {
  const idempotencyKey =
    input.idempotencyKey ?? resolveWorkflowIdempotencyKey(input.request);
  const holdUntilPrepared = new Date(Date.now() + 30_000).toISOString();
  const queued = await jobRepository.enqueue({
    projectId: input.projectId,
    jobType: input.jobType,
    idempotencyKey,
    payload: input.payload,
    maxAttempts: input.maxAttempts,
    timeoutMs: input.timeoutMs,
    runAfter: holdUntilPrepared,
    priority: 10,
  });

  const versionsState = await artifactRepository.getVersions(input.groupId);
  const preparedVersion = versionsState.versions.find(
    (version) => version.generationInput.jobId === queued.job.id,
  );
  let version = preparedVersion ?? null;

  if (
    !version &&
    queued.job.status === 'queued' &&
    queued.job.attemptCount === 0
  ) {
    const group = versionsState.group;
    if (!group) {
      throw new Error('Artifact group not found while preparing regeneration');
    }
    version = await artifactRepository.createNextVersion(
      input.createPendingVersion(queued.job.id, {
        expectedActiveVersionId: group.activeVersionId ?? null,
        expectedGroupUpdatedAt: group.updatedAt,
      }),
    );
  }

  if (queued.job.status === 'queued' && queued.job.attemptCount === 0) {
    await jobRepository.makeRunnable(queued.job.id);
  }

  return {
    job: (await jobRepository.get(queued.job.id)) ?? queued.job,
    version,
    created: queued.created,
    idempotencyKey,
  };
}
