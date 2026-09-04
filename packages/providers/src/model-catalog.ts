import { normalizeProviderName } from './health';

export interface ProviderModelCatalogItem {
  id: string;
  label: string;
  ownedBy: string | null;
}

export interface ProviderModelCatalogInput {
  provider: string;
  baseUrl: string;
  apiKey: string;
  anthropicVersion?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ProviderCatalogError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderCatalogError';
  }
}

function catalogSignal(input: ProviderModelCatalogInput) {
  const timeout = AbortSignal.timeout(
    Math.max(1_000, input.timeoutMs ?? 15_000),
  );
  return input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
}

function catalogEndpoint(provider: string, baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return provider === 'anthropic'
    ? `${normalizedBaseUrl.replace(/\/v1$/, '')}/v1/models`
    : `${normalizedBaseUrl}/models`;
}

/** Provider transport for low-cost model discovery and credential probes. */
export async function listProviderModels(
  input: ProviderModelCatalogInput,
): Promise<ProviderModelCatalogItem[]> {
  const provider = normalizeProviderName(input.provider);
  if (!['openai', 'openai_compatible', 'anthropic'].includes(provider)) {
    throw new ProviderCatalogError(
      `Model discovery is not supported for ${provider}.`,
    );
  }
  if (!input.baseUrl.trim() || !input.apiKey.trim()) {
    throw new ProviderCatalogError(
      'Model discovery requires both Base URL and API Key.',
    );
  }

  const response = await fetch(catalogEndpoint(provider, input.baseUrl), {
    method: 'GET',
    headers:
      provider === 'anthropic'
        ? {
            'x-api-key': input.apiKey,
            'anthropic-version': input.anthropicVersion ?? '2023-06-01',
          }
        : {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
    cache: 'no-store',
    signal: catalogSignal(input),
  });

  if (!response.ok) {
    let supplierMessage = '';
    try {
      supplierMessage = (await response.text()).replace(/\s+/g, ' ').trim();
    } catch {
      supplierMessage = 'Unable to read supplier error payload.';
    }
    throw new ProviderCatalogError(
      `Supplier models request failed (${response.status}): ${supplierMessage.slice(0, 500)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id?: string | null;
      name?: string | null;
      owned_by?: string | null;
    }>;
  };
  return (payload.data ?? [])
    .map((item) => ({
      id: item.id?.trim() ?? '',
      label: item.name?.trim() || item.id?.trim() || '',
      ownedBy: item.owned_by ?? null,
    }))
    .filter((item) => item.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}
