import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsRepository, taskRepository } from '@video-agent-studio/db';
import { GET, POST } from './route';
import { createTempApiTestEnv, getDemoProject } from '../../../test-helpers';

describe('GET /api/projects/[projectId]/provider-health', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-provider-health-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it('reports misconfigured openai bindings and surfaces the latest system error', async () => {
    const project = await getDemoProject();
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(
      project.id,
      'agent1',
    );
    expect(binding).toBeTruthy();

    await settingsRepository.updateModelBinding(project.id, binding!.id, {
      provider: 'openai',
      modelName: 'gpt-5-mini',
      temperature: binding!.temperature ?? null,
      maxTokens: binding!.maxTokens ?? null,
      timeoutSec: binding!.timeoutSec ?? null,
      retryLimit: binding!.retryLimit ?? null,
      extraConfig: binding!.extraConfig ?? {},
    });

    await taskRepository.createAgentOutput('agent1', {
      runId: 'run-provider-error',
      projectId: project.id,
      agentName: 'agent1',
      stageName: 'script',
      roundNo: 1,
      parentTaskId: null,
      inputPayload: {},
      outputJson: {},
      outputMarkdown: null,
      outputSummary: 'provider failed',
      profileVersionId: null,
      modelBindingId: binding!.id,
      promptVersion: null,
      status: 'failed',
      errorType: 'system',
      errorMessage:
        'VIDEO_AGENT_STUDIO_LLM_API_KEY is required when provider is set to openai',
      latencyMs: 120,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ projectId: project.id }),
    });
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        total: number;
        warningCount: number;
        items: Array<{
          agentName: string;
          state: string;
          missingEnvVars: string[];
          lastErrorMessage?: string | null;
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.total).toBe(9);
    expect(payload.data.warningCount).toBeGreaterThanOrEqual(1);

    const agent1 = payload.data.items.find(
      (item) => item.agentName === 'agent1',
    );
    expect(agent1?.state).toBe('misconfigured');
    expect(agent1?.missingEnvVars).toContain('VIDEO_AGENT_STUDIO_LLM_API_KEY');
    expect(agent1?.lastErrorMessage).toContain(
      'VIDEO_AGENT_STUDIO_LLM_API_KEY',
    );
  });

  it('runs a real low-cost MiniMax LLM probe from backend env config', async () => {
    const project = await getDemoProject();
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(
      project.id,
      'agent1',
    );
    expect(binding).toBeTruthy();
    process.env.VIDEO_AGENT_STUDIO_LLM_API_KEY = 'minimax-test-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'probe-minimax-1',
          usage: {
            input_tokens: 3,
            output_tokens: 1,
            total_tokens: 4,
          },
          choices: [
            {
              message: {
                content: 'OK',
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

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bindingId: binding!.id,
          provider: 'minimax',
          modelName: 'MiniMax-M2.7',
        }),
      }),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        probeMode: string;
        status: string;
        summary: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.probeMode).toBe('live_llm_generate');
    expect(payload.data.status).toBe('success');
    expect(payload.data.summary).toContain('真实文本调用');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/chat/completions');
    expect(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    ).toMatchObject({
      Authorization: 'Bearer minimax-test-key',
    });
  });

  it('runs a real low-cost Anthropic LLM probe from backend env config', async () => {
    const project = await getDemoProject();
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(
      project.id,
      'agent1',
    );
    expect(binding).toBeTruthy();
    process.env.ANTHROPIC_API_KEY = 'ant-test-key';
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_123',
          content: [{ type: 'text', text: 'OK' }],
          usage: {
            input_tokens: 4,
            output_tokens: 1,
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

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bindingId: binding!.id,
          provider: 'anthropic',
          modelName: 'claude-sonnet-4-5',
        }),
      }),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        probeMode: string;
        status: string;
        summary: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.probeMode).toBe('live_llm_generate');
    expect(payload.data.status).toBe('success');
    expect(payload.data.summary).toContain('真实文本调用');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/messages');
    expect(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    ).toMatchObject({
      'x-api-key': 'ant-test-key',
      'anthropic-version': '2023-06-01',
    });
  });

  it('performs a lightweight image supplier probe without generating assets', async () => {
    const project = await getDemoProject();
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(
      project.id,
      'agent8',
    );
    expect(binding).toBeTruthy();
    process.env.VIDEO_AGENT_STUDIO_IMAGE_API_KEY = 'openai-test-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'gpt-image-1' }, { id: 'gpt-5-mini' }],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bindingId: binding!.id,
          provider: 'openai',
          modelName: 'gpt-image-1',
        }),
      }),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        probeMode: string;
        status: string;
        details: string[];
      };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.probeMode).toBe('models_list');
    expect(payload.data.status).toBe('success');
    expect(payload.data.details.join(' ')).toContain('没有触发真实媒体生成');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/models');
  });

  it('surfaces supplier auth failures during connectivity testing', async () => {
    const project = await getDemoProject();
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(
      project.id,
      'agent1',
    );
    expect(binding).toBeTruthy();
    process.env.VIDEO_AGENT_STUDIO_LLM_API_KEY = 'broken-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'authorized_error',
              message: 'invalid api key (2049)',
              http_code: '401',
            },
          }),
          {
            status: 401,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
    );

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bindingId: binding!.id,
          provider: 'minimax',
          modelName: 'MiniMax-M2.7',
        }),
      }),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );
    const payload = (await response.json()) as {
      success: boolean;
      error: {
        message?: string;
      };
    };

    expect(response.status).toBe(502);
    expect(payload.success).toBe(false);
    expect(payload.error.message).toContain('invalid api key');
  });
});
