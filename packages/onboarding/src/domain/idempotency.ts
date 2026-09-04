import { createHash } from "node:crypto";

/**
 * Onboarding idempotency stores hashes only, namespaced per operation so a
 * key reused across operations never collides. Request hashes are canonical
 * (sorted-key, undefined-stripped) JSON of the validated input.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const ONBOARDING_MUTATION_OPERATIONS = [
  "start",
  "submit",
  "skip",
  "resolve_suggestion",
] as const;
export type OnboardingMutationOperation =
  (typeof ONBOARDING_MUTATION_OPERATIONS)[number];

export function hashOnboardingIdempotencyKey(
  operation: OnboardingMutationOperation,
  key: string,
): string {
  return sha256Hex(`onboarding.${operation}:${key}`);
}

export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const result: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      result[key] = canonicalise(item);
    }
    return result;
  }
  return value;
}

export function hashOnboardingRequest(input: unknown): string {
  return sha256Hex(JSON.stringify(canonicalise(input)));
}
