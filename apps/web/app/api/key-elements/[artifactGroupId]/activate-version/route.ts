import { artifactRepository, ensureDb } from '@video-agent-studio/db';
import { activateArtifactVersionSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonStrict } from '../../../../../lib/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactGroupId: string }> },
) {
  await ensureDb();
  const { artifactGroupId } = await params;
  const body = await readJsonStrict(request);
  if (!body.success) {
    return body.response;
  }
  const parsed = activateArtifactVersionSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonFail(
      'VALIDATION_ERROR',
      'Invalid key element version activation payload',
      400,
    );
  }

  const result = await artifactRepository.replaceKeyElementIfExpected(
    artifactGroupId,
    parsed.data.versionId,
    'referenced_shots',
    {
      expectedActiveVersionId: parsed.data.expectedActiveVersionId,
      ...(parsed.data.expectedGroupUpdatedAt
        ? { expectedGroupUpdatedAt: parsed.data.expectedGroupUpdatedAt }
        : {}),
    },
  );
  if (!result.ok) {
    if (
      result.reason === 'group_not_found' ||
      result.reason === 'version_not_found'
    ) {
      return jsonFail('NOT_FOUND', 'Artifact group or version not found', 404);
    }
    if (result.reason === 'version_not_ready') {
      return jsonFail('VERSION_NOT_READY', '此版本尚未生成成功或未通过审核，当前生效版本保持不变。', 409);
    }
    const lockConflict = result.reason.endsWith('_locked');
    return jsonFail(
      lockConflict ? 'LOCK_CONFLICT' : 'ARTIFACT_VERSION_CONFLICT',
      lockConflict
        ? 'Locked key element state cannot switch active version'
        : 'Key element active version changed before this request could commit',
      409,
      {
        reason: result.reason,
        artifactGroupId,
        candidateVersionId: parsed.data.versionId,
        actualActiveVersionId: result.actualActiveVersionId,
        actualGroupUpdatedAt: result.actualGroupUpdatedAt,
        lockId: result.lockId,
      },
    );
  }
  if (!result.group) {
    return jsonFail('NOT_FOUND', 'Artifact group or version not found', 404);
  }
  return jsonOk({
    artifactGroupId: result.group.id,
    activeVersionId: result.group.activeVersionId,
    changed: result.changed,
  });
}
