import { artifactRepository, ensureDb, lockRepository } from '@video-agent-studio/db';
import { versionLockSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../../../lib/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  await ensureDb();
  const { versionId } = await params;
  const body = await readJsonWithSchema(request, versionLockSchema, {
    message: 'Invalid video lock payload',
  });
  if (!body.success) {
    return body.response;
  }

  const group = await artifactRepository.getGroupByVersion(versionId);
  if (!group || group.role !== 'video_clip') {
    return jsonFail('NOT_FOUND', 'Video version not found', 404);
  }

  const lock = await lockRepository.lock({
    projectId: group.projectId,
    objectType: 'artifact_version',
    objectId: versionId,
    lockScope: 'self',
    cascadeChildren: [],
    lockedByUserId: null,
    lockReason: body.data.reason ?? null,
    isActive: true,
  });

  return jsonOk({
    lockId: lock.id,
    objectType: 'artifact_version',
    objectId: versionId,
  });
}
