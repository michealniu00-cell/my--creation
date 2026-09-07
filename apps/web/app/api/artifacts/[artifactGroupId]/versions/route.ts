import { artifactRepository, ensureDb, lockRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactGroupId: string }> },
) {
  await ensureDb();
  const { artifactGroupId } = await params;
  const artifact = await artifactRepository.getVersions(artifactGroupId);
  if (!artifact.group) {
    return jsonFail('NOT_FOUND', 'Artifact group not found', 404);
  }
  const versions = await Promise.all(
    artifact.versions.map(async (version) => {
      const lockStatus = await lockRepository.getStatus('artifact_version', version.id);
      return {
        versionId: version.id,
        versionNo: version.versionNo,
        status: version.status,
        versionNote: version.versionNote,
        isActive: version.id === artifact.group?.activeVersionId,
        isLocked: lockStatus.locked,
        createdAt: version.createdAt,
        generatedByAgent: version.generatedByAgent ?? null,
      };
    }),
  );
  return jsonOk({
    artifactGroupId,
    activeVersionId: artifact.group.activeVersionId,
    versions,
  });
}
