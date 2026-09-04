import { ensureDb, runRepository, taskRepository } from '@video-agent-studio/db';
import { jsonOk } from '../../../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const run = await runRepository.getLatestByProject(projectId, 'storyboard');
  const tasks = run ? await taskRepository.listByRun(run.id) : [];
  return jsonOk({
    run,
    tasks: tasks.map((task) => ({
      taskId: task.id,
      agentName: task.agentName,
      status: task.status,
    })),
  });
}

