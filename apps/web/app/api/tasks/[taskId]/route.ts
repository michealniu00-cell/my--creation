import { ensureDb, taskRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  await ensureDb();
  const { taskId } = await params;
  const task = await taskRepository.get(taskId);
  if (!task) {
    return jsonFail('NOT_FOUND', 'Task not found', 404);
  }
  return jsonOk({
    taskId: task.id,
    agentName: task.agentName,
    status: task.status,
    inputPayload: task.inputPayload,
    outputJson: task.outputJson,
    outputMarkdown: task.outputMarkdown,
    outputSummary: task.outputSummary,
    promptVersion: task.promptVersion,
    providerName: task.providerName ?? null,
    modelName: task.modelName ?? null,
    credentialSource: task.credentialSource ?? null,
    latencyMs: task.latencyMs,
    usage: {
      promptTokens: task.promptTokens,
      completionTokens: task.completionTokens,
      totalTokens: task.totalTokens,
    },
  });
}
