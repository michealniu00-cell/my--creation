import { artifactRepository, ensureDb } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shotId: string }> },
) {
  await ensureDb();
  const { shotId } = await params;
  const video = await artifactRepository.getShotVideo(shotId);
  if (!video?.group) {
    return jsonFail('NOT_FOUND', 'Video group not found', 404);
  }
  return jsonOk({
    artifactGroupId: video.group.id,
    activeVersionId: video.group.activeVersionId,
    versions: video.versions.map((version) => ({
      versionId: version.id,
      versionNo: version.versionNo,
      url: version.publicUrl,
      durationMs: version.durationMs,
      isPlaceholder: version.isPlaceholder,
      isActive: version.id === video.group?.activeVersionId,
    })),
  });
}

