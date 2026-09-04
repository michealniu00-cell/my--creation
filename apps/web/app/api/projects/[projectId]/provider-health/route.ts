import { z } from 'zod';
import { ensureDb, settingsRepository } from '@video-agent-studio/db';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../../../lib/http';
import { testProviderConnectivity } from '../../../../../lib/provider-connectivity';
import { getProviderHealthSummary } from '../../../../../lib/provider-health';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const summary = await getProviderHealthSummary(projectId);
  return jsonOk(summary);
}

const providerConnectivitySchema = z.object({
  bindingId: z.string().min(1),
  provider: z.string().min(1),
  providerLabel: z.string().nullable().optional(),
  modelName: z.string().min(1),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().nullable().optional(),
  timeoutSec: z.number().nullable().optional(),
  retryLimit: z.number().nullable().optional(),
  extraConfig: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const body = await readJsonWithSchema(request, providerConnectivitySchema, {
    message: 'Invalid provider connectivity payload',
  });
  if (!body.success) {
    return body.response;
  }

  await settingsRepository.ensureDefaults(projectId);
  const bindings = await settingsRepository.listModelBindings(projectId);
  const targetBinding = bindings.find((item) => item.id === body.data.bindingId) ?? null;

  if (!targetBinding) {
    return jsonFail('NOT_FOUND', 'Model binding not found for this project.', 404);
  }

  const resolvedBinding =
    (await settingsRepository.getActiveModelBinding(projectId, targetBinding.agentName)) ?? targetBinding;
  const provider = body.data.provider.trim().toLowerCase();
  const modelName = body.data.modelName.trim();

  const probeBinding = {
    ...resolvedBinding,
    provider,
    providerLabel: body.data.providerLabel?.trim() || resolvedBinding.providerLabel || null,
    modelName,
    temperature: body.data.temperature ?? resolvedBinding.temperature ?? null,
    maxTokens: body.data.maxTokens ?? resolvedBinding.maxTokens ?? null,
    timeoutSec: body.data.timeoutSec ?? resolvedBinding.timeoutSec ?? null,
    retryLimit: body.data.retryLimit ?? resolvedBinding.retryLimit ?? null,
    extraConfig: body.data.extraConfig ?? resolvedBinding.extraConfig ?? {},
  };

  try {
    const result = await testProviderConnectivity(targetBinding.agentName, probeBinding);
    if (!result.success) {
      return jsonFail('PROVIDER_CONFIG_ERROR', result.summary, 400, {
        result,
      });
    }

    return jsonOk(result);
  } catch (error) {
    return jsonFail(
      'PROVIDER_EXECUTION_ERROR',
      error instanceof Error ? error.message : 'Provider connectivity probe failed.',
      502,
      {
        provider,
        modelName,
        bindingId: targetBinding.id,
      },
    );
  }
}
