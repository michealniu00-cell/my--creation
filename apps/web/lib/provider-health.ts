import { ensureDb, settingsRepository, taskRepository } from '@video-agent-studio/db';
import { evaluateBindingHealth } from '@video-agent-studio/providers';
import type { ProviderHealthSummary } from '@video-agent-studio/shared';

export async function getProviderHealthSummary(projectId: string): Promise<ProviderHealthSummary> {
  await ensureDb();
  await settingsRepository.ensureDefaults(projectId);

  const bindings = await settingsRepository.listModelBindings(projectId);
  const resolvedBindings = await Promise.all(
    bindings.map((binding) => settingsRepository.getActiveModelBinding(projectId, binding.agentName)),
  );
  const tasksByAgent = await Promise.all(
    bindings.map((binding) => taskRepository.listByProjectAndAgent(projectId, binding.agentName)),
  );
  const checkedAt = new Date().toISOString();

  const items = bindings.map((binding, index) => {
    const base = evaluateBindingHealth(binding.agentName, resolvedBindings[index] ?? binding);
    const tasks = tasksByAgent[index] ?? [];
    const latestTask = tasks[0] ?? null;
    const latestErrorTask = tasks.find((task) => task.errorType === 'system' && task.errorMessage) ?? null;

    return {
      ...base,
      bindingId: binding.id,
      checkedAt,
      lastTaskId: latestTask?.id ?? null,
      lastRunId: latestTask?.runId ?? null,
      lastTaskStatus: latestTask?.status ?? null,
      lastExecutedAt: latestTask?.finishedAt ?? latestTask?.updatedAt ?? latestTask?.createdAt ?? null,
      lastErrorMessage: latestErrorTask?.errorMessage ?? null,
      lastErrorAt:
        latestErrorTask?.finishedAt ?? latestErrorTask?.updatedAt ?? latestErrorTask?.createdAt ?? null,
    };
  });

  return {
    checkedAt,
    total: items.length,
    readyCount: items.filter((item) => item.state === 'ready').length,
    mockCount: items.filter((item) => item.state === 'mock').length,
    warningCount: items.filter((item) => item.state === 'misconfigured' || item.state === 'unsupported').length,
    items,
  };
}
