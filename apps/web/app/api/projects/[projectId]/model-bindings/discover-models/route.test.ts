import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsRepository } from '@video-agent-studio/db';
import { POST } from './route';
import { createTempApiTestEnv, getDemoProject } from '../../../../test-helpers';

describe('POST /api/projects/[projectId]/model-bindings/discover-models', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-discover-models-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it('returns live models from an OpenAI-compatible supplier', async () => {
    const project = await getDemoProject();
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(project.id, 'agent1');
    expect(binding).toBeTruthy();
    process.env.VIDEO_AGENT_STUDIO_LLM_API_KEY = 'sk-test';
    process.env.VIDEO_AGENT_STUDIO_LLM_BASE_URL = 'https://example.com/v1';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'model-b', name: 'Model B', owned_by: 'supplier-b' },
            { id: 'model-a', name: 'Model A', owned_by: 'supplier-a' },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bindingId: binding!.id,
          provider: 'openai_compatible',
        }),
      }),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );

    const payload = (await response.json()) as {
      success: boolean;
      data: {
        count: number;
        items: Array<{ id: string; label: string; ownedBy?: string | null }>;
      };
    };

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.count).toBe(2);
    expect(payload.data.items.map((item) => item.id)).toEqual(['model-a', 'model-b']);
  });

  it('returns live models from Anthropics models API', async () => {
    const project = await getDemoProject();
    await settingsRepository.ensureDefaults(project.id);
    const binding = await settingsRepository.getActiveModelBinding(project.id, 'agent1');
    expect(binding).toBeTruthy();
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
            { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bindingId: binding!.id,
          provider: 'anthropic',
        }),
      }),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );

    const payload = (await response.json()) as {
      success: boolean;
      data: {
        count: number;
        items: Array<{ id: string }>;
      };
    };

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimaxi.com/anthropic/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'ant-test',
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.count).toBe(2);
  });
});
