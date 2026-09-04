import { jsonFail } from '../../../../../lib/http';

export async function POST(
  _request: Request,
  _context: { params: Promise<{ jobId: string }> },
) {
  return jsonFail(
    'PROJECT_SCOPE_REQUIRED',
    'Use the project-scoped job cancellation endpoint',
    410,
    { canonicalPath: '/api/projects/{projectId}/jobs/{jobId}/cancel' },
  );
}
