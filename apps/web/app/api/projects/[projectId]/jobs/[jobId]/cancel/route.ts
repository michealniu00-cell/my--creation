import { ensureDb, jobRepository } from '@video-agent-studio/db';
import { workflowJobCancelSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonStrict } from '../../../../../../../lib/http';

export async function POST(
  request: Request,
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
  const body = await readJsonStrict(request);
  if (!body.success) {
    return body.response;
  }
  const parsed = workflowJobCancelSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonFail('INVALID_JOB_COMMAND', '取消任务参数不合法', 400, {
      issues: parsed.error.issues,
    });
  }
  const cancelled = await jobRepository.requestCancellation(jobId, parsed.data.reason);
  if (!cancelled.job || cancelled.job.projectId !== projectId) {
    return jsonFail('NOT_FOUND', 'Job not found in this project', 404);
  }
  if (!cancelled.applied && cancelled.reason === 'invalid_state') {
    return jsonFail('JOB_ALREADY_TERMINAL', 'Job has already reached a terminal state', 409, {
      status: cancelled.job.status,
    });
  }
  return jsonOk({
    jobId: cancelled.job.id,
    status: cancelled.job.status,
    cancelRequestedAt: cancelled.job.cancelRequestedAt,
  });
}
