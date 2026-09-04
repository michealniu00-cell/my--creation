import { jsonFail } from '../../../../../lib/http';

export async function POST(
  _request: Request,
  _context: { params: Promise<{ conflictId: string }> },
) {
  return jsonFail(
    'PROJECT_SCOPE_REQUIRED',
    'Conflict writes require a project-scoped endpoint',
    410,
    {
      canonicalPath: '/api/projects/{projectId}/conflicts/{conflictId}/resolve',
    },
  );
}
