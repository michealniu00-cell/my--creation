import { ensureDb, taskRepository } from '@video-agent-studio/db';
import { jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  await ensureDb();
  const { runId } = await params;
  const items = await taskRepository.listByRun(runId);
  return jsonOk({
    items: items.map((task) => ({
      taskId: task.id,
      agentName: task.agentName,
      status: task.status,
    })),
  });
}

