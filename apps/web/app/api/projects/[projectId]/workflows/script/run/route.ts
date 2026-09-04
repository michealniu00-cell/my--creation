import {
  configRepository,
  ensureDb,
  jobRepository,
  runRepository,
  taskRepository,
} from '@video-agent-studio/db';
import { scriptWorkflowRunSchema } from '@video-agent-studio/shared';
import {
  jsonFail,
  jsonOk,
  readJsonStrict,
} from '../../../../../../../lib/http';
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
  const parsed = scriptWorkflowRunSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonFail('INVALID_WORKFLOW_INPUT', '脚本工作流参数不合法', 400, {
      issues: parsed.error.issues,
    });
  }

  let idempotencyKey: string;
  try {
    idempotencyKey = resolveWorkflowIdempotencyKey(request);
  } catch (error) {
    return jsonFail('INVALID_IDEMPOTENCY_KEY', (error as Error).message, 400);
  }
  const existingJob = await jobRepository.findByIdempotencyKey(
    projectId,
    'script',
    idempotencyKey,
  );
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

  const configs = await configRepository.list(projectId);
  const selectedConfig = parsed.data.configVersionId
    ? configs.find((item) => item.id === parsed.data.configVersionId)
    : configs.find((item) => item.isActive);
  if (
    !selectedConfig ||
    !selectedConfig.isActive ||
    !selectedConfig.confirmedByUser
  ) {
    return jsonFail(
      'MANUAL_GATE_REQUIRED',
      '请先由用户确认当前创作设定，再启动脚本工作流',
      409,
    );
  }
  const [historicalRun, historicalOutputs] = await Promise.all([
    runRepository.getLatestByProject(projectId, 'script'),
    taskRepository.listByProjectAndStage(projectId, 'script'),
  ]);
  if (
    (historicalRun || historicalOutputs.length > 0) &&
    parsed.data.confirmStageRegeneration !== true
  ) {
    return jsonFail(
      'STAGE_REGENERATION_CONFIRMATION_REQUIRED',
      '项目已有脚本运行记录；重新生成整个脚本阶段前必须显式确认',
      409,
    );
  }
  const queued = await jobRepository.enqueue({
    projectId,
    jobType: 'script',
    idempotencyKey,
    payload: parsed.data,
    maxAttempts: 3,
    timeoutMs: 15 * 60_000,
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
