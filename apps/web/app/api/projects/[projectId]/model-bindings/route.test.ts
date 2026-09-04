import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settingsRepository } from '@video-agent-studio/db';
import { PUT } from './route';
import { createTempApiTestEnv, getDemoProject } from '../../../test-helpers';

describe('PUT /api/projects/[projectId]/model-bindings', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-model-bindings-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('syncs agent1-7 bindings when updating one shared llm agent', async () => {
    const project = await getDemoProject();
    await settingsRepository.ensureDefaults(project.id);
    const bindings = await settingsRepository.listModelBindings(project.id);
    const source = bindings.find((item) => item.agentName === 'agent3');
    expect(source).toBeTruthy();

    const response = await PUT(
      new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bindingId: source!.id,
          provider: 'minimax',
          providerLabel: 'MiniMax',
          modelName: 'MiniMax-M2.5',
          temperature: 0.4,
          maxTokens: 4096,
          timeoutSec: 180,
          retryLimit: 2,
          extraConfig: {},
        }),
      }),
      {
        params: Promise.resolve({ projectId: project.id }),
      },
    );

    const payload = (await response.json()) as {
      success: boolean;
      data: {
        affectedAgentNames: string[];
      };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.affectedAgentNames).toEqual([
      'agent1',
      'agent2',
      'agent3',
      'agent4',
      'agent5',
      'agent6',
      'agent7',
    ]);

    const updatedBindings = await settingsRepository.listModelBindings(project.id);
    const llmBindings = updatedBindings.filter((item) =>
      ['agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent6', 'agent7'].includes(item.agentName),
    );

    expect(llmBindings.every((item) => item.provider === 'minimax')).toBe(true);
    expect(llmBindings.every((item) => item.modelName === 'MiniMax-M2.5')).toBe(true);
  });
});
