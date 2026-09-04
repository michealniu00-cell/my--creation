import type { AgentName, ReviewRecord } from '@video-agent-studio/shared';
import { assertAgentOutputWriteAllowed } from '@video-agent-studio/workflow-engine';
import { audited, id, mutateDb, readDb } from '../dev-file-db';

export const reviewRepository = {
  async createAgentFeedback(
    actorAgent: AgentName,
    input: Omit<ReviewRecord, 'createdAt' | 'updatedAt' | 'deletedAt' | 'id'>,
  ) {
    return mutateDb((db) => {
      const sourceTask = db.agentTasks.find(
        (task) => task.id === input.sourceTaskId && !task.deletedAt,
      );
      if (!sourceTask) {
        throw new Error(
          `Review source task ${input.sourceTaskId} does not exist.`,
        );
      }
      if (
        sourceTask.projectId !== input.projectId ||
        sourceTask.runId !== input.runId
      ) {
        throw new Error(
          'Review project/run lineage does not match its persisted source task.',
        );
      }
      if (input.reviewerType !== 'agent' || input.reviewerName !== actorAgent) {
        throw new Error(
          'Agent review identity must match the authenticated actor.',
        );
      }

      assertAgentOutputWriteAllowed({
        actorAgent,
        operation: 'create',
        target: {
          kind: 'review_feedback',
          ownerAgent: actorAgent,
          subjectAgent: sourceTask.agentName,
        },
      });

      const existing = db.reviewRecords.find(
        (review) =>
          review.sourceTaskId === input.sourceTaskId &&
          review.reviewRound === input.reviewRound &&
          review.reviewerType === 'agent' &&
          review.reviewerName === actorAgent &&
          !review.deletedAt,
      );
      if (existing) {
        return existing;
      }

      const review = audited<ReviewRecord>({
        ...input,
        id: id(),
      });
      db.reviewRecords.unshift(review);
      return review;
    });
  },

  async listByTask(taskId: string) {
    const db = await readDb();
    return db.reviewRecords
      .filter((item) => item.sourceTaskId === taskId && !item.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
