import { ensureDb, failureSummaryRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const document = await failureSummaryRepository.getActive(projectId);
  if (!document) {
    return jsonFail('NOT_FOUND', 'Failure summary not found', 404);
  }

  return jsonOk({
    documentId: document.id,
    summaryMarkdown: document.summaryMarkdown,
    summaryJson: document.summaryJson,
    versionNo: document.versionNo,
    updatedAt: document.updatedAt,
  });
}

