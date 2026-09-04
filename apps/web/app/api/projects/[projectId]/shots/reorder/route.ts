import { reorderShotsSchema } from '@video-agent-studio/shared';
import { ensureDb, shotRepository } from '@video-agent-studio/db';
import { jsonOk, readJsonWithSchema } from '../../../../../../lib/http';
import { shotMutationFailureResponse } from '../../../../../../lib/route-guards';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const body = await readJsonWithSchema(request, reorderShotsSchema, {
    message: 'Invalid shot order payload',
  });
  if (!body.success) {
    return body.response;
  }
  const result = await shotRepository.reorderForProject(
    projectId,
    body.data.orderedShotIds,
  );
  if (!result.ok) {
    return shotMutationFailureResponse(
      result,
      'Locked shots cannot be reordered',
    );
  }
  return jsonOk({ updated: true });
}
