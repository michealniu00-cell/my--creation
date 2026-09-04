import { ensureDb, jobRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../../../lib/http';

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; jobId: string }> },
) {
  await ensureDb();
  const { projectId, jobId } = await params;
  const job = await jobRepository.get(jobId);
  if (!job || job.projectId !== projectId) {
    return jsonFail('NOT_FOUND', 'Job not found in this project', 404);
  }
  const attempts = await jobRepository.listAttempts(jobId);
  return jsonOk({
    jobId: job.id,
    projectId: job.projectId,
    jobType: job.jobType,
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    timeoutMs: job.timeoutMs,
    checkpoint: job.checkpoint,
    checkpointVersion: job.checkpointVersion,
    cancelRequestedAt: job.cancelRequestedAt,
    cancelReason: job.cancelReason,
    result: job.result,
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
    completedAt: job.completedAt,
    attempts: attempts.map((attempt) => ({
      attemptNo: attempt.attemptNo,
      workerId: attempt.workerId,
      status: attempt.status,
      leaseStartedAt: attempt.leaseStartedAt,
      heartbeatAt: attempt.heartbeatAt,
      finishedAt: attempt.finishedAt,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
    })),
  });
}
