import type { AgentName } from '../enums/agent';
import type { TaskStatus } from '../enums/status';
import type { AuditedRecord } from './project';

export interface AgentProfileRecord extends AuditedRecord {
  projectId: string;
  agentName: AgentName;
  versionNo: number;
  roleDefinition: string;
  systemPrompt?: string | null;
  developerPrompt?: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  allowedTools: string[];
  contextScope: Record<string, unknown>;
  writeScope: Record<string, unknown>;
  deleteScope: Record<string, unknown>;
  reviewRules: string[];
  isActive: boolean;
  note?: string | null;
}

export interface AgentModelBindingRecord extends AuditedRecord {
  projectId: string;
  agentName: AgentName;
  provider: string;
  modelName: string;
  temperature?: number | null;
  maxTokens?: number | null;
  timeoutSec?: number | null;
  retryLimit?: number | null;
  extraConfig: Record<string, unknown>;
  isActive: boolean;
  providerLabel?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  hasApiKey?: boolean;
  credentialSource?: 'page' | 'env' | 'none';
}

export interface ProviderCredentialRecord extends AuditedRecord {
  projectId: string;
  bindingId: string;
  providerLabel?: string | null;
  baseUrl?: string | null;
  apiKeyCiphertext?: string | null;
  apiKeyHint?: string | null;
  isActive: boolean;
  note?: string | null;
}

export interface ProviderCredentialMeta {
  bindingId: string;
  providerLabel?: string | null;
  baseUrl?: string | null;
  hasApiKey: boolean;
  apiKeyHint?: string | null;
  updatedAt?: string | null;
}

export type ProviderScope = 'llm' | 'image' | 'video';

export type ProviderHealthState = 'ready' | 'mock' | 'misconfigured' | 'unsupported';

export interface ProviderBindingHealth {
  bindingId?: string | null;
  agentName: AgentName;
  provider: string;
  providerLabel?: string | null;
  modelName: string;
  scope: ProviderScope;
  state: ProviderHealthState;
  supported: boolean;
  envReady: boolean;
  canExecute: boolean;
  missingEnvVars: string[];
  issues: string[];
  summary: string;
  checkedAt: string;
  authSource?: 'page' | 'env' | 'none';
  baseUrl?: string | null;
  lastTaskId?: string | null;
  lastRunId?: string | null;
  lastTaskStatus?: TaskStatus | null;
  lastExecutedAt?: string | null;
  lastErrorMessage?: string | null;
  lastErrorAt?: string | null;
}

export interface ProviderHealthSummary {
  checkedAt: string;
  total: number;
  readyCount: number;
  mockCount: number;
  warningCount: number;
  items: ProviderBindingHealth[];
}

export type ProviderConnectivityProbeMode = 'live_llm_generate' | 'models_list' | 'credential_probe';

export type ProviderConnectivityStatus = 'success' | 'warning' | 'failed';

export interface ProviderConnectivityResult {
  checkedAt: string;
  provider: string;
  providerLabel?: string | null;
  modelName: string;
  scope: ProviderScope;
  authSource?: 'page' | 'env' | 'none';
  baseUrl?: string | null;
  probeMode: ProviderConnectivityProbeMode;
  status: ProviderConnectivityStatus;
  success: boolean;
  summary: string;
  details: string[];
  latencyMs: number;
}

export interface AgentPermissionRecord extends AuditedRecord {
  projectId: string;
  agentName: AgentName;
  resourceType: string;
  resourceScope: 'own_output' | 'upstream_only' | 'specific' | 'all';
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  fieldLevelRules: Record<string, unknown>;
  note?: string | null;
}
