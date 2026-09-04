import { jsonFail } from '../../../../../lib/http';

/**
 * Task execution is owned by the durable workflow job and workflow engine.
 * Retrying an isolated task here used to create agent output outside both
 * orchestration boundaries, so the legacy command is intentionally retired.
 */
export async function POST(
  _request: Request,
  _context: { params: Promise<{ taskId: string }> },
) {
  return jsonFail(
    'DURABLE_JOB_REQUIRED',
    '单个 Agent 任务不能绕过工作流重试；请恢复对应的后台任务，或显式重新运行该阶段',
    410,
    {
      recovery: 'Use the project-scoped workflow job resume endpoint',
      canonicalPath: '/api/projects/{projectId}/jobs/{jobId}/resume',
    },
  );
}
