import type { UserAnnotationRecord } from '@video-agent-studio/shared';
import type { DatabaseState } from '../types';
import { audited, id, mutateDb, readDb } from '../dev-file-db';
import { appendTaskEvent } from './event.repository';

type AnnotationObjectType = UserAnnotationRecord['objectType'];

function artifactObjectProjectId(
  db: DatabaseState,
  objectType: Extract<
    AnnotationObjectType,
    'artifact_version' | 'storyboard' | 'video' | 'key_element'
  >,
  objectId: string,
) {
  const version = db.artifactVersions.find(
    (candidate) => candidate.id === objectId && !candidate.deletedAt,
  );
  const group = version
    ? db.artifactGroups.find(
        (candidate) => candidate.id === version.groupId && !candidate.deletedAt,
      )
    : db.artifactGroups.find(
        (candidate) => candidate.id === objectId && !candidate.deletedAt,
      );
  if (!group) return null;
  if (objectType === 'storyboard' && group.role !== 'storyboard_image') {
    return null;
  }
  if (objectType === 'video' && group.role !== 'video_clip') {
    return null;
  }
  if (objectType === 'key_element' && !group.role.endsWith('_ref')) {
    return null;
  }
  return group.projectId;
}

function objectProjectId(
  db: DatabaseState,
  objectType: AnnotationObjectType,
  objectId: string,
) {
  switch (objectType) {
    case 'task':
      return (
        db.agentTasks.find(
          (candidate) => candidate.id === objectId && !candidate.deletedAt,
        )?.projectId ?? null
      );
    case 'scene':
      return (
        db.scenes.find(
          (candidate) => candidate.id === objectId && !candidate.deletedAt,
        )?.projectId ?? null
      );
    case 'shot':
      return (
        db.shots.find(
          (candidate) => candidate.id === objectId && !candidate.deletedAt,
        )?.projectId ?? null
      );
    case 'config':
      return (
        db.projectConfigVersions.find(
          (candidate) => candidate.id === objectId && !candidate.deletedAt,
        )?.projectId ?? null
      );
    case 'conflict':
      return (
        db.userAnnotations.find(
          (candidate) => candidate.id === objectId && !candidate.deletedAt,
        )?.projectId ?? null
      );
    case 'artifact_version':
    case 'storyboard':
    case 'video':
    case 'key_element':
      return artifactObjectProjectId(db, objectType, objectId);
  }
}

export const annotationRepository = {
  async list(
    projectId: string,
    objectType?: UserAnnotationRecord['objectType'],
    objectId?: string,
  ) {
    const db = await readDb();
    return db.userAnnotations
      .filter((item) => item.projectId === projectId && !item.deletedAt)
      .filter((item) => (objectType ? item.objectType === objectType : true))
      .filter((item) => (objectId ? item.objectId === objectId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createForProject(
    input: Omit<
      UserAnnotationRecord,
      'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
    >,
  ) {
    return mutateDb((db) => {
      const projectExists = db.projects.some(
        (project) => project.id === input.projectId && !project.deletedAt,
      );
      if (!projectExists) {
        return { ok: false as const, reason: 'project_not_found' as const };
      }
      const ownerProjectId = objectProjectId(
        db,
        input.objectType,
        input.objectId,
      );
      if (!ownerProjectId) {
        return { ok: false as const, reason: 'object_not_found' as const };
      }
      if (ownerProjectId !== input.projectId) {
        return {
          ok: false as const,
          reason: 'object_project_mismatch' as const,
        };
      }

      const annotation = audited<UserAnnotationRecord>({
        ...input,
        id: id(),
      });
      db.userAnnotations.unshift(annotation);
      const task =
        input.objectType === 'task'
          ? db.agentTasks.find((candidate) => candidate.id === input.objectId)
          : null;
      appendTaskEvent(db, {
        projectId: input.projectId,
        runId: task?.runId ?? null,
        taskId: task?.id ?? null,
        eventType: 'annotation_created',
        eventLevel: 'info',
        userVisible: true,
        summary: '已保存反馈，不会直接覆盖已批准内容',
        eventPayload: {
          annotationId: annotation.id,
          objectType: input.objectType,
          objectId: input.objectId,
          noteType: input.noteType,
        },
      });
      appendTaskEvent(db, {
        projectId: input.projectId,
        runId: task?.runId ?? null,
        taskId: task?.id ?? null,
        eventType: 'control_plane_command_recorded',
        eventLevel: 'info',
        userVisible: false,
        summary:
          'Annotation command committed after project ownership validation',
        eventPayload: {
          command: 'create_annotation',
          annotationId: annotation.id,
          objectType: input.objectType,
          objectId: input.objectId,
          projectOwnershipValidated: true,
        },
      });
      return { ok: true as const, annotation };
    });
  },
};
