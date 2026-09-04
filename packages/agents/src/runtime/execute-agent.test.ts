import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateMock = vi.fn();

vi.mock('@video-agent-studio/providers', async () => {
  const actual = await vi.importActual<typeof import('@video-agent-studio/providers')>(
    '@video-agent-studio/providers',
  );
  return {
    ...actual,
    createLlmProvider: vi.fn(() => ({
      generate: generateMock,
    })),
  };
});

import { executeAgent } from './execute-agent';

function buildBinding() {
  return {
    id: 'binding-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    projectId: 'project-1',
    agentName: 'agent4',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    modelName: 'MiniMax-M2.7',
    temperature: 0.7,
    maxTokens: 4096,
    timeoutSec: 120,
    retryLimit: 1,
    extraConfig: {},
    isActive: true,
    versionNo: 1,
    note: null,
    apiKeyHint: null,
    apiKeyMasked: null,
    baseUrl: 'https://api.minimaxi.com/v1',
    credentialSource: 'env',
    hasApiKey: true,
  } as const;
}

function buildProviderResult(text: string, json: Record<string, unknown> | null = null) {
  return {
    text,
    json,
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    provider: 'MiniMax',
    model: 'MiniMax-M2.7',
    responseId: 'resp-1',
    metadata: {
      baseUrl: 'https://api.minimaxi.com/v1',
    },
  };
}

describe('executeAgent structured recovery', () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it('selects the balanced JSON object that best matches the required output schema', async () => {
    generateMock.mockResolvedValueOnce(
      buildProviderResult(
        '<think>{"draft":true}</think>\n{"outputSummary":"ok","outputMarkdown":"## 成片目标","outputJson":{"scriptSections":[]}}',
      ),
    );

    const result = await executeAgent({
      agentName: 'agent4',
      stageName: 'script',
      projectTitle: '什么是AI',
      sourceIdea: '解释AI定位',
      context: {
        inputPayload: {
          revisionBrief: null,
        },
      },
      modelBinding: buildBinding(),
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.outputSummary).toBe('ok');
    expect(result.outputJson).toEqual({ scriptSections: [] });
  });

  it('uses formatting recovery when the provider returns prose before a valid JSON result', async () => {
    generateMock
      .mockResolvedValueOnce(
        buildProviderResult(
          '<think>This is a video script generation task.</think>\n## 片子定位\n- 面向学生与企业员工\n## 成片目标\n- 解释AI定位',
        ),
      )
      .mockResolvedValueOnce(buildProviderResult('Still prose only, not valid JSON.'))
      .mockResolvedValueOnce(
        buildProviderResult('', {
          outputSummary: '完成脚本格式化恢复',
          outputMarkdown: '## 分段脚本\n已恢复为结构化输出',
          outputJson: {
            scriptSections: [],
          },
        }),
      );

    const result = await executeAgent({
      agentName: 'agent4',
      stageName: 'script',
      projectTitle: '什么是AI',
      sourceIdea: '解释AI定位',
      context: {
        inputPayload: {
          revisionBrief: null,
        },
      },
      modelBinding: buildBinding(),
    });

    expect(generateMock).toHaveBeenCalledTimes(3);
    expect(result.outputSummary).toBe('完成脚本格式化恢复');
    expect(result.outputJson).toEqual({ scriptSections: [] });
    expect(result.metadata?.recoveredFromDraft).toBe(true);
  });

  it('forwards cancellation and stable per-attempt idempotency keys to the provider', async () => {
    const controller = new AbortController();
    generateMock.mockResolvedValueOnce(
      buildProviderResult('', {
        outputSummary: 'ok',
        outputMarkdown: '## Result',
        outputJson: {},
      }),
    );

    await executeAgent({
      agentName: 'agent4',
      stageName: 'script',
      projectTitle: 'provider control',
      modelBinding: buildBinding(),
      signal: controller.signal,
      idempotencyKey: 'job-1:script:agent4:round-1',
    });

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: controller.signal,
        idempotencyKey: 'job-1:script:agent4:round-1:primary',
      }),
    );
  });

  it('rejects an aborted mock-only execution before any provider is created', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by worker'));

    await expect(
      executeAgent({
        agentName: 'agent4',
        stageName: 'script',
        projectTitle: 'cancelled command',
        modelBinding: null,
        signal: controller.signal,
        idempotencyKey: 'job-cancelled:script:agent4:round-1',
      }),
    ).rejects.toThrow('cancelled by worker');
    expect(generateMock).not.toHaveBeenCalled();
  });
});
