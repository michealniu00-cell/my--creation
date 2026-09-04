import {
  createLlmProvider,
  evaluateBindingHealth,
  listProviderModels,
  normalizeProviderName,
  providerScopeForAgent,
} from '@video-agent-studio/providers';
import type { ProviderBindingConfig } from '@video-agent-studio/providers';
import type {
  AgentName,
  ProviderConnectivityResult,
  ProviderConnectivityStatus,
  ProviderScope,
} from '@video-agent-studio/shared';
import {
  resolveBackendProviderApiKey,
  resolveBackendProviderBaseUrl,
} from '@video-agent-studio/shared';

const MINIMAX_MEDIA_PROBE_MODEL = 'MiniMax-M2.7-highspeed';

function resolvedBaseUrl(binding: ProviderBindingConfig) {
  const scope = binding.extraConfig?.providerScope;
  if (scope === 'llm' || scope === 'image' || scope === 'video') {
    return resolveBackendProviderBaseUrl(scope, binding.provider);
  }
  return null;
}

function resolvedApiKey(binding: ProviderBindingConfig) {
  const scope = binding.extraConfig?.providerScope;
  if (scope === 'llm' || scope === 'image' || scope === 'video') {
    return resolveBackendProviderApiKey(scope, binding.provider);
  }
  return null;
}

function clipText(value: string, maxLength = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function createResult(params: {
  binding: ProviderBindingConfig;
  scope: ProviderScope;
  probeMode: ProviderConnectivityResult['probeMode'];
  status: ProviderConnectivityStatus;
  summary: string;
  details: string[];
  latencyMs: number;
}): ProviderConnectivityResult {
  return {
    checkedAt: new Date().toISOString(),
    provider: normalizeProviderName(params.binding.provider),
    providerLabel: params.binding.providerLabel ?? null,
    modelName: params.binding.modelName,
    scope: params.scope,
    authSource: params.binding.credentialSource ?? 'none',
    baseUrl: resolvedBaseUrl(params.binding),
    probeMode: params.probeMode,
    status: params.status,
    success: params.status !== 'failed',
    summary: params.summary,
    details: params.details,
    latencyMs: params.latencyMs,
  };
}

async function runLiveLlmProbe(
  binding: ProviderBindingConfig,
  scope: ProviderScope,
): Promise<ProviderConnectivityResult> {
  const startedAt = Date.now();
  const provider = createLlmProvider(binding);
  const output = await provider.generate({
    prompt: 'ping',
    instructions: 'Reply with OK only.',
    temperature: 0,
    maxOutputTokens: 8,
  });

  return createResult({
    binding,
    scope,
    probeMode: 'live_llm_generate',
    status: 'success',
    summary: '已通过一次真实文本调用验证当前 API Key、Base URL 和模型配置。',
    details: [
      `供应商返回成功，模型实际响应：${clipText(output.text || '空响应')}`,
      `本次探测为低成本调用，tokens：${output.usage.totalTokens}`,
    ],
    latencyMs: Date.now() - startedAt,
  });
}

async function runModelsListProbe(
  binding: ProviderBindingConfig,
  scope: ProviderScope,
): Promise<ProviderConnectivityResult> {
  const apiKey = resolvedApiKey(binding);
  const baseUrl = resolvedBaseUrl(binding);

  if (!apiKey || !baseUrl) {
    throw new Error(
      'Provider connectivity probe requires both API Key and Base URL.',
    );
  }

  const startedAt = Date.now();
  const models = await listProviderModels({
    provider: binding.provider,
    baseUrl,
    apiKey,
    timeoutMs: Math.max(1_000, (binding.timeoutSec ?? 15) * 1_000),
  });
  const modelIds = models.map((item) => item.id);
  const modelVisible = modelIds.includes(binding.modelName.trim());
  const status: ProviderConnectivityStatus = modelVisible
    ? 'success'
    : 'warning';

  return createResult({
    binding,
    scope,
    probeMode: 'models_list',
    status,
    summary: modelVisible
      ? '已验证供应商 API 可访问，所选模型也出现在供应商返回的 models 列表中。'
      : '已验证供应商 API 可访问，但所选模型没有出现在供应商返回的 models 列表中。',
    details: [
      `models 接口返回 ${modelIds.length} 个模型`,
      modelVisible
        ? `已确认模型 ${binding.modelName} 可见`
        : `当前未确认模型 ${binding.modelName} 的可见性，请再核对模型名或供应商权限`,
      scope === 'image' || scope === 'video'
        ? '本次仅做轻量鉴权与模型可见性检查，没有触发真实媒体生成。'
        : '本次检查没有启动完整工作流。',
    ],
    latencyMs: Date.now() - startedAt,
  });
}

async function runMiniMaxCredentialProbe(
  binding: ProviderBindingConfig,
  scope: ProviderScope,
): Promise<ProviderConnectivityResult> {
  const probeBinding: ProviderBindingConfig = {
    ...binding,
    modelName:
      typeof binding.extraConfig?.connectivityProbeModel === 'string' &&
      binding.extraConfig.connectivityProbeModel.trim()
        ? binding.extraConfig.connectivityProbeModel.trim()
        : MINIMAX_MEDIA_PROBE_MODEL,
  };

  const startedAt = Date.now();
  const provider = createLlmProvider({
    ...probeBinding,
    provider: 'minimax',
  });
  const output = await provider.generate({
    prompt: 'ping',
    instructions: 'Reply with OK only.',
    temperature: 0,
    maxOutputTokens: 8,
  });

  return createResult({
    binding,
    scope,
    probeMode: 'credential_probe',
    status: 'warning',
    summary:
      '已验证 MiniMax 的 API Key 与 Base URL 可用，但为了避免直接触发媒体生成计费，本次未执行真实出图或出视频。',
    details: [
      `鉴权探针使用了低成本文本模型 ${probeBinding.modelName}`,
      `探针响应：${clipText(output.text || '空响应')}`,
      `当前媒体模型将继续使用 ${binding.modelName}，建议首次正式生成时留意供应商是否对该模型单独限权。`,
    ],
    latencyMs: Date.now() - startedAt,
  });
}

export async function testProviderConnectivity(
  agentName: AgentName,
  binding: ProviderBindingConfig,
): Promise<ProviderConnectivityResult> {
  const scope = providerScopeForAgent(agentName);
  const resolvedApiKeyForScope = resolveBackendProviderApiKey(
    scope,
    binding.provider,
  );
  const scopedBinding: ProviderBindingConfig = {
    ...binding,
    apiKey: resolvedApiKeyForScope,
    baseUrl: resolveBackendProviderBaseUrl(scope, binding.provider),
    hasApiKey: Boolean(resolvedApiKeyForScope),
    credentialSource: resolvedApiKeyForScope ? 'env' : 'none',
    extraConfig: {
      ...binding.extraConfig,
      providerScope: scope,
    },
  };
  const health = evaluateBindingHealth(agentName, scopedBinding);

  if (health.state !== 'ready') {
    return createResult({
      binding: scopedBinding,
      scope,
      probeMode: scope === 'llm' ? 'live_llm_generate' : 'credential_probe',
      status: 'failed',
      summary: health.summary,
      details:
        health.issues.length > 0
          ? health.issues
          : ['当前配置尚未达到可执行状态。'],
      latencyMs: 0,
    });
  }

  const provider = normalizeProviderName(binding.provider);

  if (scope === 'llm') {
    return runLiveLlmProbe(scopedBinding, scope);
  }

  if (provider === 'minimax') {
    return runMiniMaxCredentialProbe(scopedBinding, scope);
  }

  return runModelsListProbe(scopedBinding, scope);
}
