import type { AgentName } from '../enums/agent';
import type { ProviderScope } from '../types/provider';

export const backendProviderEnvVarsByScope: Record<
  ProviderScope,
  {
    apiKey: string;
    baseUrl: string;
  }
> = {
  llm: {
    apiKey: 'VIDEO_AGENT_STUDIO_LLM_API_KEY',
    baseUrl: 'VIDEO_AGENT_STUDIO_LLM_BASE_URL',
  },
  image: {
    apiKey: 'VIDEO_AGENT_STUDIO_IMAGE_API_KEY',
    baseUrl: 'VIDEO_AGENT_STUDIO_IMAGE_BASE_URL',
  },
  video: {
    apiKey: 'VIDEO_AGENT_STUDIO_VIDEO_API_KEY',
    baseUrl: 'VIDEO_AGENT_STUDIO_VIDEO_BASE_URL',
  },
};

const trackedBackendEnvKeys = [
  'VIDEO_AGENT_STUDIO_LLM_API_KEY',
  'VIDEO_AGENT_STUDIO_LLM_BASE_URL',
  'VIDEO_AGENT_STUDIO_IMAGE_API_KEY',
  'VIDEO_AGENT_STUDIO_IMAGE_BASE_URL',
  'VIDEO_AGENT_STUDIO_VIDEO_API_KEY',
  'VIDEO_AGENT_STUDIO_VIDEO_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_VERSION',
] as const;

type TrackedBackendEnvKey = (typeof trackedBackendEnvKeys)[number];

const envReloadState = {
  signature: '',
};

function getNodeRuntime() {
  if (typeof window !== 'undefined') {
    return null;
  }

  try {
    const getBuiltinModule = (process as NodeJS.Process & {
      getBuiltinModule?: (id: string) => unknown;
    }).getBuiltinModule;

    if (typeof getBuiltinModule === 'function') {
      const fs = getBuiltinModule('fs') as typeof import('fs') | undefined;
      const path = getBuiltinModule('path') as typeof import('path') | undefined;
      if (fs && path) {
        return { fs, path };
      }
    }

    return {
      fs: null,
      path: null,
    };
  } catch {
    return null;
  }
}

function stripInlineComment(value: string) {
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === '#' && !inSingle && !inDouble) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value.trimEnd();
}

function parseEnvFile(filePath: string): Partial<Record<TrackedBackendEnvKey, string>> {
  const runtime = getNodeRuntime();
  if (!runtime?.fs?.existsSync(filePath)) {
    return {};
  }

  const parsed: Partial<Record<TrackedBackendEnvKey, string>> = {};
  const source = runtime.fs.readFileSync(filePath, 'utf8');

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const delimiterIndex = rawLine.indexOf('=');
    if (delimiterIndex <= 0) {
      continue;
    }

    const key = rawLine.slice(0, delimiterIndex).trim() as TrackedBackendEnvKey;
    if (!trackedBackendEnvKeys.includes(key)) {
      continue;
    }

    let value = rawLine.slice(delimiterIndex + 1).trim();
    value = stripInlineComment(value);

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function fileSignature(filePath: string) {
  const runtime = getNodeRuntime();
  if (!runtime?.fs?.existsSync(filePath)) {
    return `${filePath}:missing`;
  }

  const stat = runtime.fs.statSync(filePath);
  return `${filePath}:${stat.mtimeMs}:${stat.size}`;
}

function resolveEnvFiles() {
  const runtime = getNodeRuntime();
  if (!runtime?.path) {
    return [];
  }

  const cwd = process.cwd();
  return [runtime.path.resolve(cwd, '.env'), runtime.path.resolve(cwd, '.env.local')];
}

function hydrateTrackedBackendEnv() {
  const envFiles = resolveEnvFiles();
  if (envFiles.length === 0) {
    return;
  }
  const signature = envFiles.map(fileSignature).join('|');
  if (envReloadState.signature === signature) {
    return;
  }

  const merged: Partial<Record<TrackedBackendEnvKey, string>> = {};
  for (const filePath of envFiles) {
    Object.assign(merged, parseEnvFile(filePath));
  }

  for (const key of trackedBackendEnvKeys) {
    const value = merged[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }

  envReloadState.signature = signature;
}

export function normalizeProviderName(provider?: string | null) {
  return (provider ?? 'mock').trim().toLowerCase();
}

export function providerScopeForAgentName(agentName: AgentName): ProviderScope {
  if (agentName === 'agent8') {
    return 'image';
  }
  if (agentName === 'agent9') {
    return 'video';
  }
  return 'llm';
}

function sanitizeSecret(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const withoutBearer = trimmed.replace(/^Bearer\s+/i, '');
  const withoutQuotes = withoutBearer.replace(/^['"]|['"]$/g, '').trim();
  return withoutQuotes || null;
}

function normalizeBaseUrl(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

function scopedBaseUrlMatchesProvider(baseUrl: string, provider: string) {
  const normalized = baseUrl.replace(/\/+$/, '').toLowerCase();

  if (provider === 'anthropic') {
    return normalized.includes('/anthropic') || normalized.includes('api.anthropic.com');
  }

  if (provider === 'minimax') {
    return (
      (normalized.includes('api.minimax.io') || normalized.includes('api.minimaxi.com')) &&
      !normalized.includes('/anthropic')
    );
  }

  if (provider === 'openai') {
    return normalized.includes('api.openai.com');
  }

  return true;
}

export function requiredBackendEnvVarsForProvider(scope: ProviderScope, provider?: string | null) {
  hydrateTrackedBackendEnv();
  const envVars = backendProviderEnvVarsByScope[scope];
  const normalizedProvider = normalizeProviderName(provider);

  if (normalizedProvider === 'mock') {
    return [];
  }

  if (normalizedProvider === 'openai_compatible') {
    return [envVars.apiKey, envVars.baseUrl];
  }

  return [envVars.apiKey];
}

export function resolveBackendProviderApiKey(scope: ProviderScope, provider?: string | null) {
  hydrateTrackedBackendEnv();
  const envVars = backendProviderEnvVarsByScope[scope];
  const scopedApiKey = sanitizeSecret(process.env[envVars.apiKey] ?? null);
  if (scopedApiKey) {
    return scopedApiKey;
  }

  const normalizedProvider = normalizeProviderName(provider);
  if (normalizedProvider === 'openai') {
    return sanitizeSecret(process.env.OPENAI_API_KEY ?? null);
  }
  if (normalizedProvider === 'minimax') {
    return sanitizeSecret(process.env.MINIMAX_API_KEY ?? null);
  }
  if (normalizedProvider === 'anthropic') {
    return sanitizeSecret(process.env.ANTHROPIC_API_KEY ?? null);
  }
  return null;
}

export function resolveBackendProviderBaseUrl(scope: ProviderScope, provider?: string | null) {
  hydrateTrackedBackendEnv();
  const envVars = backendProviderEnvVarsByScope[scope];
  const scopedBaseUrl = normalizeBaseUrl(process.env[envVars.baseUrl] ?? null);
  const normalizedProvider = normalizeProviderName(provider);
  if (scopedBaseUrl && scopedBaseUrlMatchesProvider(scopedBaseUrl, normalizedProvider)) {
    return scopedBaseUrl;
  }

  if (normalizedProvider === 'openai') {
    return normalizeBaseUrl(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1');
  }
  if (normalizedProvider === 'minimax') {
    return normalizeBaseUrl(process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/v1');
  }
  if (normalizedProvider === 'anthropic') {
    return normalizeBaseUrl(process.env.ANTHROPIC_BASE_URL ?? 'https://api.minimaxi.com/anthropic');
  }
  return null;
}
