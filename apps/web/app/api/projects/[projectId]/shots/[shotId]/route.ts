import { updateShotSchema } from '@video-agent-studio/shared';
import { ensureDb, shotRepository } from '@video-agent-studio/db';
import { jsonOk, readJsonWithSchema } from '../../../../../../lib/http';
import { shotMutationFailureResponse } from '../../../../../../lib/route-guards';

export async function PATCH(
  request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; shotId: string }> },
) {
  await ensureDb();
  const { projectId, shotId } = await params;
  const body = await readJsonWithSchema(request, updateShotSchema, {
    message: 'Invalid shot patch',
  });
  if (!body.success) {
    return body.response;
  }

  const result = await shotRepository.updateForProject(
    projectId,
    shotId,
    body.data,
  );
  if (!result.ok) {
    return shotMutationFailureResponse(
      result,
      'Locked shot cannot be edited',
    );
  }

  return jsonOk({
    shotId: result.value.id,
    updated: true,
  });
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; shotId: string }> },
) {
  await ensureDb();
  const { projectId, shotId } = await params;
  const result = await shotRepository.softDeleteForProject(projectId, shotId);
  if (!result.ok) {
    return shotMutationFailureResponse(
      result,
      'Locked shot cannot be deleted',
    );
  }

  return jsonOk({
    shotId,
    deleted: true,
  });
}
