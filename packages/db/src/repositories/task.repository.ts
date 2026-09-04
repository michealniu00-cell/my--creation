import type { AgentName, AgentTaskRecord } from '@video-agent-studio/shared';
import { assertAgentOutputWriteAllowed } from '@video-agent-studio/workflow-engine';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';
import type { DatabaseState } from '../types';

type AgentTaskCreateInput = Omit<
  AgentTaskRecord,
  'createdAt' | 'updatedAt' | 'deletedAt' | 'id'
>;

export type AgentTaskExecutionStatePatch = Partial<
  Pick<
    AgentTaskRecord,
    | 'status'
    | 'errorType'
    | 'errorMessage'
    | 'latencyMs'
    | 'promptTokens'
    | 'completionTokens'
    | 'totalTokens'
    | 'startedAt'
    | 'finishedAt'
  >
>;

const executionStateFields = new Set<keyof AgentTaskExecutionStatePatch>([
  'status',
  'errorType',
  'errorMessage',
  'latencyMs',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'startedAt',
  'finishedAt',
]);

function createAgentOutputRecord(
  db: DatabaseState,
  actorAgent: AgentName,
  input: AgentTaskCreateInput,
) {
  const basedOnTaskId = input.inputPayload.basedOnTaskId;
  const sourceTask =
    typeof basedOnTaskId === 'string'
      ? db.agentTasks.find(
          (candidate) =>
            candidate.id === basedOnTaskId &&
            candidate.projectId === input.projectId &&
            candidate.agentName === 'agent6' &&
            !candidate.deletedAt,
        )
      : null;

  assertAgentOutputWriteAllowed({
    actorAgent,
    operation: 'create',
    target: {
      kind: 'task_output',
      ownerAgent: input.agentName,
      source: sourceTask
        ? { ownerAgent: sourceTask.agentName, outputId: sourceTask.id }
        : null,
    },
  });

  const task = audited<AgentTaskRecord>({
    ...input,
    executionKey: input.executionKey ?? null,
    id: id(),
  });
  db.agentTasks.unshift(task);
  return task;
}

export const taskRepository = {
  async createAgentOutput(actorAgent: AgentName, input: AgentTaskCreateInput) {
    return mutateDb((db) => createAgentOutputRecord(db, actorAgent, input));
  },

  async createAgentOutputOnce(
    actorAgent: AgentName,
    executionKey: string,
    input: Omit<AgentTaskCreateInput, 'executionKey'>,
  ) {
    const normalizedKey = executionKey.trim();
    if (!normalizedKey || normalizedKey.length > 500) {
      throw new Error('executionKey must contain between 1 and 500 characters');
    }

    return mutateDb((db) => {
      const existing = db.agentTasks.find(
        (task) =>
          task.runId === input.runId &&
          task.executionKey === normalizedKey &&
          !task.deletedAt,
      );
      if (existing) {
        if (
          existing.projectId !== input.projectId ||
          existing.agentName !== input.agentName ||
          existing.stageName !== input.stageName ||
          existing.roundNo !== input.roundNo
        ) {
          throw new Error(
            'Agent task execution key is already bound to incompatible lineage',
          );
        }
        return { task: existing, created: false as const };
      }

      return {
        task: createAgentOutputRecord(db, actorAgent, {
          ...input,
          executionKey: normalizedKey,
        }),
        created: true as const,
      };
    });
  },

  async updateExecutionState(
    taskId: string,
    patch: AgentTaskExecutionStatePatch,
  ) {
    const unsupportedFields = Object.keys(patch).filter(
      (field) =>
        !executionStateFields.has(field as keyof AgentTaskExecutionStatePatch),
    );
    if (unsupportedFields.length > 0) {
      throw new Error(
        `Task output is immutable; unsupported execution-state fields: ${unsupportedFields.join(', ')}`,
      );
    }

    return mutateDb((db) => {
      const task = db.agentTasks.find(
        (item) => item.id === taskId && !item.deletedAt,
      );
      if (!task) {
        return null;
      }
      Object.assign(task, patch, { updatedAt: timestamp() });
      return task;
    });
  },

  async get(taskId: string) {
    const db = await readDb();
    return (
      db.agentTasks.find((item) => item.id === taskId && !item.deletedAt) ??
      null
    );
  },

  async getByExecutionKey(runId: string, executionKey: string) {
    const db = await readDb();
    return (
      db.agentTasks.find(
        (task) =>
          task.runId === runId &&
          task.executionKey === executionKey &&
          !task.deletedAt,
      ) ?? null
    );
  },

  async listByRun(runId: string) {
    const db = await readDb();
    return db.agentTasks
      .filter((item) => item.runId === runId && !item.deletedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async listByProjectAndStage(
    projectId: string,
    stageName: AgentTaskRecord['stageName'],
  ) {
    const db = await readDb();
    return db.agentTasks
      .filter(
        (item) =>
          item.projectId === projectId &&
          item.stageName === stageName &&
          !item.deletedAt,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async listByProjectAndAgent(
    projectId: string,
    agentName: AgentTaskRecord['agentName'],
  ) {
    const db = await readDb();
    return db.agentTasks
      .filter(
        (item) =>
          item.projectId === projectId &&
          item.agentName === agentName &&
          !item.deletedAt,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
