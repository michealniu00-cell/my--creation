import { ensureDb, jobRepository, runRepository } from '@video-agent-studio/db';
import { videoWorkflowRunSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonStrict } from '../../../../../../../lib/http';
import { resolveWorkflowIdempotencyKey } from '../../../../../../../lib/workflow-job-command';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const body = await readJsonStrict(request);
  if (!body.success) {
    return body.response;
  }
  const parsed = videoWorkflowRunSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonFail(
      'INVALID_WORKFLOW_INPUT',
      '视频生成参数不合法；全量重生成必须显式确认，局部生成必须指定 Shot',
      400,
      { issues: parsed.error.issues },
    );
  }

  let idempotencyKey: string;
  try {
    idempotencyKey = resolveWorkflowIdempotencyKey(request);
  } catch (error) {
    return jsonFail('INVALID_IDEMPOTENCY_KEY', (error as Error).message, 400);
  }
  const existingJob = await jobRepository.findByIdempotencyKey(projectId, 'video', idempotencyKey);
  if (existingJob) {
    return jsonOk(
      {
        jobId: existingJob.id,
        workflowType: existingJob.jobType,
        status: existingJob.status,
        deduplicated: true,
      },
      { idempotencyKey },
      { headers: { 'idempotency-key': idempotencyKey } },
    );
  }

  const storyboardRun = await runRepository.getLatestByProject(projectId, 'storyboard');
  if (!storyboardRun || storyboardRun.status !== 'completed') {
    return jsonFail(
      'WORKFLOW_PREREQUISITE_REQUIRED',
      '请先完成当前分镜工作流，再生成视频',
      409,
    );
  }

  const queued = await jobRepository.enqueue({
    projectId,
    jobType: 'video',
    idempotencyKey,
    payload: parsed.data,
    maxAttempts: 2,
    timeoutMs: 60 * 60_000,
  });
  return jsonOk(
    {
      jobId: queued.job.id,
      workflowType: queued.job.jobType,
      status: queued.job.status,
      deduplicated: !queued.created,
    },
    { idempotencyKey },
    {
      status: queued.created ? 202 : 200,
      headers: { 'idempotency-key': idempotencyKey },
    },
  );
}
