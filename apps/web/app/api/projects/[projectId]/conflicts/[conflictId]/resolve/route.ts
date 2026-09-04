import { controlPlaneRepository, ensureDb } from '@video-agent-studio/db';
import { conflictResolutionSchema } from '@video-agent-studio/shared';
import {
  jsonFail,
  jsonOk,
  readJsonWithSchema,
} from '../../../../../../../lib/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; conflictId: string }> },
) {
  await ensureDb();
  const { projectId, conflictId } = await params;
  const body = await readJsonWithSchema(request, conflictResolutionSchema, {
    message: 'Invalid conflict resolution request',
  });
  if (!body.success) {
    return body.response;
  }

  const updated = await controlPlaneRepository.resolveConflictForProject(
    projectId,
    conflictId,
    body.data.resolution,
  );
  if (!updated) {
    return jsonFail('NOT_FOUND', 'Conflict not found in this project', 404);
  }

  return jsonOk({ resolved: true }, { conflictId, projectId });
}
