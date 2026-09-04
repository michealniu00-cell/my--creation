import {
  artifactRepository,
  lockRepository,
  type ShotMutationFailure,
} from '@video-agent-studio/db';
import { jsonFail } from './http';

function lockConflict(message: string, objectType: 'shot' | 'artifact_version', objectId: string, lockId?: string | null) {
  return jsonFail('LOCK_CONFLICT', message, 409, {
    objectType,
    objectId,
    lockId: lockId ?? null,
  });
}

export async function ensureShotUnlocked(shotId: string, message = 'This shot is locked and cannot be modified') {
  const status = await lockRepository.getStatus('shot', shotId);
  if (!status.locked) {
    return null;
  }

  return lockConflict(message, 'shot', shotId, status.lockId);
}

export async function ensureArtifactVersionUnlocked(
  versionId?: string | null,
  message = 'The active artifact version is locked and cannot be modified',
) {
  if (!versionId) {
    return null;
  }

  const status = await lockRepository.getStatus('artifact_version', versionId);
  if (!status.locked) {
    return null;
  }

  return lockConflict(message, 'artifact_version', versionId, status.lockId);
}

export async function ensureActiveArtifactVersionUnlocked(
  groupId: string,
  message = 'The active artifact version is locked and cannot be modified',
) {
  const artifact = await artifactRepository.getVersions(groupId);
  return ensureArtifactVersionUnlocked(artifact.group?.activeVersionId, message);
}

export function shotMutationFailureResponse(
  failure: ShotMutationFailure,
  lockMessage = 'This shot is locked and cannot be modified',
) {
  const details = {
    reason: failure.reason,
    projectId: failure.projectId,
    shotId: failure.shotId ?? null,
    lockId: failure.lockId ?? null,
  };

  switch (failure.reason) {
    case 'shot_locked':
      return jsonFail('LOCK_CONFLICT', lockMessage, 409, details);
    case 'project_not_found':
      return jsonFail('PROJECT_NOT_FOUND', 'Project not found', 404, details);
    case 'shot_not_found':
    case 'shot_project_mismatch':
      return jsonFail('SHOT_NOT_FOUND', 'Shot not found in this project', 404, details);
    case 'insert_after_shot_not_found':
    case 'insert_after_shot_project_mismatch':
      return jsonFail(
        'SHOT_NOT_FOUND',
        'Insert position shot not found in this project',
        404,
        details,
      );
    case 'duplicate_shot_ids':
    case 'reorder_set_mismatch':
      return jsonFail(
        'INVALID_SHOT_ORDER',
        'Shot order must contain every active shot in this project exactly once',
        400,
        {
          ...details,
          expectedShotIds: failure.expectedShotIds ?? [],
          receivedShotIds: failure.receivedShotIds ?? [],
        },
      );
  }
}
