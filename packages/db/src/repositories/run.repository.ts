import type { WorkflowRunRecord } from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';
import type { DatabaseState } from '../types';

type WorkflowRunCreateInput = Pick<
  WorkflowRunRecord,
  | 'workflowType'
  | 'triggerMode'
  | 'startFromNode'
  | 'endAtNode'
  | 'currentNode'
  | 'runReason'
> & { originJobId?: string | null };

function createRun(
  db: DatabaseState,
  projectId: string,
  input: WorkflowRunCreateInput,
) {
  const run = audited<WorkflowRunRecord>({
    id: id(),
    projectId,
    originJobId: input.originJobId ?? null,
    workflowType: input.workflowType,
    triggerMode: input.triggerMode,
    startFromNode: input.startFromNode ?? null,
    endAtNode: input.endAtNode ?? null,
    currentNode: input.currentNode ?? null,
    status: 'running',
    runReason: input.runReason ?? null,
    retryCount: 0,
    requiresManualReview: false,
    errorType: null,
    errorMessage: null,
    startedAt: timestamp(),
    finishedAt: null,
  });

  db.workflowRuns.unshift(run);
  const project = db.projects.find(
    (item) => item.id === projectId && !item.deletedAt,
  );
  if (project) {
    project.latestRunId = run.id;
    project.status = 'running';
    project.updatedAt = timestamp();
  }
  return run;
}

export const runRepository = {
  async create(projectId: string, input: WorkflowRunCreateInput) {
    return mutateDb((db) => createRun(db, projectId, input));
  },

  async createOnceForJob(
    projectId: string,
    originJobId: string,
    input: Omit<WorkflowRunCreateInput, 'originJobId'>,
  ) {
    const normalizedJobId = originJobId.trim();
    if (!normalizedJobId) {
      throw new Error('originJobId is required');
    }
    return mutateDb((db) => {
      const job = db.workflowJobs.find(
        (candidate) =>
          candidate.id === normalizedJobId && !candidate.deletedAt,
      );
      if (!job || job.projectId !== projectId) {
        throw new Error('Origin workflow job was not found for this project');
      }
      if (job.jobType !== input.workflowType) {
        throw new Error(
          `Origin job type ${job.jobType} cannot create a ${input.workflowType} run`,
        );
      }

      const existing = db.workflowRuns.find(
        (candidate) =>
          candidate.originJobId === normalizedJobId && !candidate.deletedAt,
      );
      if (existing) {
        if (
          existing.projectId !== projectId ||
          existing.workflowType !== input.workflowType
        ) {
          throw new Error('Origin workflow job is already bound to another run');
        }
        return { run: existing, created: false as const };
      }

      return {
        run: createRun(db, projectId, {
          ...input,
          originJobId: normalizedJobId,
        }),
        created: true as const,
      };
    });
  },

  async update(runId: string, patch: Partial<WorkflowRunRecord>) {
    return mutateDb((db) => {
      const run = db.workflowRuns.find((item) => item.id === runId && !item.deletedAt);
      if (!run) {
        return null;
      }
      Object.assign(run, patch, { updatedAt: timestamp() });
      return run;
    });
  },

  async get(runId: string) {
    const db = await readDb();
    return db.workflowRuns.find((item) => item.id === runId && !item.deletedAt) ?? null;
  },

  async getByOriginJobId(originJobId: string) {
    const db = await readDb();
    return (
      db.workflowRuns.find(
        (item) => item.originJobId === originJobId && !item.deletedAt,
      ) ?? null
    );
  },

  async getLatestByProject(projectId: string, workflowType?: WorkflowRunRecord['workflowType']) {
    const db = await readDb();
    return (
      db.workflowRuns
        .filter(
          (item) =>
            item.projectId === projectId &&
            !item.deletedAt &&
            (workflowType ? item.workflowType === workflowType : true),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  },
};
