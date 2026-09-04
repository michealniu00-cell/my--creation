import {
  ensureDb,
  jobRepository,
  manualGateRepository,
  runRepository,
  shotRepository,
  taskRepository,
} from '@video-agent-studio/db';
import { storyboardWorkflowRunSchema } from '@video-agent-studio/shared';
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
  const parsed = storyboardWorkflowRunSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonFail('INVALID_WORKFLOW_INPUT', '分镜工作流参数不合法', 400, {
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
    'storyboard',
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

  const scriptGate = await manualGateRepository.getScriptGateState(projectId);
  if (!scriptGate.confirmed) {
    return jsonFail(
      'MANUAL_GATE_REQUIRED',
      '请先确认当前最终脚本，再进入 Shot 制作阶段',
      409,
    );
  }
  const [historicalRun, historicalOutputs, historicalShots] = await Promise.all(
    [
      runRepository.getLatestByProject(projectId, 'storyboard'),
      taskRepository.listByProjectAndStage(projectId, 'storyboard'),
      shotRepository.list(projectId, false),
    ],
  );
  if (
    (historicalRun ||
      historicalOutputs.length > 0 ||
      historicalShots.length > 0) &&
    parsed.data.confirmStageRegeneration !== true
  ) {
    return jsonFail(
      'STAGE_REGENERATION_CONFIRMATION_REQUIRED',
      '项目已有分镜运行记录；重新生成整个分镜阶段前必须显式确认',
      409,
    );
  }
  const queued = await jobRepository.enqueue({
    projectId,
    jobType: 'storyboard',
    idempotencyKey,
    payload: parsed.data,
    maxAttempts: 2,
    timeoutMs: 30 * 60_000,
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
