import { artifactRepository, ensureDb, lockRepository, shotRepository } from '@video-agent-studio/db';
import { shotLockSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../../../lib/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shotId: string }> },
) {
  await ensureDb();
  const { shotId } = await params;
  const body = await readJsonWithSchema(request, shotLockSchema, {
    message: 'Invalid Shot lock payload',
  });
  if (!body.success) {
    return body.response;
  }
  const shot = await shotRepository.get(shotId);
  const storyboard = await artifactRepository.getShotStoryboard(shotId);
  const video = await artifactRepository.getShotVideo(shotId);
  const projectId = shot?.projectId ?? storyboard?.group?.projectId ?? video?.group?.projectId;
  if (!projectId) {
    return jsonFail('NOT_FOUND', 'Shot not found', 404);
  }
  const lock = await lockRepository.lock({
    projectId,
    objectType: 'shot',
    objectId: shotId,
    lockScope: body.data.cascade ? 'cascade' : 'self',
    cascadeChildren: [
      storyboard?.group?.activeVersionId,
      video?.group?.activeVersionId,
    ].filter(Boolean) as string[],
    lockedByUserId: null,
    lockReason: body.data.reason ?? null,
    isActive: true,
  });
  return jsonOk({
    lockId: lock.id,
    objectType: 'shot',
    objectId: shotId,
    cascade: body.data.cascade,
  });
}
