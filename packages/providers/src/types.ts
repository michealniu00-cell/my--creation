import type { AgentModelBindingRecord } from '@video-agent-studio/shared';

export interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ProviderRequestControl {
  /** Propagates worker cancellation and lease/timeout aborts into network I/O. */
  signal?: AbortSignal;
  /** Stable command identity for providers that support idempotent requests. */
  idempotencyKey?: string;
}

export interface TextGenerationInput extends ProviderRequestControl {
  prompt: string;
  instructions?: string;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  jsonSchema?: JsonSchemaFormat | null;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TextGenerationOutput {
  text: string;
  json?: Record<string, unknown> | null;
  usage: TokenUsage;
  provider: string;
  model: string;
  responseId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReferenceAssetInput {
  bytesBase64: string;
  mimeType: string;
  fileName?: string | null;
}

export interface ImageGenerationInput extends ProviderRequestControl {
  prompt: string;
  width?: number;
  height?: number;
  referenceImage?: ReferenceAssetInput | null;
}

export interface VideoGenerationInput extends ProviderRequestControl {
  prompt: string;
  durationMs?: number;
  width?: number;
  height?: number;
  referenceAsset?: ReferenceAssetInput | null;
}

export interface MediaGenerationOutput {
  url?: string;
  base64Data?: string;
  mimeType?: string;
  fileExtension?: string;
  remoteId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LlmProvider {
  generate(input: TextGenerationInput): Promise<TextGenerationOutput>;
}

export interface ImageProvider {
  generate(input: ImageGenerationInput): Promise<MediaGenerationOutput>;
}

export interface VideoProvider {
  generate(input: VideoGenerationInput): Promise<MediaGenerationOutput>;
}

export type ProviderBindingConfig = Pick<
  AgentModelBindingRecord,
  | 'provider'
  | 'providerLabel'
  | 'modelName'
  | 'temperature'
  | 'maxTokens'
  | 'timeoutSec'
  | 'retryLimit'
  | 'extraConfig'
  | 'baseUrl'
  | 'apiKey'
  | 'hasApiKey'
  | 'credentialSource'
>;
