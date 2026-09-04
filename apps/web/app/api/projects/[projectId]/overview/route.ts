import { ensureDb, projectRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const overview = await projectRepository.getOverview(projectId);
  if (!overview) {
    return jsonFail('NOT_FOUND', 'Project not found', 404);
  }
  return jsonOk(overview);
}

