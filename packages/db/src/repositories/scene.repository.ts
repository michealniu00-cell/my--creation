import type { SceneRecord } from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb } from '../dev-file-db';

export const sceneRepository = {
  async list(projectId: string) {
    const db = await readDb();
    return db.scenes
      .filter((item) => item.projectId === projectId && item.status !== 'deleted' && !item.deletedAt)
      .sort((a, b) => a.sceneIndex - b.sceneIndex);
  },

  async replaceForProject(projectId: string, scenes: Array<Omit<SceneRecord, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>) {
    return mutateDb((db) => {
      db.scenes = db.scenes.filter((scene) => scene.projectId !== projectId);
      const nextScenes = scenes.map((scene) =>
        audited<SceneRecord>({
          ...scene,
          id: id(),
        }),
      );
      db.scenes.push(...nextScenes);
      return nextScenes;
    });
  },
};

