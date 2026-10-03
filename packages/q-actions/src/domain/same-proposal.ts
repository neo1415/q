import { canonicalJsonStringify } from "@capital-q/contracts";

/**
 * What makes two proposals the same card (lead 2026-10-03): the action
 * type and version, the targets and the values, as the person would
 * approve them. A restated request ("share my raise with Savanna Seed",
 * said again, here or in another conversation) produced a second identical
 * card, and "yes" then met "3 changes are waiting… which one?".
 *
 * Idempotency keys are not content: each run mints its own, so two
 * otherwise identical requests would never match on them. The binding
 * hash is not used either, because it covers the run and the proposal id
 * by design (each card's approval binds to that card alone).
 */
export function proposalContent(input: {
  readonly actionType: string;
  readonly actionVersion: number;
  readonly targets: readonly unknown[];
  readonly payload: unknown;
}): string {
  // Through JSON first, exactly as the payload is stored, so a value read
  // back from the database compares equal to the one just parsed.
  const stored = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(value ?? null)) as unknown;
  return canonicalJsonStringify({
    actionType: input.actionType,
    actionVersion: input.actionVersion,
    targets: stored(input.targets),
    payload: withoutIdempotencyKeys(stored(input.payload)),
  });
}

function withoutIdempotencyKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIdempotencyKeys);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/^idempotency_?key$/iu.test(key)) continue;
    out[key] = withoutIdempotencyKeys(nested);
  }
  return out;
}
