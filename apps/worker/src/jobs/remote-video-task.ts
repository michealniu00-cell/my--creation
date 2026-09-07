import type { RemoteVideoTaskControl } from '@video-agent-studio/providers';
import type { DurableJobContext } from './job-runner';

type RemoteTask = {
  id: string;
  status: 'submitted' | 'failed';
  updatedAt: string;
};
type CheckpointContext = Pick<
  DurableJobContext,
  'checkpoint' | 'saveCheckpoint' | 'throwIfAborted'
>;

function histories(context: CheckpointContext): Record<string, RemoteTask[]> {
  const value = context.checkpoint.remoteVideoTasks;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, RemoteTask[]>)
    : {};
}

/** One checkpoint namespace per shot/request fingerprint. No credentials are persisted. */
export function remoteVideoTaskControl(
  context: CheckpointContext,
  scope: string,
): RemoteVideoTaskControl {
  const history = histories(context)[scope] ?? [];
  const latest = history.at(-1);
  async function persist(id: string, status: RemoteTask['status']) {
    context.throwIfAborted();
    const current = histories(context);
    const previous = current[scope] ?? [];
    const record: RemoteTask = {
      id,
      status,
      updatedAt: new Date().toISOString(),
    };
    const next =
      previous.at(-1)?.id === id
        ? [...previous.slice(0, -1), record]
        : [...previous, record];
    await context.saveCheckpoint({
      ...context.checkpoint,
      remoteVideoTasks: { ...current, [scope]: next },
    });
  }
  return {
    resumeRemoteTaskId: latest?.status === 'submitted' ? latest.id : undefined,
    onRemoteTaskSubmitted: (id) => persist(id, 'submitted'),
    onRemoteTaskFailed: (id) => persist(id, 'failed'),
  };
}
