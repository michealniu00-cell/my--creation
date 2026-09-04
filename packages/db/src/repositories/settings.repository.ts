import {
  agentNames,
  providerScopeForAgentName,
  resolveBackendProviderApiKey,
  resolveBackendProviderBaseUrl,
  type AgentModelBindingRecord,
  type AgentName,
  type AgentProfileRecord,
} from '@video-agent-studio/shared';
import { audited, id, mutateDb, readDb, timestamp } from '../dev-file-db';

type AgentProfileEditableFields = Pick<
  AgentProfileRecord,
  | 'roleDefinition'
  | 'systemPrompt'
  | 'developerPrompt'
  | 'inputSchema'
  | 'outputSchema'
  | 'allowedTools'
  | 'contextScope'
  | 'writeScope'
  | 'deleteScope'
  | 'reviewRules'
  | 'note'
>;

type AgentModelBindingEditableFields = Pick<
  AgentModelBindingRecord,
  | 'provider'
  | 'providerLabel'
  | 'modelName'
  | 'temperature'
  | 'maxTokens'
  | 'timeoutSec'
  | 'retryLimit'
  | 'extraConfig'
>;

const mockDefaultBindingByAgent: Record<
  AgentName,
  Pick<AgentModelBindingRecord, 'provider' | 'modelName' | 'temperature' | 'maxTokens' | 'timeoutSec' | 'retryLimit' | 'extraConfig'>
> = {
  agent1: {
    provider: 'mock',
    modelName: 'gpt-5-mini',
    temperature: 0.4,
    maxTokens: 4000,
    timeoutSec: 120,
    retryLimit: 2,
    extraConfig: {},
  },
  agent2: {
    provider: 'mock',
    modelName: 'gpt-5',
    temperature: 0.4,
    maxTokens: 6000,
    timeoutSec: 120,
    retryLimit: 3,
    extraConfig: {},
  },
  agent3: {
    provider: 'mock',
    modelName: 'gpt-5',
    temperature: 0.5,
    maxTokens: 6000,
    timeoutSec: 120,
    retryLimit: 3,
    extraConfig: {},
  },
  agent4: {
    provider: 'mock',
    modelName: 'gpt-5',
    temperature: 0.45,
    maxTokens: 8000,
    timeoutSec: 120,
    retryLimit: 3,
    extraConfig: {},
  },
  agent5: {
    provider: 'mock',
    modelName: 'gpt-5-mini',
    temperature: 0.2,
    maxTokens: 2000,
    timeoutSec: 90,
    retryLimit: 2,
    extraConfig: {},
  },
  agent6: {
    provider: 'mock',
    modelName: 'gpt-5',
    temperature: 0.5,
    maxTokens: 4000,
    timeoutSec: 120,
    retryLimit: 3,
    extraConfig: {},
  },
  agent7: {
    provider: 'mock',
    modelName: 'gpt-5',
    temperature: 0.6,
    maxTokens: 4000,
    timeoutSec: 120,
    retryLimit: 3,
    extraConfig: {},
  },
  agent8: {
    provider: 'mock',
    modelName: 'gpt-image-1',
    temperature: null,
    maxTokens: null,
    timeoutSec: 180,
    retryLimit: 2,
    extraConfig: {},
  },
  agent9: {
    provider: 'mock',
    modelName: 'sora-2',
    temperature: null,
    maxTokens: null,
    timeoutSec: 300,
    retryLimit: 1,
    extraConfig: {},
  },
};

function hasDomesticMiniMaxBinding(scope: 'llm' | 'image' | 'video') {
  const apiKey = resolveBackendProviderApiKey(scope, 'minimax');
  const baseUrl = resolveBackendProviderBaseUrl(scope, 'minimax');
  return Boolean(apiKey && baseUrl?.includes('api.minimaxi.com'));
}

function defaultBindingForAgent(agentName: AgentName) {
  if (agentName === 'agent8' && hasDomesticMiniMaxBinding('image')) {
    return {
      provider: 'minimax',
      modelName: 'image-01',
      temperature: null,
      maxTokens: null,
      timeoutSec: 180,
      retryLimit: 2,
      extraConfig: {},
    } satisfies Pick<
      AgentModelBindingRecord,
      'provider' | 'modelName' | 'temperature' | 'maxTokens' | 'timeoutSec' | 'retryLimit' | 'extraConfig'
    >;
  }

  if (agentName === 'agent9' && hasDomesticMiniMaxBinding('video')) {
    return {
      provider: 'minimax',
      modelName: 'MiniMax-Hailuo-2.3',
      temperature: null,
      maxTokens: null,
      timeoutSec: 300,
      retryLimit: 2,
      extraConfig: {},
    } satisfies Pick<
      AgentModelBindingRecord,
      'provider' | 'modelName' | 'temperature' | 'maxTokens' | 'timeoutSec' | 'retryLimit' | 'extraConfig'
    >;
  }

  if (agentName !== 'agent8' && agentName !== 'agent9' && hasDomesticMiniMaxBinding('llm')) {
    return {
      provider: 'minimax',
      modelName: 'MiniMax-M2.7',
      temperature: mockDefaultBindingByAgent[agentName].temperature,
      maxTokens: mockDefaultBindingByAgent[agentName].maxTokens,
      timeoutSec: mockDefaultBindingByAgent[agentName].timeoutSec,
      retryLimit: mockDefaultBindingByAgent[agentName].retryLimit,
      extraConfig: {},
    } satisfies Pick<
      AgentModelBindingRecord,
      'provider' | 'modelName' | 'temperature' | 'maxTokens' | 'timeoutSec' | 'retryLimit' | 'extraConfig'
    >;
  }

  return mockDefaultBindingByAgent[agentName];
}

export const settingsRepository = {
  async ensureDefaults(projectId: string) {
    return mutateDb((db) => {
      const now = timestamp();
      // Legacy page-level credentials are no longer used anywhere in the product.
      if ((db.providerCredentials ?? []).length > 0) {
        db.providerCredentials = [];
      }
      const existingProfiles = db.agentProfiles.filter(
        (item) => item.projectId === projectId && !item.deletedAt,
      );
      const existingBindings = db.agentModelBindings.filter(
        (item) => item.projectId === projectId && !item.deletedAt,
      );

      agentNames.forEach((agentName, index) => {
        if (!existingProfiles.some((item) => item.agentName === agentName)) {
          db.agentProfiles.push(
            audited<AgentProfileRecord>({
              id: id(),
              projectId,
              agentName,
              versionNo: 1,
              roleDefinition: `${agentName} default profile`,
              systemPrompt: '',
              developerPrompt: '',
              inputSchema: {},
              outputSchema: {},
              allowedTools: [],
              contextScope: {},
              writeScope: {},
              deleteScope: {},
              reviewRules: [],
              isActive: true,
              note: `默认 profile ${index + 1}`,
            }),
          );
        }

        if (!existingBindings.some((item) => item.agentName === agentName)) {
          const defaults = defaultBindingForAgent(agentName);
          db.agentModelBindings.push({
            id: id(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            projectId,
            agentName,
            provider: defaults.provider,
            modelName: defaults.modelName,
            temperature: defaults.temperature,
            maxTokens: defaults.maxTokens,
            timeoutSec: defaults.timeoutSec,
            retryLimit: defaults.retryLimit,
            extraConfig: defaults.extraConfig,
            isActive: true,
          });
        }
      });
    });
  },

  async listProfiles(projectId: string) {
    const db = await readDb();
    return db.agentProfiles
      .filter((item) => item.projectId === projectId && !item.deletedAt)
      .sort((a, b) => a.agentName.localeCompare(b.agentName));
  },

  async listModelBindings(projectId: string) {
    const db = await readDb();
    return db.agentModelBindings
      .filter((item) => item.projectId === projectId && !item.deletedAt)
      .sort((a, b) => a.agentName.localeCompare(b.agentName));
  },

  async listSnapshots(projectId: string) {
    const db = await readDb();
    return db.projectStageSnapshots
      .filter((item) => item.projectId === projectId && item.isActive && !item.deletedAt)
      .sort((a, b) => a.stageName.localeCompare(b.stageName));
  },

  async getActiveProfile(projectId: string, agentName: AgentName) {
    const db = await readDb();
    return (
      db.agentProfiles.find(
        (item) =>
          item.projectId === projectId &&
          item.agentName === agentName &&
          item.isActive &&
          !item.deletedAt,
      ) ?? null
    );
  },

  async getActiveModelBinding(projectId: string, agentName: AgentName): Promise<AgentModelBindingRecord | null> {
    const db = await readDb();
    const binding =
      db.agentModelBindings.find(
        (item) =>
          item.projectId === projectId &&
          item.agentName === agentName &&
          item.isActive &&
          !item.deletedAt,
      ) ?? null;

    if (!binding) {
      return null;
    }

    const scope = providerScopeForAgentName(agentName);
    const envApiKey = resolveBackendProviderApiKey(scope, binding.provider);
    const envBaseUrl = resolveBackendProviderBaseUrl(scope, binding.provider);
    const credentialSource: AgentModelBindingRecord['credentialSource'] = envApiKey ? 'env' : 'none';

    const resolvedBinding: AgentModelBindingRecord = {
      ...binding,
      providerLabel: binding.providerLabel ?? null,
      baseUrl: envBaseUrl ?? null,
      apiKey: envApiKey,
      hasApiKey: Boolean(envApiKey),
      credentialSource,
    };
    return resolvedBinding;
  },

  async updateProfile(
    projectId: string,
    profileId: string,
    patch: AgentProfileEditableFields,
  ) {
    return mutateDb((db) => {
      const profile = db.agentProfiles.find(
        (item) => item.projectId === projectId && item.id === profileId && !item.deletedAt,
      );
      if (!profile) {
        return null;
      }

      Object.assign(profile, patch, {
        versionNo: profile.versionNo + 1,
        updatedAt: timestamp(),
      });
      return profile;
    });
  },

  async updateModelBinding(
    projectId: string,
    bindingId: string,
    patch: AgentModelBindingEditableFields,
  ) {
    return mutateDb((db) => {
      const binding = db.agentModelBindings.find(
        (item) => item.projectId === projectId && item.id === bindingId && !item.deletedAt,
      );
      if (!binding) {
        return null;
      }

      Object.assign(binding, patch, {
        updatedAt: timestamp(),
      });
      return binding;
    });
  },
};
