import { artifactRepository, ensureDb } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shotId: string }> },
) {
  await ensureDb();
  const { shotId } = await params;
  const storyboard = await artifactRepository.getShotStoryboard(shotId);
  if (!storyboard?.group) {
    return jsonFail('NOT_FOUND', 'Storyboard not found', 404);
  }
  return jsonOk({
    artifactGroupId: storyboard.group.id,
    activeVersionId: storyboard.group.activeVersionId,
    versions: storyboard.versions.map((version) => ({
      versionId: version.id,
      versionNo: version.versionNo,
      url: version.publicUrl,
      versionNote: version.versionNote,
      isActive: version.id === storyboard.group?.activeVersionId,
    })),
  });
}

