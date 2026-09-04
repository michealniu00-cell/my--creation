import { ensureDb, controlPlaneRepository } from '@video-agent-studio/db';
import { impactAnalysisSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../../../lib/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const body = await readJsonWithSchema(request, impactAnalysisSchema, {
    message: 'Invalid impact analysis request',
  });
  if (!body.success) {
    return body.response;
  }

  const result = await controlPlaneRepository.analyzeImpact(projectId, body.data);
  if (!result) {
    return jsonFail('NOT_FOUND', 'Project or target object not found', 404);
  }

  return jsonOk(result.analysis, result.conflictId ? { conflictId: result.conflictId } : undefined);
}
