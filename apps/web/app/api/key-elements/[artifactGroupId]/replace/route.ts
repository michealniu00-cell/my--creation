import { artifactRepository, ensureDb } from '@video-agent-studio/db';
import { keyElementReplaceSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../../../lib/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactGroupId: string }> },
) {
  await ensureDb();
  const { artifactGroupId } = await params;
  const body = await readJsonWithSchema(request, keyElementReplaceSchema, {
    message: 'Invalid key element replace payload',
  });
  if (!body.success) {
    return body.response;
  }

  const result = await artifactRepository.replaceKeyElementIfExpected(
    artifactGroupId,
    body.data.newVersionId,
    body.data.impactScope,
    {
      expectedActiveVersionId: body.data.expectedActiveVersionId,
      ...(body.data.expectedGroupUpdatedAt
        ? { expectedGroupUpdatedAt: body.data.expectedGroupUpdatedAt }
        : {}),
    },
  );

  if (!result.ok) {
    if (
      result.reason === 'group_not_found' ||
      result.reason === 'version_not_found'
    ) {
      return jsonFail(
        'NOT_FOUND',
        'Key element group or version not found',
        404,
      );
    }
    if (result.reason === 'version_not_ready') {
      return jsonFail('VERSION_NOT_READY', '此版本尚未生成成功或未通过审核，当前生效版本保持不变。', 409);
    }
    const lockConflict = result.reason.endsWith('_locked');
    return jsonFail(
      lockConflict ? 'LOCK_CONFLICT' : 'ARTIFACT_VERSION_CONFLICT',
      lockConflict
        ? 'Locked key element state cannot be replaced'
        : 'Key element active version changed before this request could commit',
      409,
      {
        reason: result.reason,
        artifactGroupId,
        candidateVersionId: body.data.newVersionId,
        actualActiveVersionId: result.actualActiveVersionId,
        actualGroupUpdatedAt: result.actualGroupUpdatedAt,
        lockId: result.lockId,
      },
    );
  }

  return jsonOk({
    replaced: true,
    impactScope: body.data.impactScope,
    artifactGroupId: result.group.id,
    activeVersionId: result.group.activeVersionId,
    changed: result.changed,
  });
}
