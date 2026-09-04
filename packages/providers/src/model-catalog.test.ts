import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProviderModels } from './model-catalog';

describe('listProviderModels', () => {
  afterEach(() => vi.restoreAllMocks());

  it('normalizes and sorts OpenAI-compatible model results behind the adapter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'z-model', owned_by: 'vendor' },
            { id: 'a-model', name: 'A model' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const items = await listProviderModels({
      provider: 'openai_compatible',
      baseUrl: 'https://supplier.example/v1/',
      apiKey: 'secret',
    });

    expect(items).toEqual([
      { id: 'a-model', label: 'A model', ownedBy: null },
      { id: 'z-model', label: 'z-model', ownedBy: 'vendor' },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://supplier.example/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('uses Anthropic headers and reports bounded supplier errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not authorized', { status: 401 }),
    );

    await expect(
      listProviderModels({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'secret',
      }),
    ).rejects.toMatchObject({
      name: 'ProviderCatalogError',
      status: 401,
    });
  });
});
