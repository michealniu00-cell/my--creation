import type {
  AgentName,
  ProjectStageSnapshotRecord,
} from '@video-agent-studio/shared';
import {
  assertAgentOutputWriteAllowed,
  type AgentOutputReference,
  type TextArtifactRole,
} from '@video-agent-studio/workflow-engine';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';

const snapshotDefinitionByAgent: Partial<
  Record<AgentName, { stageName: string; role: TextArtifactRole }>
> = {
  agent1: { stageName: 'agent1_output', role: 'agent1_brief' },
  agent2: { stageName: 'research', role: 'research_report' },
  agent3: { stageName: 'storyline', role: 'storyline' },
  agent4: { stageName: 'script', role: 'script' },
  agent6: { stageName: 'shots', role: 'shot_structure' },
  agent7: { stageName: 'storyboard_spec', role: 'shot_enhancement' },
};

function readAgent6Source(
  task: { projectId: string; inputPayload: Record<string, unknown> },
  tasks: Array<{
    id: string;
    projectId: string;
    agentName: AgentName;
    deletedAt?: string | null;
  }>,
): AgentOutputReference | null {
  const basedOnTaskId = task.inputPayload.basedOnTaskId;
  if (typeof basedOnTaskId !== 'string' || basedOnTaskId.trim().length === 0) {
    return null;
  }

  const sourceTask = tasks.find(
    (candidate) =>
      candidate.id === basedOnTaskId &&
      candidate.projectId === task.projectId &&
      candidate.agentName === 'agent6' &&
      !candidate.deletedAt,
  );
  return sourceTask
    ? { ownerAgent: sourceTask.agentName, outputId: sourceTask.id }
    : null;
}

export const snapshotRepository = {
  async createFromAgentTask(actorAgent: AgentName, taskId: string) {
    return mutateDb((db) => {
      const task = db.agentTasks.find(
        (item) => item.id === taskId && !item.deletedAt,
      );
      if (!task) {
        throw new Error(`Snapshot source task ${taskId} does not exist.`);
      }

      const definition = snapshotDefinitionByAgent[task.agentName];
      const source =
        task.agentName === 'agent7'
          ? readAgent6Source(task, db.agentTasks)
          : null;

      assertAgentOutputWriteAllowed({
        actorAgent,
        operation: 'append_version',
        target: {
          kind: 'text_artifact',
          ownerAgent: task.agentName,
          // Agent5/8/9 are rejected before role ownership is evaluated. This
          // fallback keeps the runtime denial inside the central policy.
          role: definition?.role ?? 'shot_structure',
          source,
        },
      });

      if (!definition) {
        throw new Error(`${task.agentName} has no text snapshot channel.`);
      }

      const now = timestamp();
      const existing = db.projectStageSnapshots.find(
        (snapshot) =>
          snapshot.projectId === task.projectId &&
          snapshot.stageName === definition.stageName &&
          snapshot.sourceTaskId === task.id &&
          !snapshot.deletedAt,
      );
      for (const snapshot of db.projectStageSnapshots) {
        if (
          snapshot.projectId === task.projectId &&
          snapshot.stageName === definition.stageName &&
          snapshot.isActive &&
          !snapshot.deletedAt
        ) {
          snapshot.isActive = false;
          snapshot.updatedAt = now;
        }
      }

      if (existing) {
        existing.isActive = true;
        existing.updatedAt = now;
        return existing;
      }

      const snapshot = audited<ProjectStageSnapshotRecord>({
        id: id(),
        projectId: task.projectId,
        stageName: definition.stageName,
        sourceTaskId: task.id,
        sourceArtifactVersionId: null,
        snapshotJson: task.outputJson,
        snapshotMarkdown: task.outputMarkdown,
        isActive: true,
      });
      db.projectStageSnapshots.push(snapshot);
      return snapshot;
    });
  },

  async listByProjectAndStage(projectId: string, stageName: string) {
    const db = await readDb();
    return db.projectStageSnapshots
      .filter(
        (snapshot) =>
          snapshot.projectId === projectId &&
          snapshot.stageName === stageName &&
          !snapshot.deletedAt,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
