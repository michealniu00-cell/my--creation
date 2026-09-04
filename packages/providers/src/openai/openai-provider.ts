import { Buffer } from 'node:buffer';
import type {
  ImageGenerationInput,
  ImageProvider,
  LlmProvider,
  MediaGenerationOutput,
  ProviderBindingConfig,
  TextGenerationInput,
  TextGenerationOutput,
  TokenUsage,
  VideoGenerationInput,
  VideoProvider,
} from '../types';
import { sanitizeApiKey } from '../credentials';
import {
  abortableProviderDelay,
  providerIdempotencyHeaders,
  providerRequestSignal,
  throwIfProviderAborted,
} from '../request-control';

interface OpenAiUsagePayload {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface ChatCompletionsPayload {
  id?: string;
  usage?: OpenAiUsagePayload;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

function normalizeProvider(binding: ProviderBindingConfig) {
  return (binding.provider ?? 'openai').trim().toLowerCase();
}

function ensureApiKey(binding: ProviderBindingConfig) {
  const normalizedProvider = normalizeProvider(binding);
  const apiKey =
    sanitizeApiKey(binding.apiKey) ??
    (normalizedProvider === 'openai' ? sanitizeApiKey(process.env.OPENAI_API_KEY ?? null) : null);
  if (!apiKey) {
    if (normalizedProvider === 'openai') {
      throw new Error(
        'API key is required for provider openai. Please configure the backend scope API key env or set OPENAI_API_KEY.',
      );
    }
    throw new Error('API key is required for this provider. Please configure the backend scope API key env.');
  }
  return apiKey;
}

function getBaseUrl(binding: ProviderBindingConfig) {
  const baseUrl = binding.baseUrl?.trim();
  if (baseUrl) {
    return baseUrl.replace(/\/+$/, '');
  }

  if (normalizeProvider(binding) === 'openai') {
    return (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  throw new Error('Base URL is required when provider is set to an OpenAI-compatible supplier');
}

function normalizeUsage(usage?: OpenAiUsagePayload): TokenUsage {
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inferImageSize(width = 1024, height = 1024) {
  if (width >= 1400 && height >= 900) {
    return '1536x1024';
  }
  if (height > width) {
    return '1024x1536';
  }
  return '1024x1024';
}

function inferVideoSize(width = 1280, height = 720) {
  if (width >= height) {
    return '1280x720';
  }
  return '720x1280';
}

function inferVideoSeconds(durationMs = 4000) {
  if (durationMs <= 4000) {
    return '4';
  }
  if (durationMs <= 8000) {
    return '8';
  }
  return '12';
}

function extractResponseText(payload: Record<string, unknown>) {
  const outputText = payload.output_text;
  if (typeof outputText === 'string' && outputText) {
    return outputText;
  }

  const output = payload.output;
  if (!Array.isArray(output)) {
    return '';
  }

  const fragments: string[] = [];
  output.forEach((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      return;
    }
    item.content.forEach((content) => {
      if (!isRecord(content)) {
        return;
      }
      if (typeof content.text === 'string') {
        fragments.push(content.text);
      }
    });
  });

  return fragments.join('\n').trim();
}

function extractChatCompletionText(payload: ChatCompletionsPayload) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => (typeof item?.text === 'string' ? item.text : ''))
    .join('\n')
    .trim();
}

function extractImageBase64(payload: Record<string, unknown>) {
  const output = payload.output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.result)) {
      continue;
    }
    const base64Data = item.result.find((entry) => typeof entry === 'string');
    if (typeof base64Data === 'string' && base64Data) {
      return {
        base64Data,
        revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : null,
      };
    }
  }

  return null;
}

async function fetchOpenAiJson<T>(
  binding: ProviderBindingConfig,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${getBaseUrl(binding)}${path}`, {
    ...init,
    signal: providerRequestSignal(binding, init.signal),
    headers: {
      Authorization: `Bearer ${ensureApiKey(binding)}`,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

async function fetchOpenAiBinary(path: string) {
  throw new Error(`fetchOpenAiBinary requires a provider binding: ${path}`);
}

async function fetchBoundBinary(
  binding: ProviderBindingConfig,
  path: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`${getBaseUrl(binding)}${path}`, {
    signal: providerRequestSignal(binding, signal),
    headers: {
      Authorization: `Bearer ${ensureApiKey(binding)}`,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI binary request failed (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    bytesBase64: Buffer.from(arrayBuffer).toString('base64'),
    mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

function buildCompatibleInstructions(input: TextGenerationInput) {
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

export class OpenAiResponsesLlmProvider implements LlmProvider {
  constructor(private readonly binding: ProviderBindingConfig) {}

  async generate(input: TextGenerationInput): Promise<TextGenerationOutput> {
    const payload = await fetchOpenAiJson<Record<string, unknown>>(this.binding, '/responses', {
      method: 'POST',
      signal: input.signal,
      headers: providerIdempotencyHeaders(input.idempotencyKey),
      body: JSON.stringify({
        model: this.binding.modelName,
        instructions: input.instructions,
        input: input.prompt,
        temperature: input.temperature ?? this.binding.temperature ?? undefined,
        max_output_tokens: input.maxOutputTokens ?? this.binding.maxTokens ?? undefined,
        text: input.jsonSchema
          ? {
              format: {
                type: 'json_schema',
                name: input.jsonSchema.name,
                schema: input.jsonSchema.schema,
                strict: input.jsonSchema.strict ?? true,
              },
            }
          : undefined,
      }),
    });

    const text = extractResponseText(payload);
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
      usage: normalizeUsage((isRecord(payload.usage) ? payload.usage : undefined) as OpenAiUsagePayload | undefined),
      provider: this.binding.providerLabel ?? 'openai',
      model: this.binding.modelName,
      responseId: typeof payload.id === 'string' ? payload.id : null,
      metadata: {
        api: 'responses',
        baseUrl: getBaseUrl(this.binding),
      },
    };
  }
}

export class OpenAiCompatibleChatProvider implements LlmProvider {
  constructor(private readonly binding: ProviderBindingConfig) {}

  async generate(input: TextGenerationInput): Promise<TextGenerationOutput> {
    const payload = await fetchOpenAiJson<ChatCompletionsPayload>(this.binding, '/chat/completions', {
      method: 'POST',
      signal: input.signal,
      headers: providerIdempotencyHeaders(input.idempotencyKey),
      body: JSON.stringify({
        model: this.binding.modelName,
        temperature: input.temperature ?? this.binding.temperature ?? undefined,
        max_tokens: input.maxOutputTokens ?? this.binding.maxTokens ?? undefined,
        response_format: input.jsonSchema ? { type: 'json_object' } : undefined,
        messages: [
          ...(buildCompatibleInstructions(input)
            ? [{ role: 'system', content: buildCompatibleInstructions(input) }]
            : []),
          { role: 'user', content: input.prompt },
        ],
      }),
    });

    const text = extractChatCompletionText(payload);
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
      provider: this.binding.providerLabel ?? this.binding.provider,
      model: this.binding.modelName,
      responseId: payload.id ?? null,
      metadata: {
        api: 'chat_completions',
        baseUrl: this.binding.baseUrl ?? null,
      },
    };
  }
}

export class OpenAiImageProvider implements ImageProvider {
  constructor(private readonly binding: ProviderBindingConfig) {}

  async generate(input: ImageGenerationInput): Promise<MediaGenerationOutput> {
    if (input.referenceImage) {
      const payload = await fetchOpenAiJson<Record<string, unknown>>(this.binding, '/responses', {
        method: 'POST',
        signal: input.signal,
        headers: providerIdempotencyHeaders(input.idempotencyKey),
        body: JSON.stringify({
          model: this.binding.modelName,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: input.prompt },
                {
                  type: 'input_image',
                  image_url: `data:${input.referenceImage.mimeType};base64,${input.referenceImage.bytesBase64}`,
                },
              ],
            },
          ],
          tools: [{ type: 'image_generation' }],
        }),
      });

      const generated = extractImageBase64(payload);
      if (!generated) {
        throw new Error('OpenAI image generation did not return image content');
      }

      return {
        base64Data: generated.base64Data,
        mimeType: 'image/png',
        fileExtension: 'png',
        metadata: {
          api: 'responses',
          revisedPrompt: generated.revisedPrompt,
        },
      };
    }

    const payload = await fetchOpenAiJson<{
      data?: Array<{ b64_json?: string; revised_prompt?: string }>;
    }>(this.binding, '/images/generations', {
      method: 'POST',
      signal: input.signal,
      headers: providerIdempotencyHeaders(input.idempotencyKey),
      body: JSON.stringify({
        model: this.binding.modelName,
        prompt: input.prompt,
        size: inferImageSize(input.width, input.height),
        output_format: 'png',
      }),
    });

    const image = payload.data?.[0]?.b64_json;
    if (!image) {
      throw new Error('OpenAI image generation did not return image data');
    }

    return {
      base64Data: image,
      mimeType: 'image/png',
      fileExtension: 'png',
      metadata: {
        api: 'images',
        revisedPrompt: payload.data?.[0]?.revised_prompt ?? null,
      },
    };
  }
}

export class OpenAiVideoProvider implements VideoProvider {
  constructor(private readonly binding: ProviderBindingConfig) {}

  async generate(input: VideoGenerationInput): Promise<MediaGenerationOutput> {
    const formData = new FormData();
    formData.append('model', this.binding.modelName);
    formData.append('prompt', input.prompt);
    formData.append('seconds', inferVideoSeconds(input.durationMs));
    formData.append('size', inferVideoSize(input.width, input.height));

    if (input.referenceAsset) {
      formData.append(
        'input_reference',
        new Blob([Buffer.from(input.referenceAsset.bytesBase64, 'base64')], {
          type: input.referenceAsset.mimeType,
        }),
        input.referenceAsset.fileName ?? 'reference',
      );
    }

    const created = await fetchOpenAiJson<Record<string, unknown>>(this.binding, '/videos', {
      method: 'POST',
      signal: input.signal,
      headers: providerIdempotencyHeaders(input.idempotencyKey),
      body: formData,
    });

    const videoId = typeof created.id === 'string' ? created.id : null;
    if (!videoId) {
      throw new Error('OpenAI video generation did not return a video id');
    }

    const timeoutMs = Math.max(30_000, (this.binding.timeoutSec ?? 300) * 1_000);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      throwIfProviderAborted(input.signal);
      const statusPayload = await fetchOpenAiJson<Record<string, unknown>>(this.binding, `/videos/${videoId}`, {
        method: 'GET',
        signal: input.signal,
      });

      const status = typeof statusPayload.status === 'string' ? statusPayload.status : 'unknown';
      if (status === 'completed') {
        const downloaded = await fetchBoundBinary(
          this.binding,
          `/videos/${videoId}/content`,
          input.signal,
        );
        return {
          base64Data: downloaded.bytesBase64,
          mimeType: downloaded.mimeType,
          fileExtension: 'mp4',
          remoteId: videoId,
          metadata: {
            api: 'videos',
            status,
          },
        };
      }

      if (status === 'failed' || status === 'cancelled') {
        const errorMessage =
          typeof statusPayload.failure_reason === 'string'
            ? statusPayload.failure_reason
            : `Video generation ended with status ${status}`;
        throw new Error(errorMessage);
      }

      await abortableProviderDelay(2_000, input.signal);
    }

    throw new Error('OpenAI video generation timed out');
  }
}
