import { ensureDb, settingsRepository } from '@video-agent-studio/db';
import { type AgentName, updateModelBindingSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../../../lib/http';

function getBindingGroupAgents(agentName: AgentName): AgentName[] {
  if (agentName === 'agent8') {
    return ['agent8'];
  }
  if (agentName === 'agent9') {
    return ['agent9'];
  }
  return ['agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent6', 'agent7'];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  await settingsRepository.ensureDefaults(projectId);
  const items = await settingsRepository.listModelBindings(projectId);
  return jsonOk({ items });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  await settingsRepository.ensureDefaults(projectId);
  const body = await readJsonWithSchema(request, updateModelBindingSchema, {
    message: 'Invalid model binding payload',
  });
  if (!body.success) {
    return body.response;
  }

  const { bindingId, providerLabel, ...patch } = body.data;
  const bindings = await settingsRepository.listModelBindings(projectId);
  const sourceBinding = bindings.find((item) => item.id === bindingId) ?? null;
  if (!sourceBinding) {
    return jsonFail('NOT_FOUND', 'Model binding not found', 404);
  }

  const targetAgents = getBindingGroupAgents(sourceBinding.agentName);
  const targetBindings = bindings.filter((item) => targetAgents.includes(item.agentName));
  const updatedItems = [];

  for (const targetBinding of targetBindings) {
    const item = await settingsRepository.updateModelBinding(projectId, targetBinding.id, {
      ...patch,
      providerLabel: providerLabel ?? null,
    });
    if (!item) {
      continue;
    }
    updatedItems.push(item);
  }

  return jsonOk({
    item: updatedItems[0] ?? null,
    affectedAgentNames: targetAgents,
    affectedBindingIds: updatedItems.map((item) => item.id),
  });
}
