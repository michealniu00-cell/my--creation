'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  AgentName,
  AgentModelBindingRecord,
  AgentProfileRecord,
  ProviderScope,
  ProviderConnectivityResult,
  ProjectStageSnapshotRecord,
  ProviderBindingHealth,
  ProviderHealthState,
  ProviderHealthSummary,
} from '@video-agent-studio/shared';
import { backendProviderEnvVarsByScope } from '@video-agent-studio/shared';
import {
  PROVIDER_CATALOG_UPDATED_AT,
  getSupplierById,
  getSuppliersForScope,
  inferSupplierId,
  mergeModelOptions,
  scopeForAgent,
} from '@/lib/provider-catalog';

function formatJson(value: Record<string, unknown>) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseStringList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(label: string, value: string) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} 必须是合法 JSON 对象`);
  }
}

function createProfileForm(profile?: AgentProfileRecord | null) {
  return {
    profileId: profile?.id ?? '',
    roleDefinition: profile?.roleDefinition ?? '',
    systemPrompt: profile?.systemPrompt ?? '',
    developerPrompt: profile?.developerPrompt ?? '',
    allowedTools: (profile?.allowedTools ?? []).join('\n'),
    reviewRules: (profile?.reviewRules ?? []).join('\n'),
    note: profile?.note ?? '',
    inputSchema: formatJson(profile?.inputSchema ?? {}),
    outputSchema: formatJson(profile?.outputSchema ?? {}),
    contextScope: formatJson(profile?.contextScope ?? {}),
    writeScope: formatJson(profile?.writeScope ?? {}),
    deleteScope: formatJson(profile?.deleteScope ?? {}),
  };
}

function createBindingForm(binding?: AgentModelBindingRecord | null) {
  return {
    bindingId: binding?.id ?? '',
    supplierId: inferSupplierId({
      provider: binding?.provider ?? '',
      providerLabel: binding?.providerLabel ?? '',
      baseUrl: '',
    }),
    provider: binding?.provider ?? '',
    providerLabel: binding?.providerLabel ?? '',
    modelName: binding?.modelName ?? '',
    temperature: binding?.temperature?.toString() ?? '',
    maxTokens: binding?.maxTokens?.toString() ?? '',
    timeoutSec: binding?.timeoutSec?.toString() ?? '',
    retryLimit: binding?.retryLimit?.toString() ?? '',
    extraConfig: formatJson(binding?.extraConfig ?? {}),
  };
}

function healthPillTone(state: ProviderHealthState) {
  switch (state) {
    case 'ready':
      return 'active';
    case 'mock':
      return 'placeholder';
    case 'misconfigured':
    case 'unsupported':
      return 'failed';
    default:
      return 'paused';
  }
}

function healthLabel(state: ProviderHealthState) {
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'mock':
      return 'Mock';
    case 'misconfigured':
      return 'Action Required';
    case 'unsupported':
      return 'Unsupported';
    default:
      return 'Unknown';
  }
}

function authSourceLabel(source?: 'page' | 'env' | 'none' | null) {
  switch (source) {
    case 'env':
      return '后端环境变量';
    case 'page':
      return '历史页面密钥（已停用）';
    default:
      return '未配置';
  }
}

function backendConfigCopy(scope: ProviderScope, provider: string) {
  const envVars = backendProviderEnvVarsByScope[scope];
  const normalizedProvider = provider.trim().toLowerCase();
  const fallback =
    normalizedProvider === 'openai'
      ? { apiKeyVar: 'OPENAI_API_KEY', baseUrlVar: 'OPENAI_BASE_URL' }
      : normalizedProvider === 'minimax'
        ? { apiKeyVar: 'MINIMAX_API_KEY', baseUrlVar: 'MINIMAX_BASE_URL' }
        : normalizedProvider === 'anthropic'
          ? { apiKeyVar: 'ANTHROPIC_API_KEY', baseUrlVar: 'ANTHROPIC_BASE_URL' }
          : null;

  return {
    apiKeyVar: envVars.apiKey,
    baseUrlVar: envVars.baseUrl,
    apiKeyFallbackVar: fallback?.apiKeyVar ?? null,
    baseUrlFallbackVar: fallback?.baseUrlVar ?? null,
    baseUrlRequired: normalizedProvider === 'openai_compatible',
  };
}

function formatNullable(value?: string | null) {
  return value && value.trim() ? value : '未记录';
}

function connectivityPillTone(status: ProviderConnectivityResult['status']) {
  switch (status) {
    case 'success':
      return 'active';
    case 'warning':
      return 'paused';
    default:
      return 'failed';
  }
}

function connectivityLabel(status: ProviderConnectivityResult['status']) {
  switch (status) {
    case 'success':
      return 'Connected';
    case 'warning':
      return 'Connected with Notes';
    default:
      return 'Failed';
  }
}

function connectivityProbeLabel(mode: ProviderConnectivityResult['probeMode']) {
  switch (mode) {
    case 'live_llm_generate':
      return '真实文本调用';
    case 'models_list':
      return 'models 接口探测';
    default:
      return '轻量鉴权探针';
  }
}

function renderBindingHealthDetails(health: ProviderBindingHealth | null) {
  if (!health) {
    return (
      <div className="health-card">
        <div className="subtle">
          当前模型绑定还没有可用的 provider health 数据。
        </div>
      </div>
    );
  }

  return (
    <div className="health-card">
      <div className="toolbar">
        <div>
          <strong>Provider Runtime</strong>
          <div className="subtle">
            {health.providerLabel ?? health.provider} /{' '}
            {health.modelName || '未填写模型'}
          </div>
        </div>
        <span className={`pill ${healthPillTone(health.state)}`}>
          {healthLabel(health.state)}
        </span>
      </div>
      <div className="health-check-list">
        <div className="health-check">
          <span className="subtle">执行范围</span>
          <strong>{health.scope}</strong>
        </div>
        <div className="health-check">
          <span className="subtle">可执行</span>
          <strong>{health.canExecute ? '是' : '否'}</strong>
        </div>
        <div className="health-check">
          <span className="subtle">认证来源</span>
          <strong>{authSourceLabel(health.authSource)}</strong>
        </div>
        <div className="health-check">
          <span className="subtle">最近任务</span>
          <strong>{formatNullable(health.lastTaskStatus)}</strong>
        </div>
      </div>
      <p className="subtle">{health.summary}</p>
      {health.baseUrl ? (
        <div className="health-note">
          <strong>API 地址</strong>
          <div className="subtle">{health.baseUrl}</div>
        </div>
      ) : null}
      {health.missingEnvVars.length > 0 ? (
        <div className="health-note">
          <strong>缺失环境变量</strong>
          <div className="subtle">{health.missingEnvVars.join(', ')}</div>
        </div>
      ) : null}
      {health.issues.length > 0 ? (
        <div className="health-note">
          <strong>配置提示</strong>
          <div className="subtle">{health.issues.join('；')}</div>
        </div>
      ) : null}
      {health.lastErrorMessage ? (
        <div className="health-note error-note">
          <strong>最近错误</strong>
          <div className="subtle">{health.lastErrorMessage}</div>
          <div className="subtle">
            记录时间：{formatNullable(health.lastErrorAt)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const bindingConfigGroups: Array<{
  key: 'agent1_7' | 'agent8' | 'agent9';
  label: string;
  description: string;
  agentNames: AgentName[];
}> = [
  {
    key: 'agent1_7',
    label: 'Agent1-7 文本模型',
    description: '脚本、调研、规划与审核链路共用同一套文本模型配置。',
    agentNames: [
      'agent1',
      'agent2',
      'agent3',
      'agent4',
      'agent5',
      'agent6',
      'agent7',
    ],
  },
  {
    key: 'agent8',
    label: 'Agent8 文生图模型',
    description: '关键分镜图与关键要素图生成必须使用文生图模型。',
    agentNames: ['agent8'],
  },
  {
    key: 'agent9',
    label: 'Agent9 视频生成模型',
    description: '视频片段生成必须使用视频生成模型。',
    agentNames: ['agent9'],
  },
];

type BindingConfigGroupView = {
  key: (typeof bindingConfigGroups)[number]['key'];
  label: string;
  description: string;
  agentNames: AgentName[];
  binding: AgentModelBindingRecord | null;
  health: ProviderBindingHealth | null;
};

function buildBindingConfigGroups(
  bindings: AgentModelBindingRecord[],
  providerHealthItems: ProviderBindingHealth[],
): BindingConfigGroupView[] {
  return bindingConfigGroups.map((group) => {
    const binding =
      bindings.find(
        (item) =>
          group.agentNames.includes(item.agentName) &&
          item.agentName === group.agentNames[0],
      ) ??
      bindings.find((item) => group.agentNames.includes(item.agentName)) ??
      null;
    const health =
      (binding
        ? (providerHealthItems.find((item) => item.bindingId === binding.id) ??
          null)
        : null) ??
      providerHealthItems.find(
        (item) => item.agentName === group.agentNames[0],
      ) ??
      null;

    return {
      key: group.key,
      label: group.label,
      description: group.description,
      agentNames: group.agentNames,
      binding,
      health,
    };
  });
}

function protocolLabel(provider: string) {
  switch (provider) {
    case 'mock':
      return 'mock';
    case 'openai':
      return 'openai';
    case 'openai_compatible':
      return 'openai_compatible';
    case 'anthropic':
      return 'anthropic';
    case 'minimax':
      return 'minimax';
    default:
      return provider;
  }
}

export function SettingsWorkbench({
  projectId,
  profiles,
  bindings,
  snapshots,
  providerHealth: initialProviderHealth,
}: {
  projectId: string;
  profiles: AgentProfileRecord[];
  bindings: AgentModelBindingRecord[];
  snapshots: ProjectStageSnapshotRecord[];
  providerHealth: ProviderHealthSummary;
}) {
  const router = useRouter();
  const initialBindingGroups = buildBindingConfigGroups(
    bindings,
    initialProviderHealth.items,
  );
  const initialSelectedBinding =
    initialBindingGroups[0]?.binding ?? bindings[0] ?? null;
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    profiles[0]?.id ?? null,
  );
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(
    initialSelectedBinding?.id ?? null,
  );
  const [profileForm, setProfileForm] = useState(() =>
    createProfileForm(profiles[0]),
  );
  const [bindingForm, setBindingForm] = useState(() =>
    createBindingForm(initialSelectedBinding),
  );
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [bindingStatus, setBindingStatus] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [providerHealth, setProviderHealth] = useState(initialProviderHealth);
  const [loading, setLoading] = useState<'profile' | 'binding' | null>(null);
  const [refreshingHealth, setRefreshingHealth] = useState(false);
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState<string | null>(null);
  const [testingConnectivity, setTestingConnectivity] = useState(false);
  const [connectivityStatus, setConnectivityStatus] = useState<string | null>(
    null,
  );
  const [connectivityResult, setConnectivityResult] =
    useState<ProviderConnectivityResult | null>(null);
  const [liveModelsByBinding, setLiveModelsByBinding] = useState<
    Record<
      string,
      Array<{ id: string; label?: string; ownedBy?: string | null }>
    >
  >({});

  const groupedBindings = useMemo(
    () => buildBindingConfigGroups(bindings, providerHealth.items),
    [bindings, providerHealth.items],
  );
  const selectedProfile =
    profiles.find((item) => item.id === selectedProfileId) ?? null;
  const selectedBindingGroup =
    groupedBindings.find((group) => group.binding?.id === selectedBindingId) ??
    groupedBindings[0] ??
    null;
  const selectedBinding = selectedBindingGroup?.binding ?? null;
  const selectedBindingHealth = selectedBindingGroup?.health ?? null;
  const selectedScope = scopeForAgent(selectedBindingGroup?.agentNames[0]);
  const availableSuppliers = useMemo(
    () =>
      getSuppliersForScope(selectedScope).filter(
        (supplier) => supplier.provider !== 'mock',
      ),
    [selectedScope],
  );
  const availableProtocols = useMemo(
    () =>
      Array.from(
        new Set(availableSuppliers.map((supplier) => supplier.provider)),
      ),
    [availableSuppliers],
  );
  const selectedSupplier = getSupplierById(bindingForm.supplierId);
  const presetModelOptions = useMemo(
    () => selectedSupplier?.modelsByScope[selectedScope] ?? [],
    [selectedSupplier, selectedScope],
  );
  const liveModelOptions = useMemo(
    () =>
      bindingForm.bindingId
        ? (liveModelsByBinding[bindingForm.bindingId] ?? [])
        : [],
    [bindingForm.bindingId, liveModelsByBinding],
  );
  const mergedModelOptions = useMemo(
    () => mergeModelOptions(presetModelOptions, liveModelOptions),
    [presetModelOptions, liveModelOptions],
  );
  const featuredModelOptions = mergedModelOptions.slice(0, 10);
  const liveModelCount = liveModelOptions.length;

  useEffect(() => {
    setProfileForm(createProfileForm(selectedProfile));
  }, [selectedProfile]);

  useEffect(() => {
    setBindingForm(createBindingForm(selectedBinding));
  }, [selectedBinding]);

  useEffect(() => {
    setProviderHealth(initialProviderHealth);
  }, [initialProviderHealth]);

  useEffect(() => {
    setDiscoverStatus(null);
  }, [selectedBindingId]);

  useEffect(() => {
    setConnectivityStatus(null);
    setConnectivityResult(null);
  }, [
    selectedBindingId,
    bindingForm.provider,
    bindingForm.providerLabel,
    bindingForm.modelName,
  ]);

  useEffect(() => {
    if (
      selectedBindingId &&
      groupedBindings.some((group) => group.binding?.id === selectedBindingId)
    ) {
      return;
    }
    const fallbackBindingId = groupedBindings[0]?.binding?.id ?? null;
    if (fallbackBindingId !== selectedBindingId) {
      setSelectedBindingId(fallbackBindingId);
    }
  }, [groupedBindings, selectedBindingId]);

  async function refreshProviderHealth(quiet = false) {
    setRefreshingHealth(true);
    if (!quiet) {
      setHealthStatus(null);
    }

    try {
      const response = await fetch(
        `/api/projects/${projectId}/provider-health`,
        {
          method: 'GET',
        },
      );
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
        data?: ProviderHealthSummary;
      };

      if (!response.ok || !payload.success || !payload.data) {
        if (!quiet) {
          setHealthStatus(
            payload.error?.message ?? '刷新 provider health 失败。',
          );
        }
        return;
      }

      setProviderHealth(payload.data);
      if (!quiet) {
        setHealthStatus('Provider health 已刷新。');
      }
    } catch (error) {
      if (!quiet) {
        setHealthStatus(
          error instanceof Error
            ? error.message
            : '刷新 provider health 失败。',
        );
      }
    } finally {
      setRefreshingHealth(false);
    }
  }

  function applySupplierPreset(supplierId: string) {
    const supplier = getSupplierById(supplierId);
    setDiscoverStatus(null);
    setBindingForm((current) => {
      if (!supplier) {
        return {
          ...current,
          supplierId,
        };
      }

      const suggestedModels = supplier.modelsByScope[selectedScope] ?? [];
      const suggestedModelId = suggestedModels[0]?.id ?? current.modelName;
      return {
        ...current,
        supplierId,
        provider: supplier.provider,
        providerLabel: supplier.providerLabel,
        modelName:
          current.modelName && current.supplierId === supplierId
            ? current.modelName
            : suggestedModelId,
      };
    });
  }

  async function discoverModels() {
    if (!selectedBinding) {
      return;
    }

    if (bindingForm.provider === 'mock') {
      setDiscoverStatus('Mock 模式没有 live model 列表。');
      return;
    }

    setDiscoveringModels(true);
    setDiscoverStatus(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/model-bindings/discover-models`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bindingId: selectedBinding.id,
            provider: bindingForm.provider,
          }),
        },
      );
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
        data?: {
          items?: Array<{
            id: string;
            label?: string;
            ownedBy?: string | null;
          }>;
          count?: number;
        };
      };

      if (!response.ok || !payload.success || !payload.data?.items) {
        setDiscoverStatus(payload.error?.message ?? '获取供应商模型列表失败。');
        return;
      }

      setLiveModelsByBinding((current) => ({
        ...current,
        [selectedBinding.id]: payload.data?.items ?? [],
      }));
      setDiscoverStatus(
        `已同步 ${payload.data.count ?? payload.data.items.length} 个 live models。`,
      );
    } catch (error) {
      setDiscoverStatus(
        error instanceof Error ? error.message : '获取供应商模型列表失败。',
      );
    } finally {
      setDiscoveringModels(false);
    }
  }

  async function saveProfile() {
    if (!selectedProfile) {
      return;
    }

    setLoading('profile');
    setProfileStatus(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/agent-profiles`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileId: selectedProfile.id,
            roleDefinition: profileForm.roleDefinition,
            systemPrompt: profileForm.systemPrompt || null,
            developerPrompt: profileForm.developerPrompt || null,
            allowedTools: parseStringList(profileForm.allowedTools),
            reviewRules: parseStringList(profileForm.reviewRules),
            note: profileForm.note || null,
            inputSchema: parseJsonObject(
              '输入 Schema',
              profileForm.inputSchema,
            ),
            outputSchema: parseJsonObject(
              '输出 Schema',
              profileForm.outputSchema,
            ),
            contextScope: parseJsonObject(
              '上下文范围',
              profileForm.contextScope,
            ),
            writeScope: parseJsonObject('写入范围', profileForm.writeScope),
            deleteScope: parseJsonObject('删除范围', profileForm.deleteScope),
          }),
        },
      );
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || !payload.success) {
        setProfileStatus(payload.error?.message ?? '保存 Agent Profile 失败。');
        return;
      }

      setProfileStatus('Agent Profile 已更新。');
      startTransition(() => router.refresh());
    } catch (error) {
      setProfileStatus(
        error instanceof Error ? error.message : '保存 Agent Profile 失败。',
      );
    } finally {
      setLoading(null);
    }
  }

  async function saveBinding() {
    if (!selectedBinding) {
      return;
    }

    setLoading('binding');
    setBindingStatus(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/model-bindings`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bindingId: selectedBinding.id,
            provider: bindingForm.provider,
            providerLabel: bindingForm.providerLabel || null,
            modelName: bindingForm.modelName,
            temperature: bindingForm.temperature
              ? Number(bindingForm.temperature)
              : null,
            maxTokens: bindingForm.maxTokens
              ? Number(bindingForm.maxTokens)
              : null,
            timeoutSec: bindingForm.timeoutSec
              ? Number(bindingForm.timeoutSec)
              : null,
            retryLimit: bindingForm.retryLimit
              ? Number(bindingForm.retryLimit)
              : null,
            extraConfig: parseJsonObject('额外配置', bindingForm.extraConfig),
          }),
        },
      );
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
        data?: { affectedAgentNames?: string[] };
      };

      if (!response.ok || !payload.success) {
        setBindingStatus(payload.error?.message ?? '保存模型绑定失败。');
        return;
      }

      await refreshProviderHealth(true);
      setBindingStatus(
        payload.data?.affectedAgentNames?.length
          ? `模型绑定已更新，并同步到 ${payload.data.affectedAgentNames.join(', ')}。`
          : `模型绑定已更新${selectedBindingGroup ? `，已应用到 ${selectedBindingGroup.label}` : ''}。`,
      );
      startTransition(() => router.refresh());
    } catch (error) {
      setBindingStatus(
        error instanceof Error ? error.message : '保存模型绑定失败。',
      );
    } finally {
      setLoading(null);
    }
  }

  async function testBindingConnectivity() {
    if (!selectedBinding) {
      return;
    }

    setTestingConnectivity(true);
    setConnectivityStatus(null);
    setConnectivityResult(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/provider-health`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bindingId: selectedBinding.id,
            provider: bindingForm.provider,
            providerLabel: bindingForm.providerLabel || null,
            modelName: bindingForm.modelName,
            temperature: bindingForm.temperature
              ? Number(bindingForm.temperature)
              : null,
            maxTokens: bindingForm.maxTokens
              ? Number(bindingForm.maxTokens)
              : null,
            timeoutSec: bindingForm.timeoutSec
              ? Number(bindingForm.timeoutSec)
              : null,
            retryLimit: bindingForm.retryLimit
              ? Number(bindingForm.retryLimit)
              : null,
            extraConfig: parseJsonObject('额外配置', bindingForm.extraConfig),
          }),
        },
      );
      const payload = (await response.json()) as {
        success?: boolean;
        error?: {
          message?: string;
          details?: { result?: ProviderConnectivityResult };
        };
        data?: ProviderConnectivityResult;
      };

      if (!response.ok || !payload.success || !payload.data) {
        const failedResult = payload.error?.details?.result ?? null;
        if (failedResult) {
          setConnectivityResult(failedResult);
        }
        setConnectivityStatus(payload.error?.message ?? 'API 连通性测试失败。');
        return;
      }

      setConnectivityResult(payload.data);
      setConnectivityStatus(
        payload.data.status === 'warning'
          ? 'API 已连通，但还有额外提示。'
          : 'API 连通性测试通过。',
      );
    } catch (error) {
      setConnectivityStatus(
        error instanceof Error ? error.message : 'API 连通性测试失败。',
      );
    } finally {
      setTestingConnectivity(false);
    }
  }

  return (
    <div className="grid">
      <section className="stats">
        <div className="stat">
          <span className="subtle">Agent Profiles</span>
          <strong>{profiles.length}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Model Bindings</span>
          <strong>
            {groupedBindings.filter((group) => group.binding).length}
          </strong>
        </div>
        <div className="stat">
          <span className="subtle">Ready</span>
          <strong>{providerHealth.readyCount}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Mock</span>
          <strong>{providerHealth.mockCount}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Action Required</span>
          <strong>{providerHealth.warningCount}</strong>
        </div>
        <div className="stat">
          <span className="subtle">活动快照</span>
          <strong>{snapshots.length}</strong>
        </div>
      </section>

      <section className="card">
        <div className="toolbar">
          <div>
            <h2 className="card-title">Provider Readiness</h2>
            <p className="subtle">
              这里展示的是配置可执行性和最近错误，不代表外部 provider
              的实时可用性。
            </p>
          </div>
          <div className="actions">
            <button
              className="button secondary small"
              type="button"
              disabled={refreshingHealth}
              onClick={() => void refreshProviderHealth()}
            >
              {refreshingHealth ? '检查中...' : '重新检查'}
            </button>
          </div>
        </div>
        <div className="event-list">
          {groupedBindings
            .filter(
              (
                group,
              ): group is BindingConfigGroupView & {
                binding: AgentModelBindingRecord;
              } => Boolean(group.binding),
            )
            .map((group) => {
              const item = group.health;
              return (
                <button
                  key={group.binding.id}
                  type="button"
                  className={`list-row selectable-row ${selectedBindingId === group.binding.id ? 'selected' : ''}`}
                  onClick={() => setSelectedBindingId(group.binding.id)}
                >
                  <div className="toolbar">
                    <div>
                      <strong>{group.label}</strong>
                      <div className="subtle">
                        {group.agentNames.join(', ')}
                      </div>
                    </div>
                    <span
                      className={`pill ${healthPillTone(item?.state ?? 'misconfigured')}`}
                    >
                      {healthLabel(item?.state ?? 'misconfigured')}
                    </span>
                  </div>
                  <div className="subtle">
                    {item
                      ? `${item.providerLabel ?? item.provider} / ${item.modelName || '未填写模型'}`
                      : '未配置'}
                  </div>
                  <div className="subtle">
                    {item?.summary ?? group.description}
                  </div>
                  {item?.lastErrorMessage ? (
                    <div className="version-error">
                      最近错误：{item.lastErrorMessage}
                    </div>
                  ) : null}
                </button>
              );
            })}
        </div>
        {healthStatus ? <p className="subtle">{healthStatus}</p> : null}
      </section>

      <section className="settings-workbench">
        <div className="card">
          <div className="toolbar">
            <h2 className="card-title">Agent Profiles</h2>
            <span className="subtle">支持直接编辑当前生效 profile</span>
          </div>
          <div className="settings-list">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`list-row selectable-row ${selectedProfileId === profile.id ? 'selected' : ''}`}
                onClick={() => setSelectedProfileId(profile.id)}
              >
                <div className="toolbar">
                  <strong>{profile.agentName}</strong>
                  <span className="subtle">v{profile.versionNo}</span>
                </div>
                <div className="subtle">{profile.roleDefinition}</div>
              </button>
            ))}
          </div>
          {selectedProfile ? (
            <div className="grid">
              <div className="field">
                <label>角色定义</label>
                <textarea
                  value={profileForm.roleDefinition}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      roleDefinition: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>System Prompt</label>
                <textarea
                  value={profileForm.systemPrompt}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      systemPrompt: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>Developer Prompt</label>
                <textarea
                  value={profileForm.developerPrompt}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      developerPrompt: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid two">
                <div className="field">
                  <label>Allowed Tools</label>
                  <textarea
                    value={profileForm.allowedTools}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        allowedTools: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Review Rules</label>
                  <textarea
                    value={profileForm.reviewRules}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        reviewRules: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid two">
                <div className="field">
                  <label>Input Schema JSON</label>
                  <textarea
                    value={profileForm.inputSchema}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        inputSchema: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Output Schema JSON</label>
                  <textarea
                    value={profileForm.outputSchema}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        outputSchema: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid three">
                <div className="field">
                  <label>Context Scope JSON</label>
                  <textarea
                    value={profileForm.contextScope}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        contextScope: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Write Scope JSON</label>
                  <textarea
                    value={profileForm.writeScope}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        writeScope: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Delete Scope JSON</label>
                  <textarea
                    value={profileForm.deleteScope}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        deleteScope: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="field">
                <label>备注</label>
                <input
                  value={profileForm.note}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="actions">
                <button
                  className="button"
                  type="button"
                  disabled={loading !== null}
                  onClick={saveProfile}
                >
                  {loading === 'profile' ? '保存中...' : '保存 Agent Profile'}
                </button>
              </div>
              {profileStatus ? <p className="subtle">{profileStatus}</p> : null}
            </div>
          ) : (
            <p className="subtle">当前项目还没有 agent profile。</p>
          )}
        </div>

        <div className="card">
          <div className="toolbar">
            <h2 className="card-title">Model Bindings</h2>
            <span className="subtle">
              按文本、文生图、视频三组分别配置供应商、模型和执行参数，API
              凭证仅在后端配置
            </span>
          </div>
          <p className="subtle">
            内置目录更新时间：{PROVIDER_CATALOG_UPDATED_AT}
            。目录提供官方常用模型建议，兼容供应商还可以实时同步 live models。
          </p>
          <div className="settings-list">
            {groupedBindings
              .filter(
                (
                  group,
                ): group is BindingConfigGroupView & {
                  binding: AgentModelBindingRecord;
                } => Boolean(group.binding),
              )
              .map((group) => {
                const binding = group.binding;
                const health = group.health;
                const envConfig = backendConfigCopy(
                  health?.scope ?? scopeForAgent(group.agentNames[0]),
                  binding.provider,
                );

                return (
                  <button
                    key={binding.id}
                    type="button"
                    className={`list-row selectable-row ${selectedBindingId === binding.id ? 'selected' : ''}`}
                    onClick={() => setSelectedBindingId(binding.id)}
                  >
                    <div className="toolbar">
                      <strong>{group.label}</strong>
                      <span
                        className={`pill ${health ? healthPillTone(health.state) : 'paused'}`}
                      >
                        {health ? healthLabel(health.state) : 'Unknown'}
                      </span>
                    </div>
                    <div className="subtle">{group.description}</div>
                    <div className="subtle">
                      {binding.providerLabel || binding.provider} /{' '}
                      {binding.modelName}
                    </div>
                    <div className="subtle">
                      后端 Key: {envConfig.apiKeyVar}
                      {envConfig.apiKeyFallbackVar
                        ? `（或 ${envConfig.apiKeyFallbackVar}）`
                        : ''}
                      {envConfig.baseUrlRequired
                        ? ` · 后端 Base URL: ${envConfig.baseUrlVar}`
                        : ' · Base URL: 可用默认地址'}
                    </div>
                    {health ? (
                      <div className="subtle">{health.summary}</div>
                    ) : null}
                  </button>
                );
              })}
          </div>
          {selectedBinding ? (
            <div className="grid">
              {selectedBindingGroup ? (
                <div className="health-note">
                  <strong>{selectedBindingGroup.label}</strong>
                  <div className="subtle">
                    {selectedBindingGroup.description}
                  </div>
                  <div className="subtle">
                    覆盖范围：{selectedBindingGroup.agentNames.join(', ')}
                  </div>
                </div>
              ) : null}
              {renderBindingHealthDetails(selectedBindingHealth)}
              <div className="health-note">
                <strong>后端 API 配置</strong>
                <div className="subtle">
                  API Key 环境变量：
                  {
                    backendConfigCopy(selectedScope, bindingForm.provider)
                      .apiKeyVar
                  }
                  {backendConfigCopy(selectedScope, bindingForm.provider)
                    .apiKeyFallbackVar
                    ? `（可回退到 ${backendConfigCopy(selectedScope, bindingForm.provider).apiKeyFallbackVar}）`
                    : ''}
                </div>
                <div className="subtle">
                  Base URL 环境变量：
                  {
                    backendConfigCopy(selectedScope, bindingForm.provider)
                      .baseUrlVar
                  }
                  {backendConfigCopy(selectedScope, bindingForm.provider)
                    .baseUrlFallbackVar
                    ? `（可回退到 ${backendConfigCopy(selectedScope, bindingForm.provider).baseUrlFallbackVar}）`
                    : ''}
                  {backendConfigCopy(selectedScope, bindingForm.provider)
                    .baseUrlRequired
                    ? '（当前兼容供应商必填）'
                    : '（OpenAI / Anthropic / MiniMax 可留空，使用默认地址）'}
                </div>
                <div className="subtle">
                  前端页面不再保存、展示或修改 API Key。
                </div>
              </div>
              <div className="grid two">
                <div className="field">
                  <label>供应商模板</label>
                  <select
                    value={bindingForm.supplierId ?? ''}
                    onChange={(event) =>
                      applySupplierPreset(event.target.value)
                    }
                  >
                    {bindingForm.supplierId === 'mock' ? (
                      <option value="mock" disabled>
                        Mock / 已禁用
                      </option>
                    ) : null}
                    <option value="">手动配置</option>
                    {availableSuppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>协议类型</label>
                  <select
                    value={bindingForm.provider}
                    onChange={(event) =>
                      setBindingForm((current) => ({
                        ...current,
                        provider: event.target.value,
                        supplierId:
                          event.target.value === 'mock'
                            ? 'mock'
                            : event.target.value === 'openai'
                              ? 'openai'
                              : event.target.value === 'anthropic'
                                ? 'anthropic'
                                : event.target.value === 'minimax'
                                  ? 'minimax'
                                  : current.supplierId === 'mock' ||
                                      current.supplierId === 'openai' ||
                                      current.supplierId === 'anthropic' ||
                                      current.supplierId === 'minimax'
                                    ? 'custom-compatible'
                                    : current.supplierId,
                      }))
                    }
                  >
                    {bindingForm.provider === 'mock' ? (
                      <option value="mock" disabled>
                        mock (已禁用)
                      </option>
                    ) : null}
                    {availableProtocols.map((provider) => (
                      <option key={provider} value={provider}>
                        {protocolLabel(provider)}
                      </option>
                    ))}
                  </select>
                  <div className="subtle">
                    {selectedScope === 'llm'
                      ? '这里只允许文本模型供应商。当前支持 OpenAI / Anthropic / OpenAI-compatible / MiniMax。'
                      : selectedScope === 'image'
                        ? '这里只允许文生图供应商。'
                        : '这里只允许视频生成供应商。'}
                  </div>
                  {bindingForm.provider === 'mock' ? (
                    <div className="subtle" style={{ color: 'var(--danger)' }}>
                      Mock 已停用，请切换到真实供应商后再运行工作流。
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="grid two">
                <div className="field">
                  <label>供应商名称</label>
                  <input
                    value={bindingForm.providerLabel}
                    onChange={(event) =>
                      setBindingForm((current) => ({
                        ...current,
                        providerLabel: event.target.value,
                      }))
                    }
                    placeholder="例如 OpenAI / OpenRouter / SiliconFlow"
                  />
                </div>
                <div className="field">
                  <label>后端接入说明</label>
                  <div className="health-note">
                    <div className="subtle">
                      切换到兼容供应商后，请同步修改后端环境变量里的 Base URL。
                    </div>
                    <div className="subtle">
                      例如：`
                      {
                        backendConfigCopy(selectedScope, bindingForm.provider)
                          .baseUrlVar
                      }
                      =https://your-provider.example/v1`
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid two">
                <div className="field">
                  <label>Model Name</label>
                  <input
                    list={`binding-model-options-${selectedBinding.id}`}
                    value={bindingForm.modelName}
                    onChange={(event) =>
                      setBindingForm((current) => ({
                        ...current,
                        modelName: event.target.value,
                      }))
                    }
                    placeholder="可直接输入，或从下面目录中选择"
                  />
                  <datalist id={`binding-model-options-${selectedBinding.id}`}>
                    {mergedModelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </datalist>
                  <div className="subtle">
                    {selectedScope === 'llm'
                      ? '请输入或选择文本模型。'
                      : selectedScope === 'image'
                        ? '请输入或选择文生图模型。'
                        : '请输入或选择视频生成模型。'}
                  </div>
                </div>
                <div className="field">
                  <label>模型目录</label>
                  <div className="actions">
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={
                        discoveringModels ||
                        !selectedSupplier?.supportsDiscovery
                      }
                      onClick={() => void discoverModels()}
                    >
                      {discoveringModels ? '同步中...' : '同步供应商全部模型'}
                    </button>
                  </div>
                  <div className="subtle">
                    {selectedSupplier?.supportsDiscovery
                      ? `当前供应商支持 live discovery${liveModelCount > 0 ? `，已载入 ${liveModelCount} 个模型` : ''}`
                      : '当前供应商没有启用 live discovery，请使用内置目录或手动输入模型名。'}
                  </div>
                  {selectedSupplier?.note ? (
                    <div className="subtle">{selectedSupplier.note}</div>
                  ) : null}
                </div>
              </div>
              {featuredModelOptions.length > 0 ? (
                <div className="field">
                  <label>推荐模型快捷选项</label>
                  <div className="actions">
                    {featuredModelOptions.map((model) => (
                      <button
                        key={model.id}
                        className="button secondary small"
                        type="button"
                        onClick={() =>
                          setBindingForm((current) => ({
                            ...current,
                            modelName: model.id,
                          }))
                        }
                      >
                        {model.id}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {discoverStatus ? (
                <p className="subtle">{discoverStatus}</p>
              ) : null}
              {connectivityResult ? (
                <div
                  className={`health-note ${connectivityResult.status === 'failed' ? 'error-note' : ''}`}
                >
                  <div className="toolbar">
                    <div>
                      <strong>实时连通性测试</strong>
                      <div className="subtle">
                        {connectivityProbeLabel(connectivityResult.probeMode)} /{' '}
                        {connectivityResult.providerLabel ??
                          connectivityResult.provider}
                      </div>
                    </div>
                    <span
                      className={`pill ${connectivityPillTone(connectivityResult.status)}`}
                    >
                      {connectivityLabel(connectivityResult.status)}
                    </span>
                  </div>
                  <div className="subtle">{connectivityResult.summary}</div>
                  <div className="subtle">
                    延迟 {connectivityResult.latencyMs} ms
                    {connectivityResult.baseUrl
                      ? ` · API: ${connectivityResult.baseUrl}`
                      : ''}
                    {connectivityResult.authSource
                      ? ` · 认证来源：${authSourceLabel(connectivityResult.authSource)}`
                      : ''}
                  </div>
                  {connectivityResult.details.map((detail) => (
                    <div key={detail} className="subtle">
                      {detail}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="grid three">
                <div className="field">
                  <label>Temperature</label>
                  <input
                    value={bindingForm.temperature}
                    onChange={(event) =>
                      setBindingForm((current) => ({
                        ...current,
                        temperature: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Max Tokens</label>
                  <input
                    value={bindingForm.maxTokens}
                    onChange={(event) =>
                      setBindingForm((current) => ({
                        ...current,
                        maxTokens: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Timeout Sec</label>
                  <input
                    value={bindingForm.timeoutSec}
                    onChange={(event) =>
                      setBindingForm((current) => ({
                        ...current,
                        timeoutSec: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid two">
                <div className="field">
                  <label>Retry Limit</label>
                  <input
                    value={bindingForm.retryLimit}
                    onChange={(event) =>
                      setBindingForm((current) => ({
                        ...current,
                        retryLimit: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Extra Config JSON</label>
                  <textarea
                    value={bindingForm.extraConfig}
                    onChange={(event) =>
                      setBindingForm((current) => ({
                        ...current,
                        extraConfig: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={loading !== null || testingConnectivity}
                  onClick={() => void testBindingConnectivity()}
                >
                  {testingConnectivity ? '测试中...' : '测试 API 连通性'}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={loading !== null}
                  onClick={saveBinding}
                >
                  {loading === 'binding' ? '保存中...' : '保存模型绑定'}
                </button>
              </div>
              {bindingStatus ? <p className="subtle">{bindingStatus}</p> : null}
              {connectivityStatus ? (
                <p className="subtle">{connectivityStatus}</p>
              ) : null}
            </div>
          ) : (
            <p className="subtle">当前项目还没有 model binding。</p>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">当前生效快照</h2>
        <div className="event-list">
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className="list-row">
              <strong>{snapshot.stageName}</strong>
              <div className="subtle">
                {snapshot.snapshotMarkdown ?? formatJson(snapshot.snapshotJson)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
