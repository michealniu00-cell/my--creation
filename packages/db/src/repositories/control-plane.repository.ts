import type {
  ImpactAnalysisResult,
  UserAnnotationRecord,
} from '@video-agent-studio/shared';
import {
  type CanonicalControlPlaneObjectType,
  normalizeControlPlaneChangeType,
  normalizeControlPlaneObjectType,
} from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';
import { appendTaskEvent } from './event.repository';

type ImpactTarget = {
  type: string;
  id: string;
};

type ConflictContent = {
  conflictId: string;
  status: 'pending' | 'resolved';
  objectType: CanonicalControlPlaneObjectType;
  objectId: string;
  changeType: string;
  impactLevel: ImpactAnalysisResult['impactLevel'];
  affectedObjects: ImpactTarget[];
  requiresUserConfirmation: boolean;
  warnings: string[];
  resolution?: string | null;
  analysisAt: string;
  resolvedAt?: string | null;
};

function uniqueTargets(targets: ImpactTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.type}:${target.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function activeVersionForGroup(
  db: Awaited<ReturnType<typeof readDb>>,
  groupId: string,
) {
  const versions = db.artifactVersions
    .filter((version) => version.groupId === groupId && !version.deletedAt)
    .sort((a, b) => b.versionNo - a.versionNo);
  return (
    versions.find(
      (version) =>
        version.id ===
        db.artifactGroups.find((group) => group.id === groupId)
          ?.activeVersionId,
    ) ??
    versions[0] ??
    null
  );
}

function isObjectLocked(
  db: Awaited<ReturnType<typeof readDb>>,
  objectType: 'shot' | 'artifact_version',
  objectId?: string | null,
) {
  if (!objectId) {
    return false;
  }

  return db.objectLocks.some(
    (lock) =>
      lock.objectType === objectType &&
      lock.objectId === objectId &&
      lock.isActive &&
      !lock.deletedAt,
  );
}

function getShotAssets(db: Awaited<ReturnType<typeof readDb>>, shotId: string) {
  const storyboardBinding = db.shotAssetBindings.find(
    (binding) =>
      binding.shotId === shotId &&
      binding.bindingRole === 'storyboard_main' &&
      !binding.deletedAt,
  );
  const videoBinding = db.shotAssetBindings.find(
    (binding) =>
      binding.shotId === shotId &&
      binding.bindingRole === 'video_main' &&
      !binding.deletedAt,
  );
  const storyboardGroup = db.artifactGroups.find(
    (group) =>
      group.id === storyboardBinding?.artifactGroupId && !group.deletedAt,
  );
  const videoGroup = db.artifactGroups.find(
    (group) => group.id === videoBinding?.artifactGroupId && !group.deletedAt,
  );
  return {
    storyboardGroup,
    videoGroup,
    storyboardVersion: storyboardGroup
      ? activeVersionForGroup(db, storyboardGroup.id)
      : null,
    videoVersion: videoGroup ? activeVersionForGroup(db, videoGroup.id) : null,
  };
}

function findArtifactGroup(
  db: Awaited<ReturnType<typeof readDb>>,
  objectId: string,
  expectedRoles: string[],
) {
  const directGroup = db.artifactGroups.find(
    (group) =>
      group.id === objectId &&
      expectedRoles.includes(group.role) &&
      !group.deletedAt,
  );
  if (directGroup) {
    return directGroup;
  }

  const version = db.artifactVersions.find(
    (item) => item.id === objectId && !item.deletedAt,
  );
  if (version) {
    const group = db.artifactGroups.find(
      (item) =>
        item.id === version.groupId &&
        expectedRoles.includes(item.role) &&
        !item.deletedAt,
    );
    if (group) {
      return group;
    }
  }

  const shot = db.shots.find(
    (item) =>
      item.id === objectId && item.status !== 'deleted' && !item.deletedAt,
  );
  if (!shot) {
    return null;
  }

  const bindingRole = expectedRoles.includes('storyboard_image')
    ? 'storyboard_main'
    : expectedRoles.includes('video_clip')
      ? 'video_main'
      : null;
  if (!bindingRole) {
    return null;
  }

  const binding = db.shotAssetBindings.find(
    (item) =>
      item.shotId === shot.id &&
      item.bindingRole === bindingRole &&
      !item.deletedAt,
  );
  if (!binding) {
    return null;
  }

  return (
    db.artifactGroups.find(
      (item) =>
        item.id === binding.artifactGroupId &&
        expectedRoles.includes(item.role) &&
        !item.deletedAt,
    ) ?? null
  );
}

function findReferencedShots(
  db: Awaited<ReturnType<typeof readDb>>,
  artifactGroupId: string,
) {
  return db.shotAssetBindings
    .filter(
      (binding) =>
        binding.artifactGroupId === artifactGroupId && !binding.deletedAt,
    )
    .map((binding) =>
      db.shots.find(
        (shot) =>
          shot.id === binding.shotId &&
          shot.status !== 'deleted' &&
          !shot.deletedAt,
      ),
    )
    .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot));
}

function getNeighboringShots(
  db: Awaited<ReturnType<typeof readDb>>,
  projectId: string,
  shotId: string,
) {
  const orderedShots = db.shots
    .filter(
      (shot) =>
        shot.projectId === projectId &&
        shot.status !== 'deleted' &&
        !shot.deletedAt,
    )
    .sort((a, b) => a.shotIndexGlobal - b.shotIndexGlobal);
  const index = orderedShots.findIndex((shot) => shot.id === shotId);
  if (index < 0) {
    return [];
  }
  return [orderedShots[index - 1], orderedShots[index + 1]].filter(
    Boolean,
  ) as typeof orderedShots;
}

function parseConflictContent(content: string): ConflictContent | null {
  try {
    const parsed = JSON.parse(content) as ConflictContent;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'conflictId' in parsed &&
      'status' in parsed
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function buildConflictContent(
  conflictId: string,
  input: {
    objectType: CanonicalControlPlaneObjectType;
    objectId: string;
    changeType: string;
    impactLevel: ImpactAnalysisResult['impactLevel'];
    affectedObjects: ImpactTarget[];
    requiresUserConfirmation: boolean;
    warnings: string[];
    status: ConflictContent['status'];
    resolution?: string | null;
    analysisAt: string;
    resolvedAt?: string | null;
  },
) {
  return JSON.stringify({
    conflictId,
    status: input.status,
    objectType: input.objectType,
    objectId: input.objectId,
    changeType: input.changeType,
    impactLevel: input.impactLevel,
    affectedObjects: input.affectedObjects,
    requiresUserConfirmation: input.requiresUserConfirmation,
    warnings: input.warnings,
    resolution: input.resolution ?? null,
    analysisAt: input.analysisAt,
    resolvedAt: input.resolvedAt ?? null,
  } satisfies ConflictContent);
}

function assessImpactLevel(
  objectType: CanonicalControlPlaneObjectType,
  changeType: string,
  affectedObjects: ImpactTarget[],
  warnings: string[],
  lockedRelated = false,
): ImpactAnalysisResult['impactLevel'] {
  const normalizedChangeType = normalizeControlPlaneChangeType(changeType);
  if (
    lockedRelated ||
    normalizedChangeType === 'delete' ||
    normalizedChangeType === 'replace' ||
    normalizedChangeType === 'reorder' ||
    affectedObjects.length >= 4 ||
    (objectType !== 'shot' && affectedObjects.length >= 2)
  ) {
    return 'high';
  }

  if (
    normalizedChangeType === 'regenerate' ||
    normalizedChangeType === 'update' ||
    warnings.length > 0 ||
    affectedObjects.length >= 2
  ) {
    return 'medium';
  }

  return 'low';
}

export const controlPlaneRepository = {
  async analyzeImpact(
    projectId: string,
    input: {
      objectType: CanonicalControlPlaneObjectType | string;
      objectId: string;
      changeType: string;
    },
  ) {
    const db = await readDb();
    const project = db.projects.find(
      (item) => item.id === projectId && !item.deletedAt,
    );
    if (!project) {
      return null;
    }

    const objectType = normalizeControlPlaneObjectType(
      input.objectType as CanonicalControlPlaneObjectType,
    );
    const changeType = normalizeControlPlaneChangeType(input.changeType);
    const warnings: string[] = [];
    const impactedObjects: ImpactTarget[] = [];
    let lockedRelated = false;

    if (objectType === 'shot') {
      const shot = db.shots.find(
        (item) =>
          item.id === input.objectId &&
          item.projectId === projectId &&
          item.status !== 'deleted' &&
          !item.deletedAt,
      );
      if (!shot) {
        return null;
      }

      impactedObjects.push({ type: 'shot', id: shot.id });
      if (isObjectLocked(db, 'shot', shot.id)) {
        lockedRelated = true;
        warnings.push('锁定对象与上游变更冲突');
      }

      getNeighboringShots(db, projectId, shot.id).forEach((neighbor) => {
        if (!neighbor) {
          return;
        }
        impactedObjects.push({ type: 'shot', id: neighbor.id });
      });
      if (
        impactedObjects.some(
          (item) => item.type === 'shot' && item.id !== shot.id,
        )
      ) {
        warnings.push('该修改可能触发相邻shot联动调整');
      }

      const assets = getShotAssets(db, shot.id);
      if (assets.storyboardGroup) {
        impactedObjects.push({
          type: 'storyboard',
          id: assets.storyboardGroup.id,
        });
        if (
          isObjectLocked(db, 'artifact_version', assets.storyboardVersion?.id)
        ) {
          lockedRelated = true;
          warnings.push('Storyboard 当前生效版本已锁定');
        }
      }
      if (assets.videoGroup) {
        impactedObjects.push({ type: 'video', id: assets.videoGroup.id });
        if (isObjectLocked(db, 'artifact_version', assets.videoVersion?.id)) {
          lockedRelated = true;
          warnings.push('Video 当前生效版本已锁定');
        }
      }

      const keyElementBindings = db.shotAssetBindings.filter(
        (binding) =>
          binding.shotId === shot.id &&
          [
            'character_ref',
            'scene_ref',
            'prop_ref',
            'style_ref',
            'effect_ref',
          ].includes(binding.bindingRole) &&
          !binding.deletedAt,
      );
      keyElementBindings.forEach((binding) => {
        impactedObjects.push({
          type: 'key_element',
          id: binding.artifactGroupId,
        });
        if (
          isObjectLocked(
            db,
            'artifact_version',
            db.artifactGroups.find(
              (group) => group.id === binding.artifactGroupId,
            )?.activeVersionId,
          )
        ) {
          lockedRelated = true;
          warnings.push('关联关键要素当前版本已锁定');
        }
      });
    } else {
      const expectedRoles =
        objectType === 'storyboard'
          ? ['storyboard_image']
          : objectType === 'video'
            ? ['video_clip']
            : [
                'character_ref',
                'scene_ref',
                'prop_ref',
                'style_ref',
                'effect_ref',
              ];
      const group = findArtifactGroup(db, input.objectId, expectedRoles);
      if (!group || group.projectId !== projectId) {
        return null;
      }

      impactedObjects.push({ type: objectType, id: group.id });
      const activeVersion = activeVersionForGroup(db, group.id);
      if (
        activeVersion &&
        isObjectLocked(db, 'artifact_version', activeVersion.id)
      ) {
        lockedRelated = true;
        warnings.push('锁定对象与上游变更冲突');
      }

      const referencedShots = findReferencedShots(db, group.id);
      referencedShots.forEach((shot) => {
        impactedObjects.push({ type: 'shot', id: shot.id });
      });

      if (objectType === 'storyboard') {
        referencedShots.forEach((shot) => {
          const shotVideo = getShotAssets(db, shot.id).videoGroup;
          if (shotVideo) {
            impactedObjects.push({ type: 'video', id: shotVideo.id });
          }
        });
        if (referencedShots.length > 1) {
          warnings.push('当前修改会影响多个 shot 的视频生成链路');
        }
      }

      if (objectType === 'video' && referencedShots.length > 1) {
        warnings.push('当前修改会影响多个 shot');
      }

      if (objectType === 'key_element') {
        const shotCount = referencedShots.length;
        if (shotCount > 0) {
          warnings.push(
            shotCount > 1
              ? '当前关键要素被多个 shot 引用'
              : '当前关键要素会影响关联 shot',
          );
        }
      }
    }

    const uniqueImpacts = uniqueTargets(impactedObjects);
    const impactLevel = assessImpactLevel(
      objectType,
      changeType,
      uniqueImpacts,
      warnings,
      lockedRelated,
    );
    const requiresUserConfirmation = impactLevel !== 'low' || lockedRelated;
    const analysis: ImpactAnalysisResult = {
      impactLevel,
      affectedObjects: uniqueImpacts,
      requiresUserConfirmation,
      warnings,
    };

    let conflictId: string | null = null;

    if (requiresUserConfirmation) {
      const analysisAt = timestamp();
      const conflictRecord = await mutateDb((nextDb) => {
        const currentProject = nextDb.projects.find(
          (item) => item.id === projectId && !item.deletedAt,
        );
        if (!currentProject) {
          return null;
        }
        const existingConflict = nextDb.userAnnotations.find((annotation) => {
          if (
            annotation.projectId !== projectId ||
            annotation.noteType !== 'conflict_resolution' ||
            annotation.objectType !== objectType ||
            annotation.objectId !== input.objectId ||
            annotation.deletedAt
          ) {
            return false;
          }

          const parsed = parseConflictContent(annotation.content);
          return (
            parsed?.status === 'pending' && parsed.changeType === changeType
          );
        });

        if (existingConflict) {
          existingConflict.content = buildConflictContent(existingConflict.id, {
            objectType,
            objectId: input.objectId,
            changeType,
            impactLevel,
            affectedObjects: uniqueImpacts,
            requiresUserConfirmation,
            warnings,
            status: 'pending',
            analysisAt,
          });
          existingConflict.updatedAt = analysisAt;
          appendTaskEvent(nextDb, {
            projectId,
            runId: null,
            taskId: null,
            eventType: 'conflict_detected',
            eventLevel: 'warn',
            userVisible: true,
            summary: '变更影响已重新评估，仍需你决定如何处理冲突',
            eventPayload: {
              conflictId: existingConflict.id,
              objectType,
              objectId: input.objectId,
              changeType,
              impactLevel,
              affectedObjectCount: uniqueImpacts.length,
            },
          });
          appendTaskEvent(nextDb, {
            projectId,
            runId: null,
            taskId: null,
            eventType: 'control_plane_impact_analyzed',
            eventLevel: 'info',
            userVisible: false,
            summary: 'Pending impact conflict was refreshed atomically',
            eventPayload: {
              command: 'analyze_impact',
              conflictId: existingConflict.id,
              objectType,
              objectId: input.objectId,
              changeType,
              projectOwnershipValidated: true,
            },
          });
          return existingConflict;
        }

        const record = audited<UserAnnotationRecord>({
          id: id(),
          projectId,
          objectType,
          objectId: input.objectId,
          noteType: 'conflict_resolution',
          content: '',
          createdByUserId: null,
        });
        record.content = buildConflictContent(record.id, {
          objectType,
          objectId: input.objectId,
          changeType,
          impactLevel,
          affectedObjects: uniqueImpacts,
          requiresUserConfirmation,
          warnings,
          status: 'pending',
          analysisAt,
        });
        nextDb.userAnnotations.unshift(record);
        appendTaskEvent(nextDb, {
          projectId,
          runId: null,
          taskId: null,
          eventType: 'conflict_detected',
          eventLevel: 'warn',
          userVisible: true,
          summary: '这项变更会影响关联内容，已暂停自动写回并等待你的决定',
          eventPayload: {
            conflictId: record.id,
            objectType,
            objectId: input.objectId,
            changeType,
            impactLevel,
            affectedObjectCount: uniqueImpacts.length,
          },
        });
        appendTaskEvent(nextDb, {
          projectId,
          runId: null,
          taskId: null,
          eventType: 'control_plane_impact_analyzed',
          eventLevel: 'info',
          userVisible: false,
          summary: 'Impact analysis and pending conflict committed atomically',
          eventPayload: {
            command: 'analyze_impact',
            conflictId: record.id,
            objectType,
            objectId: input.objectId,
            changeType,
            projectOwnershipValidated: true,
          },
        });
        return record;
      });
      conflictId = conflictRecord?.id ?? null;
    }

    return {
      analysis,
      conflictId,
    };
  },

  async resolveConflictForProject(
    projectId: string,
    conflictId: string,
    resolution: string,
  ) {
    return mutateDb((db) => {
      const annotation = db.userAnnotations.find(
        (item) =>
          item.id === conflictId &&
          item.projectId === projectId &&
          item.noteType === 'conflict_resolution' &&
          !item.deletedAt,
      );
      if (!annotation) {
        return null;
      }

      const parsed = parseConflictContent(annotation.content) ?? {
        conflictId,
        status: 'pending' as const,
        objectType: 'shot' as CanonicalControlPlaneObjectType,
        objectId: annotation.objectId,
        changeType: 'update',
        impactLevel: 'low' as const,
        affectedObjects: [],
        requiresUserConfirmation: true,
        warnings: [],
        analysisAt: annotation.createdAt,
      };

      const now = timestamp();
      annotation.content = buildConflictContent(conflictId, {
        objectType: parsed.objectType,
        objectId: parsed.objectId,
        changeType: parsed.changeType,
        impactLevel: parsed.impactLevel,
        affectedObjects: parsed.affectedObjects,
        requiresUserConfirmation: parsed.requiresUserConfirmation,
        warnings: parsed.warnings,
        status: 'resolved',
        resolution,
        analysisAt: parsed.analysisAt,
        resolvedAt: now,
      });
      annotation.updatedAt = now;
      appendTaskEvent(db, {
        projectId,
        runId: null,
        taskId: null,
        eventType: 'conflict_resolved',
        eventLevel: 'info',
        userVisible: true,
        summary: '冲突处理决定已保存，后续执行将遵循该决定',
        eventPayload: {
          conflictId,
          objectType: parsed.objectType,
          objectId: parsed.objectId,
          resolution,
        },
      });
      appendTaskEvent(db, {
        projectId,
        runId: null,
        taskId: null,
        eventType: 'control_plane_command_recorded',
        eventLevel: 'info',
        userVisible: false,
        summary: 'Conflict resolution committed inside the project boundary',
        eventPayload: {
          command: 'resolve_conflict',
          conflictId,
          objectType: parsed.objectType,
          objectId: parsed.objectId,
          projectOwnershipValidated: true,
        },
      });
      return annotation;
    });
  },
};
