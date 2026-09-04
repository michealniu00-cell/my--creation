import type { ProjectOverviewStats, ProjectRecord } from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';

export const projectRepository = {
  async list(status?: ProjectRecord['status']) {
    const db = await readDb();
    return db.projects
      .filter((project) => !project.deletedAt)
      .filter((project) => (status ? project.status === status : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async create(input: Pick<ProjectRecord, 'title' | 'sourceIdea' | 'targetPlatform' | 'language'>) {
    return mutateDb((db) => {
      const project = audited<ProjectRecord>({
        id: id(),
        title: input.title,
        userId: null,
        sourceIdea: input.sourceIdea,
        targetPlatform: input.targetPlatform ?? null,
        language: input.language,
        status: 'draft',
        currentStage: 'script',
        currentConfigVersionId: null,
        latestRunId: null,
        currentFailureSummaryId: null,
        remark: null,
      });
      db.projects.unshift(project);
      return project;
    });
  },

  async get(projectId: string) {
    const db = await readDb();
    return db.projects.find((project) => project.id === projectId && !project.deletedAt) ?? null;
  },

  async update(projectId: string, patch: Partial<ProjectRecord>) {
    return mutateDb((db) => {
      const project = db.projects.find((item) => item.id === projectId && !item.deletedAt);
      if (!project) {
        return null;
      }
      Object.assign(project, patch, { updatedAt: timestamp() });
      return project;
    });
  },

  async getOverview(projectId: string) {
    const db = await readDb();
    const project = db.projects.find((item) => item.id === projectId && !item.deletedAt);
    if (!project) {
      return null;
    }

    const stats: ProjectOverviewStats = {
      sceneCount: db.scenes.filter((scene) => scene.projectId === projectId && !scene.deletedAt).length,
      shotCount: db.shots.filter((shot) => shot.projectId === projectId && !shot.deletedAt).length,
      keyElementImageCount: db.artifactGroups.filter(
        (group) => group.projectId === projectId && group.role.endsWith('_ref') && !group.deletedAt,
      ).length,
      storyboardImageCount: db.artifactGroups.filter(
        (group) => group.projectId === projectId && group.role === 'storyboard_image' && !group.deletedAt,
      ).length,
      videoClipCount: db.artifactGroups.filter(
        (group) => group.projectId === projectId && group.role === 'video_clip' && !group.deletedAt,
      ).length,
    };

    const activeSnapshots = Object.fromEntries(
      db.projectStageSnapshots
        .filter((snapshot) => snapshot.projectId === projectId && snapshot.isActive && !snapshot.deletedAt)
        .map((snapshot) => [snapshot.stageName, snapshot]),
    );

    return {
      project,
      activeSnapshots,
      stats,
    };
  },

  async softDelete(projectId: string) {
    return mutateDb((db) => {
      const project = db.projects.find((item) => item.id === projectId && !item.deletedAt);
      if (!project) {
        return false;
      }
      const deletedAt = timestamp();
      project.deletedAt = deletedAt;
      project.updatedAt = deletedAt;
      project.status = 'archived';
      return true;
    });
  },
};

