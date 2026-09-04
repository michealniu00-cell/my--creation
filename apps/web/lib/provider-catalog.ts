import type { AgentName } from '@video-agent-studio/shared';

export type SupplierScope = 'llm' | 'image' | 'video';

export interface SupplierModelOption {
  id: string;
  label?: string;
  note?: string;
  lifecycle?: 'stable' | 'preview' | 'alias' | 'auto';
}

export interface SupplierCatalogEntry {
  id: string;
  label: string;
  provider: 'mock' | 'openai' | 'openai_compatible' | 'anthropic' | 'minimax';
  providerLabel: string;
  baseUrl?: string | null;
  docsUrl?: string | null;
  scopes: SupplierScope[];
  supportsDiscovery: boolean;
  note?: string;
  modelsByScope: Partial<Record<SupplierScope, SupplierModelOption[]>>;
}

export interface DiscoveredModelOption {
  id: string;
  label: string;
  ownedBy?: string | null;
  source: 'preset' | 'live';
}

export const PROVIDER_CATALOG_UPDATED_AT = '2026-04-09';

export function scopeForAgent(agentName?: AgentName | null): SupplierScope {
  if (agentName === 'agent8') {
    return 'image';
  }
  if (agentName === 'agent9') {
    return 'video';
  }
  return 'llm';
}

export const supplierCatalog: SupplierCatalogEntry[] = [
  {
    id: 'mock',
    label: 'Mock / 演示模式',
    provider: 'mock',
    providerLabel: 'Mock',
    baseUrl: null,
    docsUrl: null,
    scopes: ['llm', 'image', 'video'],
    supportsDiscovery: false,
    note: '本地演示流程，不会调用真实模型。',
    modelsByScope: {
      llm: [{ id: 'mock-llm', label: 'mock-llm', lifecycle: 'auto' }],
      image: [{ id: 'mock-image', label: 'mock-image', lifecycle: 'auto' }],
      video: [{ id: 'mock-video', label: 'mock-video', lifecycle: 'auto' }],
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    providerLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/docs/models',
    scopes: ['llm', 'image', 'video'],
    supportsDiscovery: true,
    note: 'OpenAI 官方直连，支持实时获取 /models 列表。',
    modelsByScope: {
      llm: [
        { id: 'gpt-5.2', lifecycle: 'stable' },
        { id: 'gpt-5.2-pro', lifecycle: 'stable' },
        { id: 'gpt-5.1', lifecycle: 'stable' },
        { id: 'gpt-5', lifecycle: 'stable' },
        { id: 'gpt-5-mini', lifecycle: 'stable' },
        { id: 'gpt-5-nano', lifecycle: 'stable' },
        { id: 'gpt-4.1', lifecycle: 'stable' },
        { id: 'gpt-4.1-mini', lifecycle: 'stable' },
        { id: 'gpt-4.1-nano', lifecycle: 'stable' },
        { id: 'gpt-oss-120b', lifecycle: 'stable' },
        { id: 'gpt-oss-20b', lifecycle: 'stable' },
        { id: 'o3-deep-research', lifecycle: 'stable' },
        { id: 'o4-mini-deep-research', lifecycle: 'stable' },
        { id: 'gpt-realtime', lifecycle: 'stable' },
        { id: 'gpt-realtime-mini', lifecycle: 'stable' },
        { id: 'gpt-audio', lifecycle: 'stable' },
        { id: 'gpt-audio-mini', lifecycle: 'stable' },
      ],
      image: [
        { id: 'gpt-image-1.5', lifecycle: 'stable' },
        { id: 'chatgpt-image-latest', lifecycle: 'alias' },
        { id: 'gpt-image-1', lifecycle: 'stable' },
        { id: 'gpt-image-1-mini', lifecycle: 'stable' },
      ],
      video: [
        { id: 'sora-2', lifecycle: 'stable' },
        { id: 'sora-2-pro', lifecycle: 'stable' },
      ],
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic / Claude',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    scopes: ['llm'],
    supportsDiscovery: true,
    note: '当前项目默认按国内兼容入口显示；如需 Anthropic 官方直连，可在后端环境变量中改成官方 Base URL。',
    modelsByScope: {
      llm: [
        { id: 'claude-sonnet-4-5', lifecycle: 'stable' },
        { id: 'claude-opus-4-1', lifecycle: 'stable' },
        { id: 'claude-haiku-4-5', lifecycle: 'stable' },
      ],
    },
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    docsUrl: 'https://platform.minimax.io/docs/overview',
    scopes: ['llm', 'image', 'video'],
    supportsDiscovery: false,
    note: '当前项目默认按国内站接口显示；文本使用兼容 chat/completions，图像与视频使用 MiniMax 原生接口。',
    modelsByScope: {
      llm: [
        { id: 'MiniMax-M2.7', lifecycle: 'stable' },
        { id: 'MiniMax-M2.7-highspeed', lifecycle: 'stable' },
        { id: 'MiniMax-M2.5', lifecycle: 'stable' },
        { id: 'MiniMax-M2.5-highspeed', lifecycle: 'stable' },
        { id: 'MiniMax-M2.1', lifecycle: 'stable' },
        { id: 'MiniMax-M2.1-highspeed', lifecycle: 'stable' },
        { id: 'MiniMax-M2', lifecycle: 'stable' },
      ],
      image: [
        { id: 'image-01', lifecycle: 'stable' },
        { id: 'image-01-live', lifecycle: 'stable' },
      ],
      video: [
        { id: 'MiniMax-Hailuo-2.3', lifecycle: 'stable' },
        { id: 'MiniMax-Hailuo-2.3-Fast', lifecycle: 'stable' },
        { id: 'MiniMax-Hailuo-02', lifecycle: 'stable' },
        { id: 'T2V-01-Director', lifecycle: 'stable' },
        { id: 'T2V-01', lifecycle: 'stable' },
        { id: 'I2V-01-Director', lifecycle: 'stable' },
        { id: 'I2V-01-live', lifecycle: 'stable' },
        { id: 'I2V-01', lifecycle: 'stable' },
      ],
    },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai_compatible',
    providerLabel: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs/guides/overview/models',
    scopes: ['llm'],
    supportsDiscovery: true,
    note: '聚合多家模型，支持实时发现数百个模型。',
    modelsByScope: {
      llm: [
        { id: 'openrouter/auto', lifecycle: 'auto', note: '自动路由高质量模型' },
      ],
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai_compatible',
    providerLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://api-docs.deepseek.com/',
    scopes: ['llm'],
    supportsDiscovery: true,
    modelsByScope: {
      llm: [
        { id: 'deepseek-chat', lifecycle: 'stable' },
        { id: 'deepseek-reasoner', lifecycle: 'stable' },
      ],
    },
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    provider: 'openai_compatible',
    providerLabel: 'Moonshot AI',
    baseUrl: 'https://api.moonshot.ai/v1',
    docsUrl: 'https://platform.moonshot.ai/docs/overview',
    scopes: ['llm'],
    supportsDiscovery: false,
    modelsByScope: {
      llm: [
        { id: 'kimi-k2.5', lifecycle: 'stable' },
        { id: 'kimi-k2-thinking', lifecycle: 'stable' },
        { id: 'kimi-k2-thinking-turbo', lifecycle: 'stable' },
        { id: 'kimi-k2-turbo-preview', lifecycle: 'preview' },
        { id: 'kimi-k2-0905-preview', lifecycle: 'preview' },
      ],
    },
  },
  {
    id: 'groq',
    label: 'Groq',
    provider: 'openai_compatible',
    providerLabel: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/docs/models',
    scopes: ['llm'],
    supportsDiscovery: true,
    modelsByScope: {
      llm: [
        { id: 'openai/gpt-oss-120b', lifecycle: 'stable' },
        { id: 'openai/gpt-oss-20b', lifecycle: 'preview' },
        { id: 'llama-3.1-8b-instant', lifecycle: 'stable' },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', lifecycle: 'preview' },
        { id: 'qwen/qwen3-32b', lifecycle: 'preview' },
      ],
    },
  },
  {
    id: 'together',
    label: 'Together AI',
    provider: 'openai_compatible',
    providerLabel: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    docsUrl: 'https://docs.together.ai/docs/serverless-models',
    scopes: ['llm'],
    supportsDiscovery: false,
    modelsByScope: {
      llm: [
        { id: 'MiniMaxAI/MiniMax-M2.5', lifecycle: 'stable' },
        { id: 'Qwen/Qwen3.5-397B-A17B', lifecycle: 'stable' },
        { id: 'Qwen/Qwen3.5-9B', lifecycle: 'stable' },
        { id: 'moonshotai/Kimi-K2-Instruct-0905', lifecycle: 'stable' },
        { id: 'deepseek-ai/DeepSeek-V3.1', lifecycle: 'stable' },
        { id: 'openai/gpt-oss-120b', lifecycle: 'stable' },
        { id: 'zai-org/GLM-4.6', lifecycle: 'stable' },
      ],
    },
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    provider: 'openai_compatible',
    providerLabel: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.com/v1',
    docsUrl: 'https://docs.siliconflow.com/en/api-reference/models/get-model-list',
    scopes: ['llm'],
    supportsDiscovery: true,
    note: '平台模型实时变化较快，建议直接同步 live models。',
    modelsByScope: {
      llm: [],
    },
  },
  {
    id: 'alibaba-qwen-intl',
    label: 'Alibaba Qwen Intl',
    provider: 'openai_compatible',
    providerLabel: 'Alibaba Model Studio',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
    scopes: ['llm'],
    supportsDiscovery: false,
    modelsByScope: {
      llm: [
        { id: 'qwen3-max', lifecycle: 'stable' },
        { id: 'qwen3-max-preview', lifecycle: 'preview' },
        { id: 'qwen3.5-plus', lifecycle: 'stable' },
        { id: 'qwen3.5-flash', lifecycle: 'stable' },
        { id: 'qwen-max-latest', lifecycle: 'alias' },
        { id: 'qwen-plus-latest', lifecycle: 'alias' },
        { id: 'qwen-flash-latest', lifecycle: 'alias' },
      ],
    },
  },
  {
    id: 'xai',
    label: 'xAI',
    provider: 'openai_compatible',
    providerLabel: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    docsUrl: 'https://docs.x.ai/developers/models',
    scopes: ['llm'],
    supportsDiscovery: true,
    modelsByScope: {
      llm: [
        { id: 'grok-4', lifecycle: 'stable' },
        { id: 'grok-4-fast-reasoning', lifecycle: 'stable' },
        { id: 'grok-4.20', lifecycle: 'preview' },
      ],
    },
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    provider: 'openai_compatible',
    providerLabel: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai/v1',
    docsUrl: 'https://docs.perplexity.ai/api-reference/models-get',
    scopes: ['llm'],
    supportsDiscovery: true,
    modelsByScope: {
      llm: [
        { id: 'perplexity/sonar', lifecycle: 'stable' },
        { id: 'openai/gpt-5.4', lifecycle: 'stable' },
        { id: 'anthropic/claude-sonnet-4-6', lifecycle: 'stable' },
        { id: 'google/gemini-3.1-pro-preview', lifecycle: 'preview' },
        { id: 'google/gemini-2.5-pro', lifecycle: 'stable' },
        { id: 'google/gemini-2.5-flash', lifecycle: 'stable' },
        { id: 'xai/grok-4-1-fast-non-reasoning', lifecycle: 'stable' },
      ],
    },
  },
  {
    id: 'custom-compatible',
    label: '自定义 OpenAI 兼容',
    provider: 'openai_compatible',
    providerLabel: 'Custom Compatible',
    baseUrl: null,
    docsUrl: null,
    scopes: ['llm'],
    supportsDiscovery: true,
    note: '填写任意兼容 OpenAI 的 Base URL 和 API Key。',
    modelsByScope: {
      llm: [],
    },
  },
];

export function getSuppliersForScope(scope: SupplierScope) {
  return supplierCatalog.filter((supplier) => supplier.scopes.includes(scope));
}

export function getSupplierById(id?: string | null) {
  return supplierCatalog.find((supplier) => supplier.id === id) ?? null;
}

export function inferSupplierId(binding: {
  provider?: string | null;
  providerLabel?: string | null;
  baseUrl?: string | null;
}) {
  const provider = (binding.provider ?? '').trim().toLowerCase();
  const providerLabel = (binding.providerLabel ?? '').trim().toLowerCase();
  const baseUrl = (binding.baseUrl ?? '').trim().toLowerCase();

  const exact = supplierCatalog.find(
    (supplier) =>
      supplier.provider === provider &&
      (supplier.baseUrl?.toLowerCase() ?? '') === baseUrl &&
      baseUrl.length > 0,
  );
  if (exact) {
    return exact.id;
  }

  const byProviderLabel = supplierCatalog.find(
    (supplier) => supplier.provider === provider && supplier.providerLabel.toLowerCase() === providerLabel,
  );
  if (byProviderLabel) {
    return byProviderLabel.id;
  }

  if (provider === 'mock') {
    return 'mock';
  }
  if (provider === 'minimax') {
    return 'minimax';
  }
  if (provider === 'anthropic' && !baseUrl) {
    return 'anthropic';
  }
  if (provider === 'openai' && !baseUrl) {
    return 'openai';
  }
  if (provider === 'openai_compatible') {
    return 'custom-compatible';
  }
  return null;
}

export function toDiscoveredModelOptions(options: SupplierModelOption[]): DiscoveredModelOption[] {
  return options.map((item) => ({
    id: item.id,
    label: item.label ?? item.id,
    source: 'preset',
  }));
}

export function mergeModelOptions(
  preset: SupplierModelOption[],
  live: Array<{ id: string; label?: string; ownedBy?: string | null }>,
) {
  const seen = new Set<string>();
  const merged: DiscoveredModelOption[] = [];

  toDiscoveredModelOptions(preset).forEach((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  });

  live.forEach((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push({
        id: item.id,
        label: item.label ?? item.id,
        ownedBy: item.ownedBy ?? null,
        source: 'live',
      });
    }
  });

  return merged;
}
