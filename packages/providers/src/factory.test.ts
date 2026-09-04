import { describe, expect, it } from 'vitest';
import {
  AnthropicMessagesProvider,
  MiniMaxChatProvider,
  MiniMaxImageProvider,
  MiniMaxVideoProvider,
  MockImageProvider,
  MockLlmProvider,
  MockVideoProvider,
  OpenAiImageProvider,
  OpenAiResponsesLlmProvider,
  OpenAiVideoProvider,
  createImageProvider,
  createLlmProvider,
  createVideoProvider,
} from './index';

describe('provider factory', () => {
  it('returns mock providers by default', () => {
    expect(createLlmProvider()).toBeInstanceOf(MockLlmProvider);
    expect(createImageProvider()).toBeInstanceOf(MockImageProvider);
    expect(createVideoProvider()).toBeInstanceOf(MockVideoProvider);
  });

  it('returns openai providers when bindings request openai', () => {
    const binding = {
      provider: 'openai',
      modelName: 'gpt-5',
      temperature: 0.5,
      maxTokens: 2048,
      timeoutSec: 120,
      retryLimit: 2,
      extraConfig: {},
    };

    expect(createLlmProvider(binding)).toBeInstanceOf(OpenAiResponsesLlmProvider);
    expect(createImageProvider(binding)).toBeInstanceOf(OpenAiImageProvider);
    expect(createVideoProvider(binding)).toBeInstanceOf(OpenAiVideoProvider);
  });

  it('returns minimax providers when bindings request minimax', () => {
    const binding = {
      provider: 'minimax',
      modelName: 'MiniMax-M2.5',
      temperature: 0.5,
      maxTokens: 2048,
      timeoutSec: 120,
      retryLimit: 2,
      extraConfig: {},
    };

    expect(createLlmProvider(binding)).toBeInstanceOf(MiniMaxChatProvider);
    expect(createImageProvider(binding)).toBeInstanceOf(MiniMaxImageProvider);
    expect(createVideoProvider(binding)).toBeInstanceOf(MiniMaxVideoProvider);
  });

  it('returns an anthropic provider when bindings request anthropic', () => {
    const binding = {
      provider: 'anthropic',
      modelName: 'claude-sonnet-4-5',
      temperature: 0.5,
      maxTokens: 2048,
      timeoutSec: 120,
      retryLimit: 2,
      extraConfig: {},
    };

    expect(createLlmProvider(binding)).toBeInstanceOf(AnthropicMessagesProvider);
  });
});
