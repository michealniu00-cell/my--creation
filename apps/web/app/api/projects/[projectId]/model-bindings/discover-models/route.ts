import { z } from 'zod';
import { ensureDb, settingsRepository } from '@video-agent-studio/db';
import {
  listProviderModels,
  normalizeProviderName,
  ProviderCatalogError,
} from '@video-agent-studio/providers';
import {
  providerScopeForAgentName,
  resolveBackendProviderApiKey,
  resolveBackendProviderBaseUrl,
} from '@video-agent-studio/shared';
import {
  jsonFail,
  jsonOk,
  readJsonWithSchema,
} from '../../../../../../lib/http';

const discoverModelsSchema = z
  .object({
    bindingId: z.string().trim().min(1).max(200),
    provider: z.string().trim().min(1).max(100),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const body = await readJsonWithSchema(request, discoverModelsSchema, {
    message: 'Invalid discover models payload',
  });
  if (!body.success) {
    return body.response;
  }

  const provider = normalizeProviderName(body.data.provider);
  if (
    provider !== 'openai' &&
    provider !== 'openai_compatible' &&
    provider !== 'anthropic'
  ) {
    return jsonFail(
      'UNSUPPORTED_PROVIDER',
      'Only OpenAI, Anthropic and OpenAI-compatible suppliers support live discovery.',
      400,
    );
  }

  const binding = await settingsRepository
    .listModelBindings(projectId)
    .then(
      (items) => items.find((item) => item.id === body.data.bindingId) ?? null,
    );
  if (!binding) {
    return jsonFail(
      'NOT_FOUND',
      'Model binding not found for this project.',
      404,
    );
  }
  const scope = providerScopeForAgentName(binding.agentName);
  const resolved = {
    apiKey: resolveBackendProviderApiKey(scope, provider),
    baseUrl: resolveBackendProviderBaseUrl(scope, provider),
  };

  if (!resolved.baseUrl) {
    return jsonFail(
      'VALIDATION_ERROR',
      'Base URL is required for live model discovery. Please configure the backend scope Base URL env first.',
      400,
    );
  }

  if (!resolved.apiKey) {
    return jsonFail(
      'PROVIDER_CONFIG_ERROR',
      provider === 'openai'
        ? 'API key is required. Please configure the backend scope API key env or set OPENAI_API_KEY.'
        : provider === 'anthropic'
          ? 'API key is required. Please configure the backend scope API key env or set ANTHROPIC_API_KEY.'
          : 'API key is required. Please configure the backend scope API key env.',
      503,
    );
  }

  try {
    const items = await listProviderModels({
      provider,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      anthropicVersion: process.env.ANTHROPIC_VERSION,
      timeoutMs: Math.max(1_000, (binding.timeoutSec ?? 15) * 1_000),
      signal: request.signal,
    });

    return jsonOk({
      items,
      baseUrl: resolved.baseUrl,
      count: items.length,
    });
  } catch (error) {
    return jsonFail(
      'PROVIDER_EXECUTION_ERROR',
      error instanceof ProviderCatalogError || error instanceof Error
        ? error.message
        : 'Failed to fetch models from supplier.',
      502,
    );
  }
}
