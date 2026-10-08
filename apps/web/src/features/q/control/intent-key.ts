/**
 * RECOVERY-2026-10 (lead security fix 1): one key per intent of the
 * person's, made where the intent happens (their click, their submit) and
 * sent with every retry of it as the Idempotency-Key, so an action runs
 * once however many times the request is sent.
 */
export function newIntentKey(): string {
  return `intent-${crypto.randomUUID()}`;
}
