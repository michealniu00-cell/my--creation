import { ensureDb, shotRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shotId: string }> },
) {
  await ensureDb();
  const { shotId } = await params;
  const shot = await shotRepository.get(shotId);
  if (!shot) {
    return jsonFail('NOT_FOUND', 'Shot not found', 404);
  }
  return jsonOk(shot);
}

export async function PATCH(
  _request: Request,
  _context: { params: Promise<{ shotId: string }> },
) {
  return jsonFail(
    'PROJECT_SCOPE_REQUIRED',
    'Shot writes require a project-scoped endpoint',
    410,
    { canonicalPath: '/api/projects/{projectId}/shots/{shotId}' },
  );
}

export async function DELETE(
  _request: Request,
  _context: { params: Promise<{ shotId: string }> },
) {
  return jsonFail(
    'PROJECT_SCOPE_REQUIRED',
    'Shot writes require a project-scoped endpoint',
    410,
    { canonicalPath: '/api/projects/{projectId}/shots/{shotId}' },
  );
}
