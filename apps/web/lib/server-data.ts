import {
  artifactRepository,
  configRepository,
  ensureDb,
  eventRepository,
  failureSummaryRepository,
  jobRepository,
  manualGateRepository,
  projectRepository,
  reviewRepository,
  runRepository,
  sceneRepository,
  settingsRepository,
  shotRepository,
  taskRepository,
} from '@video-agent-studio/db';
import type { AgentName } from '@video-agent-studio/shared';
import { getProviderHealthSummary } from './provider-health';

const scriptAgentNames: AgentName[] = ['agent2', 'agent3', 'agent4'];

export async function getProjectListData() {
  await ensureDb();
  return projectRepository.list();
}

export async function getProjectContext(projectId: string) {
  await ensureDb();
  await settingsRepository.ensureDefaults(projectId);
  const project = await projectRepository.get(projectId);
  if (!project) {
    return null;
  }

  const [config, overview, scriptRun, storyboardRun, videoRun, scriptGate] =
    await Promise.all([
      configRepository.getActive(projectId),
      projectRepository.getOverview(projectId),
      runRepository.getLatestByProject(projectId, 'script'),
      runRepository.getLatestByProject(projectId, 'storyboard'),
      runRepository.getLatestByProject(projectId, 'video'),
      manualGateRepository.getScriptGateState(projectId),
    ]);
  const failureSummary = await failureSummaryRepository.getActive(projectId);

  return {
    project,
    config,
    overview,
    failureSummary,
    runs: {
      script: scriptRun,
      storyboard: storyboardRun,
      video: videoRun,
    },
    manualGates: {
      scriptConfirmed: scriptGate.confirmed,
      scriptEvidenceInconsistent: scriptGate.inconsistentCompletedRun,
    },
  };
}

export async function getScriptWorkflowPageData(projectId: string) {
  await ensureDb();
  await settingsRepository.ensureDefaults(projectId);
  const run = await runRepository.getLatestByProject(projectId, 'script');
  const [
    tasks,
    providerHealthSummary,
    latestTasksByAgent,
    bindingsByAgent,
    scriptGate,
    jobs,
  ] = await Promise.all([
    run ? taskRepository.listByRun(run.id) : Promise.resolve([]),
    getProviderHealthSummary(projectId),
    Promise.all(
      scriptAgentNames.map((agentName) =>
        taskRepository.listByProjectAndAgent(projectId, agentName),
      ),
    ),
    Promise.all(
      scriptAgentNames.map((agentName) =>
        settingsRepository.getActiveModelBinding(projectId, agentName),
      ),
    ),
    manualGateRepository.getScriptGateState(projectId),
    jobRepository.listByProject(projectId),
  ]);
  const reviews = await Promise.all(
    tasks.map((task) => reviewRepository.listByTask(task.id)),
  );
  const events = await eventRepository.list(projectId, true);
  const runtime = scriptAgentNames.map((agentName, index) => {
    const health =
      providerHealthSummary.items.find(
        (item) => item.agentName === agentName,
      ) ?? null;
    const latestTask = latestTasksByAgent[index]?.[0] ?? null;
    const binding = bindingsByAgent[index] ?? null;

    return {
      agentName,
      provider: binding?.provider ?? health?.provider ?? 'unconfigured',
      providerLabel: binding?.providerLabel ?? health?.providerLabel ?? null,
      modelName: binding?.modelName ?? health?.modelName ?? '',
      credentialSource:
        binding?.credentialSource ?? health?.authSource ?? 'none',
      baseUrl: binding?.baseUrl ?? health?.baseUrl ?? null,
      state: health?.state ?? 'misconfigured',
      canExecute: health?.state === 'ready',
      summary: health?.summary ?? '当前没有可用的 provider health 数据。',
      latestTaskId: latestTask?.id ?? null,
      latestTaskStatus: latestTask?.status ?? null,
      latestTaskAt:
        latestTask?.finishedAt ??
        latestTask?.updatedAt ??
        latestTask?.createdAt ??
        null,
      latestExecutedProvider: latestTask?.providerName ?? null,
      latestExecutedModel: latestTask?.modelName ?? null,
      promptTokens: latestTask?.promptTokens ?? 0,
      completionTokens: latestTask?.completionTokens ?? 0,
      totalTokens: latestTask?.totalTokens ?? 0,
      latencyMs: latestTask?.latencyMs ?? null,
      lastErrorMessage:
        health?.lastErrorMessage ?? latestTask?.errorMessage ?? null,
    };
  });

  const runDisabledReason =
    runtime.find((item) => item.state !== 'ready')?.summary ?? null;
  return {
    run,
    scriptGate,
    tasks,
    reviewMap: Object.fromEntries(
      tasks.map((task, index) => [task.id, reviews[index] ?? []]),
    ),
    events: events.slice(0, 20),
    runtime,
    canRunWorkflow: runtime.every((item) => item.state === 'ready'),
    runDisabledReason,
    workflowJob:
      jobs.find(
        (job) =>
          job.jobType === 'script' &&
          job.status !== 'succeeded' &&
          typeof job.payload.action !== 'string',
      ) ?? null,
  };
}

export async function getStoryboardPageData(projectId: string) {
  await ensureDb();
  const scenes = await sceneRepository.list(projectId);
  const shots = await shotRepository.list(projectId, true);
  return {
    scenes,
    shots,
  };
}

export async function getTimelinePageData(projectId: string) {
  await ensureDb();
  const [shots, keyElements, jobs] = await Promise.all([
    shotRepository.list(projectId, true),
    artifactRepository.listKeyElements(projectId),
    jobRepository.listByProject(projectId),
  ]);
  return {
    shots,
    keyElements,
    workflowJobs: (['storyboard', 'video'] as const)
      .map((jobType) =>
        jobs.find(
          (job) =>
            job.jobType === jobType &&
            job.status !== 'succeeded' &&
            typeof job.payload.action !== 'string',
        ),
      )
      .filter((job): job is NonNullable<typeof job> => Boolean(job)),
  };
}

export async function getLogsPageData(projectId: string) {
  await ensureDb();
  const [events, failureSummary] = await Promise.all([
    eventRepository.list(projectId),
    failureSummaryRepository.getActive(projectId),
  ]);
  const scriptRun = await runRepository.getLatestByProject(projectId, 'script');
  const storyboardRun = await runRepository.getLatestByProject(
    projectId,
    'storyboard',
  );
  const videoRun = await runRepository.getLatestByProject(projectId, 'video');
  const runs = [scriptRun, storyboardRun, videoRun]
    .filter((run): run is NonNullable<typeof run> => Boolean(run))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tasks = (
    await Promise.all(
      runs.map(async (run) => (run ? taskRepository.listByRun(run.id) : [])),
    )
  )
    .flat()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const reviews = await Promise.all(
    tasks.map((task) => reviewRepository.listByTask(task.id)),
  );
  return {
    events,
    tasks,
    runs,
    failureSummary,
    reviewMap: Object.fromEntries(
      tasks.map((task, index) => [task.id, reviews[index] ?? []]),
    ),
  };
}

export async function getSettingsPageData(projectId: string) {
  await ensureDb();
  await settingsRepository.ensureDefaults(projectId);
  const [profiles, bindings, snapshots] = await Promise.all([
    settingsRepository.listProfiles(projectId),
    settingsRepository.listModelBindings(projectId),
    settingsRepository.listSnapshots(projectId),
  ]);
  const providerHealth = await getProviderHealthSummary(projectId);

  return {
    profiles,
    bindings,
    snapshots,
    providerHealth,
  };
}
