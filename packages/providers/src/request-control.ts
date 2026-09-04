import type { ProviderBindingConfig } from './types';

function positiveTimeoutMs(binding: ProviderBindingConfig) {
  return Math.max(1_000, Math.round((binding.timeoutSec ?? 120) * 1_000));
}

/** Combines the durable worker signal with the provider-specific deadline. */
export function providerRequestSignal(
  binding: ProviderBindingConfig,
  externalSignal?: AbortSignal | null,
) {
  const timeoutSignal = AbortSignal.timeout(positiveTimeoutMs(binding));
  return externalSignal
    ? AbortSignal.any([externalSignal, timeoutSignal])
    : timeoutSignal;
}

export function providerIdempotencyHeaders(
  idempotencyKey?: string | null,
): Record<string, string> {
  const normalized = idempotencyKey?.trim();
  return normalized ? { 'Idempotency-Key': normalized } : {};
}

export function throwIfProviderAborted(signal?: AbortSignal | null) {
  signal?.throwIfAborted();
}

export function abortableProviderDelay(ms: number, signal?: AbortSignal | null) {
  throwIfProviderAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('Provider request aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
