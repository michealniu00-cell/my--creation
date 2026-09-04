import { ensureDb, jobRepository } from '@video-agent-studio/db';
import { workflowJobResumeSchema } from '@video-agent-studio/shared';
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
  const parsed = workflowJobResumeSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonFail('INVALID_JOB_COMMAND', '恢复任务参数不合法', 400, {
      issues: parsed.error.issues,
    });
  }
  const resumed = await jobRepository.resume(jobId, parsed.data);
  if (!resumed.job || resumed.job.projectId !== projectId) {
    return jsonFail('NOT_FOUND', 'Job not found in this project', 404);
  }
  if (!resumed.applied) {
    return jsonFail('JOB_NOT_RESUMABLE', 'Only failed or cancelled jobs can be resumed', 409, {
      status: resumed.job.status,
    });
  }
  return jsonOk({
    jobId: resumed.job.id,
    status: resumed.job.status,
    maxAttempts: resumed.job.maxAttempts,
    resumeCount: resumed.job.resumeCount,
  });
}
