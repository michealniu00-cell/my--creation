import { randomUUID } from 'node:crypto';

export function resolveWorkflowIdempotencyKey(request: Request) {
  const supplied = request.headers.get('idempotency-key')?.trim();
  if (
    supplied !== undefined &&
    (supplied.length === 0 || supplied.length > 200)
  ) {
    throw new Error(
      'Idempotency-Key must contain between 1 and 200 characters',
    );
  }
  return supplied ?? randomUUID();
}
