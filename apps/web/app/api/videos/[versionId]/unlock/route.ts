import { artifactRepository, ensureDb, lockRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../../lib/http';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  await ensureDb();
  const { versionId } = await params;
  const group = await artifactRepository.getGroupByVersion(versionId);
  if (!group || group.role !== 'video_clip') {
    return jsonFail('NOT_FOUND', 'Video version not found', 404);
  }

  await lockRepository.unlock('artifact_version', versionId);

  return jsonOk({
    unlocked: true,
    objectId: versionId,
  });
}
