import type {
  AgentName,
  ProviderBindingHealth,
  ProviderHealthState,
  ProviderScope,
} from '@video-agent-studio/shared';
import {
  normalizeProviderName as normalizeProviderNameFromShared,
  providerScopeForAgentName,
  requiredBackendEnvVarsForProvider,
  resolveBackendProviderApiKey,
  resolveBackendProviderBaseUrl,
} from '@video-agent-studio/shared';
import type { ProviderBindingConfig } from './types';

const supportedProvidersByScope: Record<ProviderScope, string[]> = {
  llm: ['mock', 'openai', 'openai_compatible', 'anthropic', 'minimax'],
  image: ['mock', 'openai', 'minimax'],
  video: ['mock', 'openai', 'minimax'],
};

export function normalizeProviderName(provider?: string | null) {
  return normalizeProviderNameFromShared(provider);
}

export function providerScopeForAgent(agentName: AgentName): ProviderScope {
  return providerScopeForAgentName(agentName);
}

export function requiredEnvVarsForProvider(provider?: string | null) {
  return requiredBackendEnvVarsForProvider('llm', provider);
}

export function supportedProvidersForAgent(agentName: AgentName) {
  return supportedProvidersByScope[providerScopeForAgent(agentName)];
}

function createSummary(state: ProviderHealthState, provider: string, scope: ProviderScope, issues: string[]) {
  if (state === 'mock') {
    return `当前使用 mock ${scope} provider，可演示流程但不会调用真实模型。`;
  }

  if (state === 'ready') {
    return `${provider} ${scope} provider 配置完整，可以执行真实生成。`;
  }

  if (issues.length > 0) {
    return issues.join('；');
  }

  return `${provider} ${scope} provider 当前不可执行。`;
}

export function evaluateBindingHealth(
  agentName: AgentName,
  binding?: ProviderBindingConfig | null,
): Omit<
  ProviderBindingHealth,
  | 'bindingId'
  | 'checkedAt'
  | 'lastTaskId'
  | 'lastRunId'
  | 'lastTaskStatus'
  | 'lastExecutedAt'
  | 'lastErrorMessage'
  | 'lastErrorAt'
> {
  const scope = providerScopeForAgent(agentName);
  const provider = normalizeProviderName(binding?.provider);
  const providerLabel = binding?.providerLabel ?? null;
  const modelName = binding?.modelName ?? '';
  const supported = supportedProvidersForAgent(agentName).includes(provider);
  const envCredentialReady = Boolean(resolveBackendProviderApiKey(scope, provider));
  const authSource = envCredentialReady ? 'env' : 'none';
  const requiresBaseUrl = provider === 'openai_compatible';
  const baseUrl = resolveBackendProviderBaseUrl(scope, provider);
  const missingEnvVars = envCredentialReady
    ? []
    : requiredBackendEnvVarsForProvider(scope, provider).filter((name) => !process.env[name]);
  const issues: string[] = [];
  let state: ProviderHealthState = 'ready';

  if (!supported) {
    state = 'unsupported';
    issues.push(`${scope} provider 暂不支持 ${provider}`);
  } else if (provider === 'mock') {
    state = 'mock';
  } else if (!modelName.trim()) {
    state = 'misconfigured';
    issues.push('模型名称未配置');
  } else if (requiresBaseUrl && !baseUrl?.trim()) {
    state = 'misconfigured';
    issues.push('兼容供应商必须在后端环境变量中配置 Base URL');
  } else if (!envCredentialReady && missingEnvVars.length > 0) {
    state = 'misconfigured';
    issues.push(`缺少环境变量：${missingEnvVars.join(', ')}`);
  } else if (!envCredentialReady) {
    state = 'misconfigured';
    issues.push('尚未在后端环境变量中配置 API Key');
  }

  return {
    agentName,
    provider,
    providerLabel,
    modelName,
    scope,
    state,
    supported,
    envReady: missingEnvVars.length === 0,
    canExecute: supported && state !== 'misconfigured' && state !== 'unsupported',
    missingEnvVars,
    issues,
    summary: createSummary(state, provider, scope, issues),
    authSource,
    baseUrl,
  };
}
