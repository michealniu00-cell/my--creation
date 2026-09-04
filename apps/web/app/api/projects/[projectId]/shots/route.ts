import { createShotSchema } from '@video-agent-studio/shared';
import { ensureDb, shotRepository } from '@video-agent-studio/db';
import { jsonOk, readJsonWithSchema } from '../../../../../lib/http';
import { shotMutationFailureResponse } from '../../../../../lib/route-guards';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const { searchParams } = new URL(request.url);
  const includeAssets = searchParams.get('includeAssets') === 'true';
  const items = await shotRepository.list(projectId, includeAssets);
  return jsonOk({ items });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const body = await readJsonWithSchema(request, createShotSchema, {
    message: 'Invalid shot payload',
  });
  if (!body.success) {
    return body.response;
  }

  const result = await shotRepository.createForProject(
    projectId,
    body.data,
    body.data.insertAfterShotId,
  );
  if (!result.ok) {
    return shotMutationFailureResponse(
      result,
      'Locked shots prevent insertion at this position',
    );
  }
  return jsonOk({
    shotId: result.value.id,
    created: true,
  });
}
