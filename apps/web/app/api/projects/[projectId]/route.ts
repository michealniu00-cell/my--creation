import { ensureDb, projectRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const project = await projectRepository.get(projectId);
  if (!project) {
    return jsonFail('NOT_FOUND', 'Project not found', 404);
  }
  return jsonOk(project);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const deleted = await projectRepository.softDelete(projectId);
  if (!deleted) {
    return jsonFail('NOT_FOUND', 'Project not found', 404);
  }
  return jsonOk({
    projectId,
    deleted: true,
  });
}

