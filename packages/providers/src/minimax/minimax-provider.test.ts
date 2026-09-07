import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MiniMaxChatProvider,
  MiniMaxImageProvider,
  MiniMaxVideoProvider,
} from './minimax-provider';

describe('MiniMax provider transient retry', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function videoProvider() {
    return new MiniMaxVideoProvider({
      provider: 'minimax',
      providerLabel: 'MiniMax',
      modelName: 'video-01',
      temperature: null,
      maxTokens: null,
      timeoutSec: 30,
      retryLimit: 0,
      extraConfig: {},
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'test-key',
      hasApiKey: true,
      credentialSource: 'env',
    });
  }

  it('persists the remote task before polling and resumes without submitting again', async () => {
    let savedId: string | undefined;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task_id: 'remote-1' })),
      )
      .mockImplementationOnce(async () => {
        expect(savedId).toBe('remote-1');
        throw new Error('simulated connection interruption');
      });
    await expect(
      videoProvider().generate({
        prompt: 'test video',
        onRemoteTaskSubmitted: async (id) => {
          savedId = id;
        },
      }),
    ).rejects.toThrow('simulated connection interruption');

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'Success',
          download_url: 'https://cdn.example.test/video.mp4',
        }),
      ),
    );
    const result = await videoProvider().generate({
      prompt: 'test video',
      resumeRemoteTaskId: savedId,
    });
    expect(result.remoteId).toBe('remote-1');
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      'task_id=remote-1',
    );
  });

  it('does not poll before a remote-task checkpoint has been acknowledged', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ task_id: 'remote-2' })));
    await expect(
      videoProvider().generate({
        prompt: 'test',
        onRemoteTaskSubmitted: async () => {
          throw new Error('checkpoint unavailable');
        },
      }),
    ).rejects.toThrow('checkpoint unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records terminal remote failure so a later retry can create a new task', async () => {
    const onFailed = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'Failed',
          message: 'supplier rejected task',
        }),
      ),
    );
    await expect(
      videoProvider().generate({
        prompt: 'test',
        resumeRemoteTaskId: 'remote-failed',
        onRemoteTaskFailed: onFailed,
      }),
    ).rejects.toThrow('supplier rejected task');
    expect(onFailed).toHaveBeenCalledWith('remote-failed');
  });

  it('retries overloaded text requests before succeeding', async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'overloaded_error',
              message: '当前服务集群负载较高，请稍后重试。',
              http_code: '529',
            },
          }),
          {
            status: 529,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'minimax-ok-1',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
            },
            choices: [
              {
                message: {
                  content: '{"ok":true}',
                },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      );

    const provider = new MiniMaxChatProvider({
      provider: 'minimax',
      providerLabel: 'MiniMax',
      modelName: 'MiniMax-M2.5',
      temperature: 0.7,
      maxTokens: 2048,
      timeoutSec: 120,
      retryLimit: 1,
      extraConfig: {},
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'minimax-test-key',
      hasApiKey: true,
      credentialSource: 'env',
    });

    const pending = provider.generate({
      prompt: 'ping',
      jsonSchema: {
        name: 'PingResponse',
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
          required: ['ok'],
        },
      },
    });

    await vi.runAllTimersAsync();
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.json).toEqual({ ok: true });
    expect(result.usage.totalTokens).toBe(15);
  });

  it('falls back to url mode and downloads the image when base64 mode returns no image payload', async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            base_resp: {
              status_code: 0,
              status_msg: 'success',
            },
            metadata: {
              failed_count: 0,
              success_count: 1,
            },
            data: {},
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            base_resp: {
              status_code: 0,
              status_msg: 'success',
            },
            metadata: {
              failed_count: 0,
              success_count: 1,
            },
            data: {
              image_urls: ['https://cdn.example.com/generated.png'],
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(pngBytes, {
          status: 200,
          headers: {
            'content-type': 'image/png',
          },
        }),
      );

    const provider = new MiniMaxImageProvider({
      provider: 'minimax',
      providerLabel: 'MiniMax',
      modelName: 'image-01',
      temperature: 0.7,
      maxTokens: 2048,
      timeoutSec: 120,
      retryLimit: 1,
      extraConfig: {},
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'minimax-test-key',
      hasApiKey: true,
      credentialSource: 'env',
    });

    const result = await provider.generate({
      prompt: 'generate a storyboard frame',
      width: 800,
      height: 450,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/image_generation');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/image_generation');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      'https://cdn.example.com/generated.png',
    );
    expect(result.base64Data).toBeTruthy();
    expect(result.metadata?.requestedAspectRatio).toBe('16:9');
  });

  it('surfaces base response errors from minimax image generation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          base_resp: {
            status_code: 1004,
            status_msg: 'invalid image size',
          },
          metadata: {
            failed_count: 1,
            success_count: 0,
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const provider = new MiniMaxImageProvider({
      provider: 'minimax',
      providerLabel: 'MiniMax',
      modelName: 'image-01',
      temperature: 0.7,
      maxTokens: 2048,
      timeoutSec: 120,
      retryLimit: 0,
      extraConfig: {},
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'minimax-test-key',
      hasApiKey: true,
      credentialSource: 'env',
    });

    await expect(
      provider.generate({
        prompt: 'generate a storyboard frame',
        width: 800,
        height: 450,
      }),
    ).rejects.toThrow('invalid image size');
  });
});
