/**
 * Bounded, deterministic publisher retry policy.
 *
 * Exponential backoff from 5 s, doubling per attempt, capped at 5 minutes,
 * for at most `maxAttempts` attempts: 5, 10, 20, 40, 80, 160, 300, 300, ...
 * A row that exhausts its attempts stays in the table as stuck work an
 * operator can inspect; it is never retried forever and never deleted here.
 */

export type OutboxRetryPolicy = {
  readonly maxAttempts: number;
  /** Seconds to wait before the next attempt, given the attempt just made. */
  readonly backoffSeconds: (attempt: number) => number;
};

export const DEFAULT_MAX_ATTEMPTS = 10;
const BASE_SECONDS = 5;
const CAP_SECONDS = 300;

export function exponentialBackoffSeconds(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 30));
  return Math.min(BASE_SECONDS * 2 ** exponent, CAP_SECONDS);
}

export function createOutboxRetryPolicy(
  options: { readonly maxAttempts?: number | undefined } = {},
): OutboxRetryPolicy {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  return { maxAttempts, backoffSeconds: exponentialBackoffSeconds };
}
