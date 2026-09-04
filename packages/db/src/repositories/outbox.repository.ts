import { mutateDb, readDb, timestamp } from '../dev-file-db';

export const outboxRepository = {
  async listPending(limit = 100) {
    const db = await readDb();
    return db.outboxEvents
      .filter((event) => !event.deletedAt && !event.publishedAt)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, Math.max(1, Math.trunc(limit)));
  },

  async markPublished(eventId: string, now = timestamp()) {
    return mutateDb((db) => {
      const event = db.outboxEvents.find(
        (candidate) => candidate.id === eventId && !candidate.deletedAt,
      );
      if (!event) {
        return null;
      }
      event.publishedAt = event.publishedAt ?? now;
      event.updatedAt = now;
      return event;
    });
  },

  async markFailed(eventId: string, message: string, now = timestamp()) {
    return mutateDb((db) => {
      const event = db.outboxEvents.find(
        (candidate) => candidate.id === eventId && !candidate.deletedAt,
      );
      if (!event || event.publishedAt) {
        return null;
      }
      event.publishAttempts += 1;
      event.lastError = message;
      event.updatedAt = now;
      return event;
    });
  },
};
