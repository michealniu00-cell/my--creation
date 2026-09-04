import { describe, expect, it } from 'vitest';
import {
  abortableProviderDelay,
  providerIdempotencyHeaders,
  providerRequestSignal,
} from './request-control';
import type { ProviderBindingConfig } from './types';

const binding: ProviderBindingConfig = {
  provider: 'mock',
  modelName: 'mock-model',
  temperature: 0.5,
  maxTokens: 512,
  timeoutSec: 120,
  retryLimit: 1,
  extraConfig: {},
};

describe('provider request control', () => {
  it('propagates a durable-job abort into the provider request signal', () => {
    const controller = new AbortController();
    const signal = providerRequestSignal(binding, controller.signal);
    const reason = new Error('job cancelled');

    controller.abort(reason);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  it('interrupts provider polling delays when a job is cancelled', async () => {
    const controller = new AbortController();
    const reason = new Error('job cancelled');
    const delay = abortableProviderDelay(60_000, controller.signal);

    controller.abort(reason);

    await expect(delay).rejects.toBe(reason);
  });

  it('only sends normalized idempotency keys', () => {
    expect(providerIdempotencyHeaders('  job-123  ')).toEqual({
      'Idempotency-Key': 'job-123',
    });
    expect(providerIdempotencyHeaders('   ')).toEqual({});
    expect(providerIdempotencyHeaders()).toEqual({});
  });
});
