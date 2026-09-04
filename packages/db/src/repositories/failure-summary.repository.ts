import { readDb } from '../dev-file-db';

export const failureSummaryRepository = {
  async getActive(projectId: string) {
    const db = await readDb();
    return (
      db.failureSummaryDocs
        .filter((item) => item.projectId === projectId && item.isActive && !item.deletedAt)
        .sort((a, b) => b.versionNo - a.versionNo)[0] ?? null
    );
  },

  async list(projectId: string) {
    const db = await readDb();
    return db.failureSummaryDocs
      .filter((item) => item.projectId === projectId && !item.deletedAt)
      .sort((a, b) => b.versionNo - a.versionNo);
  },
};

