export interface RetryPolicy {
  maxRetries: number;
  escalationThreshold: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 3,
  escalationThreshold: 3,
};

export function shouldEscalateToAgent1(retryCount: number, policy = defaultRetryPolicy) {
  return retryCount >= policy.escalationThreshold;
}

