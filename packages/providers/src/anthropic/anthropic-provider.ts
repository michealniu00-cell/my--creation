import type {
  LlmProvider,
  ProviderBindingConfig,
  TextGenerationInput,
  TextGenerationOutput,
  TokenUsage,
} from '../types';
import { sanitizeApiKey } from '../credentials';
import { providerIdempotencyHeaders, providerRequestSignal } from '../request-control';

interface AnthropicUsagePayload {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicMessagePayload {
  id?: string;
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: AnthropicUsagePayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildInstructions(input: TextGenerationInput) {
  if (!input.jsonSchema) {
    return input.instructions ?? '';
  }

  return [
    input.instructions ?? '',
    'Return only valid JSON.',
    `The response JSON must match this schema: ${JSON.stringify(input.jsonSchema.schema)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeUsage(usage?: AnthropicUsagePayload): TokenUsage {
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function ensureAnthropicApiKey(binding: ProviderBindingConfig) {
  const apiKey = sanitizeApiKey(binding.apiKey) ?? sanitizeApiKey(process.env.ANTHROPIC_API_KEY ?? null);
  if (!apiKey) {
    throw new Error(
      'API key is required for provider anthropic. Please configure the backend scope API key env or set ANTHROPIC_API_KEY.',
    );
  }
  return apiKey;
}

function getAnthropicVersion(binding: ProviderBindingConfig) {
  const configuredVersion =
    typeof binding.extraConfig?.anthropicVersion === 'string' ? binding.extraConfig.anthropicVersion.trim() : '';
  return configuredVersion || process.env.ANTHROPIC_VERSION || '2023-06-01';
}

function normalizeAnthropicBaseUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'https://api.minimaxi.com/anthropic';
  }
  const normalized = trimmed.replace(/\/+$/, '').replace(/\/v1$/, '');

  if (normalized === 'https://api.anthropic.com') {
    return 'https://api.minimaxi.com/anthropic';
  }

  return normalized;
}

function getAnthropicBaseUrl(binding: ProviderBindingConfig) {
  return normalizeAnthropicBaseUrl(
    binding.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.minimaxi.com/anthropic',
  );
}

function extractText(payload: AnthropicMessagePayload) {
  if (!Array.isArray(payload.content)) {
    return '';
  }

  return payload.content
    .map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
    .join('\n')
    .trim();
}

async function fetchAnthropicJson<T>(
  binding: ProviderBindingConfig,
  path: string,
  init: RequestInit,
): Promise<T> {
  const betaHeader =
    typeof binding.extraConfig?.anthropicBeta === 'string' ? binding.extraConfig.anthropicBeta.trim() : '';

  const response = await fetch(`${getAnthropicBaseUrl(binding)}${path}`, {
    ...init,
    signal: providerRequestSignal(binding, init.signal),
    headers: {
      'x-api-key': ensureAnthropicApiKey(binding),
      'anthropic-version': getAnthropicVersion(binding),
      ...(betaHeader ? { 'anthropic-beta': betaHeader } : {}),
      ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

export class AnthropicMessagesProvider implements LlmProvider {
  constructor(private readonly binding: ProviderBindingConfig) {}

  async generate(input: TextGenerationInput): Promise<TextGenerationOutput> {
    const payload = await fetchAnthropicJson<AnthropicMessagePayload>(this.binding, '/v1/messages', {
      method: 'POST',
      signal: input.signal,
      headers: providerIdempotencyHeaders(input.idempotencyKey),
      body: JSON.stringify({
        model: this.binding.modelName,
        system: buildInstructions(input) || undefined,
        messages: [
          {
            role: 'user',
            content: input.prompt,
          },
        ],
        temperature: input.temperature ?? this.binding.temperature ?? undefined,
        max_tokens: input.maxOutputTokens ?? this.binding.maxTokens ?? 4096,
      }),
    });

    const text = extractText(payload);
    const json =
      input.jsonSchema && text
        ? (() => {
            try {
              const parsed = JSON.parse(text);
              return isRecord(parsed) ? parsed : null;
            } catch {
              return null;
            }
          })()
        : null;

    return {
      text,
      json,
      usage: normalizeUsage(payload.usage),
      provider: this.binding.providerLabel ?? 'Anthropic',
      model: this.binding.modelName,
      responseId: payload.id ?? null,
      metadata: {
        api: 'messages',
        baseUrl: getAnthropicBaseUrl(this.binding),
        anthropicVersion: getAnthropicVersion(this.binding),
      },
    };
  }
}
