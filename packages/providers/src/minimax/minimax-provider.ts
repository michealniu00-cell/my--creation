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

interface MiniMaxUsagePayload {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

interface MiniMaxChatPayload {
  id?: string;
  usage?: MiniMaxUsagePayload;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface MiniMaxBaseRespPayload {
  status_code?: number;
  status_msg?: string;
}

interface MiniMaxImageMetadataPayload {
  failed_count?: number;
  success_count?: number;
}

interface MiniMaxImagePayload {
  data?: Record<string, unknown>;
  base_resp?: MiniMaxBaseRespPayload;
  metadata?: MiniMaxImageMetadataPayload;
}

interface MiniMaxFileRetrievePayload {
  file?: {
    file_id?: string;
    filename?: string;
    purpose?: string;
    download_url?: string;
  };
  base_resp?: MiniMaxBaseRespPayload;
}

function normalizeUsage(usage?: MiniMaxUsagePayload): TokenUsage {
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

function extractText(payload: MiniMaxChatPayload) {
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

function ensureMiniMaxApiKey(binding: ProviderBindingConfig) {
  const apiKey =
    sanitizeApiKey(binding.apiKey) ??
    sanitizeApiKey(process.env.MINIMAX_API_KEY ?? null);
  if (!apiKey) {
    throw new Error(
      'API key is required for provider minimax. Please configure the backend scope API key env or set MINIMAX_API_KEY.',
    );
  }
  return apiKey;
}

function getMiniMaxBaseUrl(binding: ProviderBindingConfig) {
  const raw = (
    binding.baseUrl ??
    process.env.MINIMAX_BASE_URL ??
    'https://api.minimaxi.com/v1'
  ).replace(/\/+$/, '');

  try {
    const url = new URL(raw);
    if (url.hostname === 'api.minimax.io') {
      url.hostname = 'api.minimaxi.com';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return raw;
  }

  return raw;
}

function getMiniMaxFallbackBaseUrls(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '');

  try {
    const url = new URL(normalized);
    if (url.hostname === 'api.minimax.io') {
      url.hostname = 'api.minimaxi.com';
      return [url.toString().replace(/\/+$/, '')];
    }
  } catch {
    return [normalized];
  }

  return [normalized];
}

function shouldRetryMiniMaxAgainstAlternateRegion(
  status: number,
  errorText: string,
) {
  return false;
}

function getMiniMaxRetryLimit(binding: ProviderBindingConfig) {
  return Math.max(0, binding.retryLimit ?? 2);
}

function shouldRetryMiniMaxTransient(status: number, errorText: string) {
  if (status === 429 || status === 529 || status >= 500) {
    return true;
  }

  return /overloaded_error|服务集群负载较高|temporarily unavailable|try again later|timeout/i.test(
    errorText,
  );
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
}

function getMiniMaxRetryDelayMs(
  attempt: number,
  retryAfterHeader: string | null,
) {
  const hintedDelay = parseRetryAfterMs(retryAfterHeader);
  if (typeof hintedDelay === 'number' && hintedDelay > 0) {
    return Math.min(30_000, hintedDelay);
  }

  return [1_500, 3_000, 5_000, 8_000][attempt] ?? 8_000;
}

function inferMiniMaxImageDimensions(width = 1024, height = 1024) {
  return {
    width: Math.max(512, Math.min(2048, Math.round(width))),
    height: Math.max(512, Math.min(2048, Math.round(height))),
  };
}

function normalizeMiniMaxDimension(value: number) {
  const clamped = Math.max(512, Math.min(2048, Math.round(value)));
  return Math.max(512, Math.round(clamped / 8) * 8);
}

function inferMiniMaxAspectRatio(width = 1024, height = 1024) {
  const ratio = width / height;
  const candidates = [
    { label: '1:1', value: 1 },
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:4', value: 3 / 4 },
    { label: '3:2', value: 3 / 2 },
    { label: '2:3', value: 2 / 3 },
  ];

  const match = candidates.find(
    (candidate) => Math.abs(candidate.value - ratio) <= 0.02,
  );
  return match?.label ?? null;
}

function buildMiniMaxImageSize(width = 1024, height = 1024) {
  const aspectRatio = inferMiniMaxAspectRatio(width, height);
  if (aspectRatio) {
    return { aspectRatio, width: null, height: null };
  }

  return {
    aspectRatio: null,
    width: normalizeMiniMaxDimension(width),
    height: normalizeMiniMaxDimension(height),
  };
}

function inferMiniMaxVideoResolution(width = 1280, height = 720) {
  const maxEdge = Math.max(width, height);
  if (maxEdge >= 1440) {
    return '1080P';
  }
  return '768P';
}

function inferMiniMaxDuration(durationMs = 6000) {
  return durationMs > 7_000 ? 10 : 6;
}

function dataUrlFromReference(reference: {
  mimeType: string;
  bytesBase64: string;
}) {
  return `data:${reference.mimeType};base64,${reference.bytesBase64}`;
}

function extractMiniMaxImageCandidate(data: Record<string, unknown>) {
  const base64Candidate = Array.isArray(data.image_base64)
    ? data.image_base64.find((item) => typeof item === 'string')
    : typeof data.image_base64 === 'string'
      ? data.image_base64
      : typeof data.imageBase64 === 'string'
        ? data.imageBase64
        : Array.isArray(data.images)
          ? data.images.find(
              (item) =>
                isRecord(item) &&
                typeof item.base64 === 'string' &&
                item.base64,
            )?.base64
          : null;

  const urlCandidate = Array.isArray(data.image_urls)
    ? data.image_urls.find((item) => typeof item === 'string')
    : typeof data.image_urls === 'string'
      ? data.image_urls
      : typeof data.image_url === 'string'
        ? data.image_url
        : typeof data.imageUrl === 'string'
          ? data.imageUrl
          : Array.isArray(data.images)
            ? data.images.find(
                (item) =>
                  isRecord(item) && typeof item.url === 'string' && item.url,
              )?.url
            : null;

  return {
    base64Candidate:
      typeof base64Candidate === 'string' ? base64Candidate : null,
    urlCandidate: typeof urlCandidate === 'string' ? urlCandidate : null,
  };
}

async function fetchRemoteAssetAsBase64(
  binding: ProviderBindingConfig,
  url: string,
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    method: 'GET',
    signal: providerRequestSignal(binding, signal),
  });
  if (!response.ok) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    bytesBase64: Buffer.from(arrayBuffer).toString('base64'),
    mimeType: response.headers.get('content-type') ?? 'image/png',
  };
}

async function fetchMiniMaxJson<T>(
  binding: ProviderBindingConfig,
  path: string,
  init: RequestInit,
): Promise<T> {
  const baseUrls = getMiniMaxFallbackBaseUrls(getMiniMaxBaseUrl(binding));
  const retryLimit = getMiniMaxRetryLimit(binding);
  let lastError: Error | null = null;

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index];
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          signal: providerRequestSignal(binding, init.signal),
          headers: {
            Authorization: `Bearer ${ensureMiniMaxApiKey(binding)}`,
            ...(init.body instanceof FormData
              ? {}
              : { 'Content-Type': 'application/json' }),
            ...init.headers,
          },
        });

        if (response.ok) {
          binding.baseUrl = baseUrl;
          return (await response.json()) as T;
        }

        const errorText = await response.text();
        if (
          shouldRetryMiniMaxTransient(response.status, errorText) &&
          attempt < retryLimit
        ) {
          await abortableProviderDelay(
            getMiniMaxRetryDelayMs(
              attempt,
              response.headers.get('retry-after'),
            ),
            init.signal,
          );
          continue;
        }

        lastError = new Error(
          `MiniMax request failed (${response.status}): ${errorText}`,
        );
        if (
          !shouldRetryMiniMaxAgainstAlternateRegion(
            response.status,
            errorText,
          ) ||
          index === baseUrls.length - 1
        ) {
          throw lastError;
        }
        break;
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        if (attempt < retryLimit) {
          lastError = resolvedError;
          await abortableProviderDelay(
            getMiniMaxRetryDelayMs(attempt, null),
            init.signal,
          );
          continue;
        }
        throw resolvedError;
      }
    }
  }

  throw lastError ?? new Error('MiniMax request failed');
}

async function fetchMiniMaxBinary(
  binding: ProviderBindingConfig,
  path: string,
  signal?: AbortSignal,
) {
  const baseUrls = getMiniMaxFallbackBaseUrls(getMiniMaxBaseUrl(binding));
  const retryLimit = getMiniMaxRetryLimit(binding);
  let lastError: Error | null = null;

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index];
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'GET',
          signal: providerRequestSignal(binding, signal),
          headers: {
            Authorization: `Bearer ${ensureMiniMaxApiKey(binding)}`,
          },
        });

        if (response.ok) {
          binding.baseUrl = baseUrl;
          const arrayBuffer = await response.arrayBuffer();
          return {
            bytesBase64: Buffer.from(arrayBuffer).toString('base64'),
            mimeType:
              response.headers.get('content-type') ??
              'application/octet-stream',
          };
        }

        const errorText = await response.text();
        if (
          shouldRetryMiniMaxTransient(response.status, errorText) &&
          attempt < retryLimit
        ) {
          await abortableProviderDelay(
            getMiniMaxRetryDelayMs(
              attempt,
              response.headers.get('retry-after'),
            ),
            signal,
          );
          continue;
        }

        lastError = new Error(
          `MiniMax binary request failed (${response.status}): ${errorText}`,
        );
        if (
          !shouldRetryMiniMaxAgainstAlternateRegion(
            response.status,
            errorText,
          ) ||
          index === baseUrls.length - 1
        ) {
          throw lastError;
        }
        break;
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        if (attempt < retryLimit) {
          lastError = resolvedError;
          await abortableProviderDelay(
            getMiniMaxRetryDelayMs(attempt, null),
            signal,
          );
          continue;
        }
        throw resolvedError;
      }
    }
  }

  throw lastError ?? new Error('MiniMax binary request failed');
}

export class MiniMaxChatProvider implements LlmProvider {
  constructor(private readonly binding: ProviderBindingConfig) {}

  async generate(input: TextGenerationInput): Promise<TextGenerationOutput> {
    const payload = await fetchMiniMaxJson<MiniMaxChatPayload>(
      this.binding,
      '/chat/completions',
      {
        method: 'POST',
        signal: input.signal,
        headers: providerIdempotencyHeaders(input.idempotencyKey),
        body: JSON.stringify({
          model: this.binding.modelName,
          temperature:
            input.temperature ?? this.binding.temperature ?? undefined,
          max_tokens:
            input.maxOutputTokens ?? this.binding.maxTokens ?? undefined,
          reasoning_split: input.jsonSchema ? false : true,
          response_format: input.jsonSchema
            ? { type: 'json_object' }
            : undefined,
          messages: [
            ...(buildInstructions(input)
              ? [{ role: 'system', content: buildInstructions(input) }]
              : []),
            { role: 'user', content: input.prompt },
          ],
        }),
      },
    );

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
      provider: this.binding.providerLabel ?? 'MiniMax',
      model: this.binding.modelName,
      responseId: payload.id ?? null,
      metadata: {
        api: 'chat_completions',
        baseUrl: getMiniMaxBaseUrl(this.binding),
      },
    };
  }
}

export class MiniMaxImageProvider implements ImageProvider {
  constructor(private readonly binding: ProviderBindingConfig) {}

  async generate(input: ImageGenerationInput): Promise<MediaGenerationOutput> {
    const size = buildMiniMaxImageSize(input.width, input.height);

    const requestPayload = async (responseFormat: 'base64' | 'url') =>
      fetchMiniMaxJson<MiniMaxImagePayload>(this.binding, '/image_generation', {
        method: 'POST',
        signal: input.signal,
        headers: providerIdempotencyHeaders(
          input.idempotencyKey
            ? `${input.idempotencyKey}:${responseFormat}`
            : undefined,
        ),
        body: JSON.stringify({
          model: this.binding.modelName,
          prompt: input.prompt,
          aspect_ratio: size.aspectRatio ?? undefined,
          width: size.width ?? undefined,
          height: size.height ?? undefined,
          response_format: responseFormat,
          subject_reference: input.referenceImage
            ? [
                {
                  type: 'character',
                  image_file: dataUrlFromReference(input.referenceImage),
                },
              ]
            : undefined,
        }),
      });

    const payload = await requestPayload('base64');
    const baseResp = isRecord(payload.base_resp) ? payload.base_resp : null;
    const baseStatusCode =
      typeof baseResp?.status_code === 'number' ? baseResp.status_code : 0;
    const baseStatusMessage =
      typeof baseResp?.status_msg === 'string' ? baseResp.status_msg : null;

    if (baseStatusCode !== 0) {
      throw new Error(
        baseStatusMessage ??
          `MiniMax image generation failed with status ${baseStatusCode}`,
      );
    }

    const metadata = isRecord(payload.metadata) ? payload.metadata : null;
    const failedCount =
      typeof metadata?.failed_count === 'number' ? metadata.failed_count : 0;
    const successCount =
      typeof metadata?.success_count === 'number'
        ? metadata.success_count
        : null;

    const data = isRecord(payload.data)
      ? payload.data
      : isRecord(payload)
        ? payload
        : {};
    let { base64Candidate, urlCandidate } = extractMiniMaxImageCandidate(data);

    if (!base64Candidate && !urlCandidate) {
      const fallbackPayload = await requestPayload('url');
      const fallbackBaseResp = isRecord(fallbackPayload.base_resp)
        ? fallbackPayload.base_resp
        : null;
      const fallbackStatusCode =
        typeof fallbackBaseResp?.status_code === 'number'
          ? fallbackBaseResp.status_code
          : 0;
      const fallbackStatusMessage =
        typeof fallbackBaseResp?.status_msg === 'string'
          ? fallbackBaseResp.status_msg
          : null;
      if (fallbackStatusCode !== 0) {
        throw new Error(
          fallbackStatusMessage ??
            `MiniMax image generation failed with status ${fallbackStatusCode}`,
        );
      }

      const fallbackData = isRecord(fallbackPayload.data)
        ? fallbackPayload.data
        : isRecord(fallbackPayload)
          ? fallbackPayload
          : {};
      ({ base64Candidate, urlCandidate } =
        extractMiniMaxImageCandidate(fallbackData));
    }

    if (!base64Candidate && urlCandidate) {
      const downloaded = await fetchRemoteAssetAsBase64(
        this.binding,
        urlCandidate,
        input.signal,
      );
      if (downloaded) {
        base64Candidate = downloaded.bytesBase64;
        return {
          base64Data: base64Candidate,
          mimeType: downloaded.mimeType,
          fileExtension: downloaded.mimeType.includes('jpeg') ? 'jpg' : 'png',
          metadata: {
            api: 'image_generation',
            baseUrl: getMiniMaxBaseUrl(this.binding),
            requestedAspectRatio: size.aspectRatio,
          },
        };
      }
    }

    if (!base64Candidate && !urlCandidate) {
      if (failedCount > 0 && successCount === 0) {
        throw new Error(
          baseStatusMessage ??
            `MiniMax image generation failed (${failedCount} request(s) did not produce an image)`,
        );
      }
      throw new Error('MiniMax image generation did not return image data');
    }

    return {
      base64Data: base64Candidate ?? undefined,
      url: urlCandidate ?? undefined,
      mimeType: 'image/png',
      fileExtension: 'png',
      metadata: {
        api: 'image_generation',
        baseUrl: getMiniMaxBaseUrl(this.binding),
        requestedAspectRatio: size.aspectRatio,
      },
    };
  }
}

export class MiniMaxVideoProvider implements VideoProvider {
  constructor(private readonly binding: ProviderBindingConfig) {}

  async generate(input: VideoGenerationInput): Promise<MediaGenerationOutput> {
    throwIfProviderAborted(input.signal);
    let taskId = input.resumeRemoteTaskId?.trim();
    if (!taskId) {
      const created = await fetchMiniMaxJson<Record<string, unknown>>(
        this.binding,
        '/video_generation',
        {
          method: 'POST',
          signal: input.signal,
          headers: providerIdempotencyHeaders(input.idempotencyKey),
          body: JSON.stringify({
            model: this.binding.modelName,
            prompt: input.prompt,
            duration: inferMiniMaxDuration(input.durationMs),
            resolution: inferMiniMaxVideoResolution(input.width, input.height),
            first_frame_image: input.referenceAsset
              ? dataUrlFromReference(input.referenceAsset)
              : undefined,
          }),
        },
      );

      const baseResp = isRecord(created.base_resp) ? created.base_resp : null;
      const baseStatusCode =
        typeof baseResp?.status_code === 'number' ? baseResp.status_code : 0;
      const baseStatusMessage =
        typeof baseResp?.status_msg === 'string' ? baseResp.status_msg : null;

      if (baseStatusCode !== 0) {
        throw new Error(
          baseStatusMessage ??
            `MiniMax video generation request failed with status ${baseStatusCode}`,
        );
      }

      taskId =
        typeof created.task_id === 'string'
          ? created.task_id
          : isRecord(created.data) && typeof created.data.task_id === 'string'
            ? created.data.task_id
            : typeof created.id === 'string'
              ? created.id
              : undefined;
      if (!taskId) {
        throw new Error(
          baseStatusMessage
            ? `MiniMax video generation did not return a task id: ${baseStatusMessage}`
            : 'MiniMax video generation did not return a task id',
        );
      }
      // Await the durable acknowledgement: a process restart after this point
      // resumes the supplier job instead of paying for a duplicate generation.
      await input.onRemoteTaskSubmitted?.(taskId);
    }

    const timeoutMs = Math.max(
      30_000,
      (this.binding.timeoutSec ?? 300) * 1_000,
    );
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      throwIfProviderAborted(input.signal);
      const statusPayload = await fetchMiniMaxJson<Record<string, unknown>>(
        this.binding,
        `/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
        { method: 'GET', signal: input.signal },
      );

      const status =
        typeof statusPayload.status === 'string'
          ? statusPayload.status
          : 'Unknown';
      if (status === 'Success') {
        const fileId =
          typeof statusPayload.file_id === 'string'
            ? statusPayload.file_id
            : null;
        const downloadUrl =
          typeof statusPayload.download_url === 'string'
            ? statusPayload.download_url
            : null;

        if (fileId) {
          const filePayload =
            await fetchMiniMaxJson<MiniMaxFileRetrievePayload>(
              this.binding,
              `/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
              { method: 'GET', signal: input.signal },
            );
          const fileBaseResp = isRecord(filePayload.base_resp)
            ? filePayload.base_resp
            : null;
          const fileStatusCode =
            typeof fileBaseResp?.status_code === 'number'
              ? fileBaseResp.status_code
              : 0;
          const fileStatusMessage =
            typeof fileBaseResp?.status_msg === 'string'
              ? fileBaseResp.status_msg
              : null;
          if (fileStatusCode !== 0) {
            throw new Error(
              fileStatusMessage ??
                `MiniMax file retrieve failed with status ${fileStatusCode}`,
            );
          }

          const file = isRecord(filePayload.file) ? filePayload.file : null;
          const retrievedDownloadUrl =
            typeof file?.download_url === 'string' ? file.download_url : null;

          if (retrievedDownloadUrl) {
            return {
              url: retrievedDownloadUrl,
              mimeType: 'video/mp4',
              fileExtension: 'mp4',
              remoteId: taskId,
              metadata: {
                api: 'video_generation',
                fileId,
                status,
                filename:
                  typeof file?.filename === 'string' ? file.filename : null,
              },
            };
          }

          const downloaded = await fetchMiniMaxBinary(
            this.binding,
            `/files/retrieve_content?file_id=${encodeURIComponent(fileId)}`,
            input.signal,
          );
          return {
            base64Data: downloaded.bytesBase64,
            mimeType: downloaded.mimeType,
            fileExtension: 'mp4',
            remoteId: taskId,
            metadata: {
              api: 'video_generation',
              fileId,
              status,
              filename:
                typeof file?.filename === 'string' ? file.filename : null,
            },
          };
        }

        if (downloadUrl) {
          return {
            url: downloadUrl,
            mimeType: 'video/mp4',
            fileExtension: 'mp4',
            remoteId: taskId,
            metadata: {
              api: 'video_generation',
              status,
            },
          };
        }

        throw new Error(
          'MiniMax video task succeeded but did not return a downloadable file',
        );
      }

      if (status === 'Fail' || status === 'Failed') {
        await input.onRemoteTaskFailed?.(taskId);
        const errorMessage =
          typeof statusPayload.message === 'string'
            ? statusPayload.message
            : `MiniMax video generation ended with status ${status}`;
        throw new Error(errorMessage);
      }

      await abortableProviderDelay(2_000, input.signal);
    }

    throw new Error('MiniMax video generation timed out');
  }
}
