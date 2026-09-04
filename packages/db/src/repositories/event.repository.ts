import type { TaskEventRecord } from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb } from '../dev-file-db';
import type { DatabaseState } from '../types';

type TaskEventCreateInput = Omit<
  TaskEventRecord,
  'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
>;

/** Append the audit record and its delivery intent inside an existing mutation. */
export function appendTaskEvent(
  db: DatabaseState,
  input: TaskEventCreateInput,
) {
  const event = audited<TaskEventRecord>({
    ...input,
    id: id(),
  });
  db.taskEvents.unshift(event);
  db.outboxEvents.push(
    audited({
      id: id(),
      aggregateType: 'task_event' as const,
      aggregateId: event.id,
      eventType: event.eventType,
      eventPayload: {
        sourceEventId: event.id,
        projectId: event.projectId,
        runId: event.runId ?? null,
        taskId: event.taskId ?? null,
        jobId: event.jobId ?? null,
        userVisible: event.userVisible,
        eventLevel: event.eventLevel,
        ...event.eventPayload,
      },
      publishedAt: null,
      publishAttempts: 0,
      lastError: null,
    }),
  );
  return event;
}

export const eventRepository = {
  async create(input: TaskEventCreateInput) {
    return mutateDb((db) => appendTaskEvent(db, input));
  },

  async list(projectId: string, userVisible?: boolean) {
    const db = await readDb();
    return db.taskEvents
      .filter(
        (item) =>
          item.projectId === projectId &&
          !item.deletedAt &&
          (typeof userVisible === 'boolean'
            ? item.userVisible === userVisible
            : true),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
