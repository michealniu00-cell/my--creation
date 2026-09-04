import type { ProjectConfigVersionRecord } from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';

export const configRepository = {
  async getActive(projectId: string) {
    const db = await readDb();
    return (
      db.projectConfigVersions.find(
        (item) => item.projectId === projectId && item.isActive && !item.deletedAt,
      ) ?? null
    );
  },

  async list(projectId: string) {
    const db = await readDb();
    return db.projectConfigVersions
      .filter((item) => item.projectId === projectId && !item.deletedAt)
      .sort((a, b) => b.versionNo - a.versionNo);
  },

  async createDraft(
    projectId: string,
    patch: Partial<ProjectConfigVersionRecord>,
    sourceTaskId?: string,
  ) {
    return mutateDb((db) => {
      const currentVersions = db.projectConfigVersions
        .filter((item) => item.projectId === projectId && !item.deletedAt)
        .sort((a, b) => b.versionNo - a.versionNo);

      const draft = audited<ProjectConfigVersionRecord>({
        id: id(),
        projectId,
        versionNo: (currentVersions[0]?.versionNo ?? 0) + 1,
        confirmedByUser: false,
        sourceTaskId: sourceTaskId ?? null,
        scriptType: patch.scriptType ?? null,
        styleDefinition: patch.styleDefinition ?? null,
        researchFocus: patch.researchFocus ?? null,
        storylineStructure: patch.storylineStructure ?? null,
        scriptOrganization: patch.scriptOrganization ?? null,
        globalConstraints: patch.globalConstraints ?? {},
        configJson:
          patch.configJson ??
          {
            scriptType: patch.scriptType,
            styleDefinition: patch.styleDefinition,
            researchFocus: patch.researchFocus,
            storylineStructure: patch.storylineStructure,
            scriptOrganization: patch.scriptOrganization,
          },
        note: patch.note ?? null,
        isActive: false,
      });

      db.projectConfigVersions.unshift(draft);
      return draft;
    });
  },

  async confirm(projectId: string, configVersionId: string) {
    return mutateDb((db) => {
      const project = db.projects.find(
        (item) => item.id === projectId && !item.deletedAt,
      );
      const target = db.projectConfigVersions.find(
        (item) => item.id === configVersionId && item.projectId === projectId && !item.deletedAt,
      );
      if (!project || !target) {
        return null;
      }

      const alreadyConfirmed =
        target.isActive &&
        target.confirmedByUser &&
        project.currentConfigVersionId === target.id;
      if (alreadyConfirmed) {
        return target;
      }

      const confirmedAt = timestamp();

      db.projectConfigVersions
        .filter((item) => item.projectId === projectId && !item.deletedAt)
        .forEach((item) => {
          item.isActive = item.id === configVersionId;
          item.confirmedByUser = item.id === configVersionId ? true : item.confirmedByUser;
          item.updatedAt = confirmedAt;
        });

      project.currentConfigVersionId = configVersionId;
      project.updatedAt = confirmedAt;

      const userEventId = id();
      db.taskEvents.unshift({
        id: userEventId,
        projectId,
        runId: null,
        taskId: target.sourceTaskId ?? null,
        eventType: 'manual_gate_confirmed',
        eventLevel: 'info',
        userVisible: true,
        summary: `创作设定 v${target.versionNo} 已由用户确认`,
        eventPayload: {
          node: 'agent1_confirmed',
          configVersionId: target.id,
          versionNo: target.versionNo,
          confirmedAt,
        },
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
        deletedAt: null,
      });

      const developerEventId = id();
      db.taskEvents.unshift({
        id: developerEventId,
        projectId,
        runId: null,
        taskId: target.sourceTaskId ?? null,
        eventType: 'workflow_prerequisite_satisfied',
        eventLevel: 'info',
        userVisible: false,
        summary: 'Agent1 prerequisite gate committed atomically',
        eventPayload: {
          node: 'agent1_confirmed',
          configVersionId: target.id,
          confirmedAt,
        },
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
        deletedAt: null,
      });

      db.outboxEvents.push({
        id: id(),
        aggregateType: 'project_config',
        aggregateId: target.id,
        eventType: 'manual_gate_confirmed',
        eventPayload: {
          projectId,
          configVersionId: target.id,
          node: 'agent1_confirmed',
          confirmedAt,
          userEventId,
          developerEventId,
        },
        publishedAt: null,
        publishAttempts: 0,
        lastError: null,
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
        deletedAt: null,
      });

      return target;
    });
  },
};
