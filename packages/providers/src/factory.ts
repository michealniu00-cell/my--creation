import type { ProviderBindingConfig } from './types';
import type { ImageProvider, LlmProvider, VideoProvider } from './types';
import { AnthropicMessagesProvider } from './anthropic/anthropic-provider';
import { normalizeProviderName } from './health';
import { MockImageProvider, MockLlmProvider, MockVideoProvider } from './mock/mock-provider';
import {
  MiniMaxChatProvider,
  MiniMaxImageProvider,
  MiniMaxVideoProvider,
} from './minimax/minimax-provider';
import {
  OpenAiImageProvider,
  OpenAiCompatibleChatProvider,
  OpenAiResponsesLlmProvider,
  OpenAiVideoProvider,
} from './openai/openai-provider';

export function createLlmProvider(binding?: ProviderBindingConfig | null): LlmProvider {
  switch (normalizeProviderName(binding?.provider)) {
    case 'openai':
      if (!binding) {
        throw new Error('Missing model binding for OpenAI LLM provider');
      }
      return new OpenAiResponsesLlmProvider(binding);
    case 'openai_compatible':
      if (!binding) {
        throw new Error('Missing model binding for OpenAI-compatible LLM provider');
      }
      return new OpenAiCompatibleChatProvider(binding);
    case 'anthropic':
      if (!binding) {
        throw new Error('Missing model binding for Anthropic LLM provider');
      }
      return new AnthropicMessagesProvider(binding);
    case 'minimax':
      if (!binding) {
        throw new Error('Missing model binding for MiniMax LLM provider');
      }
      return new MiniMaxChatProvider(binding);
    case 'mock':
      return new MockLlmProvider();
    default:
      throw new Error(`Unsupported LLM provider: ${binding?.provider ?? 'unknown'}`);
  }
}

export function createImageProvider(binding?: ProviderBindingConfig | null): ImageProvider {
  switch (normalizeProviderName(binding?.provider)) {
    case 'openai':
      if (!binding) {
        throw new Error('Missing model binding for OpenAI image provider');
      }
      return new OpenAiImageProvider(binding);
    case 'minimax':
      if (!binding) {
        throw new Error('Missing model binding for MiniMax image provider');
      }
      return new MiniMaxImageProvider(binding);
    case 'mock':
      return new MockImageProvider();
    default:
      throw new Error(`Unsupported image provider: ${binding?.provider ?? 'unknown'}`);
  }
}

export function createVideoProvider(binding?: ProviderBindingConfig | null): VideoProvider {
  switch (normalizeProviderName(binding?.provider)) {
    case 'openai':
      if (!binding) {
        throw new Error('Missing model binding for OpenAI video provider');
      }
      return new OpenAiVideoProvider(binding);
    case 'minimax':
      if (!binding) {
        throw new Error('Missing model binding for MiniMax video provider');
      }
      return new MiniMaxVideoProvider(binding);
    case 'mock':
      return new MockVideoProvider();
    default:
      throw new Error(`Unsupported video provider: ${binding?.provider ?? 'unknown'}`);
  }
}
