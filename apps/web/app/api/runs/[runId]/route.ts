import { ensureDb, runRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  await ensureDb();
  const { runId } = await params;
  const run = await runRepository.get(runId);
  if (!run) {
    return jsonFail('NOT_FOUND', 'Run not found', 404);
  }
  return jsonOk({
    runId: run.id,
    workflowType: run.workflowType,
    status: run.status,
    currentNode: run.currentNode,
    retryCount: run.retryCount,
    requiresManualReview: run.requiresManualReview,
  });
}

