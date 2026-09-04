import type {
  ImageGenerationInput,
  ImageProvider,
  LlmProvider,
  MediaGenerationOutput,
  TextGenerationInput,
  TextGenerationOutput,
  VideoGenerationInput,
  VideoProvider,
} from '../types';
import { throwIfProviderAborted } from '../request-control';

function encodePrompt(prompt: string) {
  return encodeURIComponent(prompt.slice(0, 48).replace(/\s+/g, ' '));
}

export class MockLlmProvider implements LlmProvider {
  async generate(input: TextGenerationInput): Promise<TextGenerationOutput> {
    throwIfProviderAborted(input.signal);
    const promptTokens = Math.max(32, Math.round(input.prompt.length / 3));
    const completionTokens = Math.max(64, Math.round(input.prompt.length / 4));
    return {
      text: `Mock provider response for: ${input.prompt}`,
      json: null,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      provider: 'mock',
      model: 'mock-llm',
      responseId: null,
      metadata: {},
    };
  }
}

export class MockImageProvider implements ImageProvider {
  async generate(input: ImageGenerationInput): Promise<MediaGenerationOutput> {
    throwIfProviderAborted(input.signal);
    return {
      url: `https://placehold.co/${input.width ?? 800}x${input.height ?? 450}/d6c1a2/1d1d1d?text=${encodePrompt(input.prompt)}`,
      metadata: {},
    };
  }
}

export class MockVideoProvider implements VideoProvider {
  async generate(input: VideoGenerationInput): Promise<MediaGenerationOutput> {
    throwIfProviderAborted(input.signal);
    return {
      url: 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
      metadata: {},
    };
  }
}
