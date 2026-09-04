import { jsonFail } from './http';

export function jsonProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Provider execution failed';
  const isConfigError =
    message.includes('API key is required') ||
    message.includes('required when provider is set to') ||
    message.includes('Missing model binding') ||
    message.includes('Unsupported');

  return jsonFail(
    isConfigError ? 'PROVIDER_CONFIG_ERROR' : 'PROVIDER_EXECUTION_ERROR',
    message,
    isConfigError ? 503 : 502,
  );
}
