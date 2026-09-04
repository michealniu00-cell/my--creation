import {
  configRepository,
  ensureDb,
  manualGateRepository,
  runRepository,
  taskRepository,
} from '@video-agent-studio/db';
import { jsonOk } from '../../../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const [run, config, scriptGate] = await Promise.all([
    runRepository.getLatestByProject(projectId, 'script'),
    configRepository.getActive(projectId),
    manualGateRepository.getScriptGateState(projectId),
  ]);
  const tasks = run ? await taskRepository.listByRun(run.id) : [];
  return jsonOk({
    run,
    checkpoints: {
      agent1Confirmed: Boolean(config?.confirmedByUser),
      scriptConfirmedByUser: scriptGate.confirmed,
    },
    tasks: tasks.map((task) => ({
      taskId: task.id,
      agentName: task.agentName,
      status: task.status,
      roundNo: task.roundNo,
      outputSummary: task.outputSummary,
    })),
  });
}
