import { canonicalJsonStringify } from "@capital-q/contracts";
import type { z } from "zod";

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

/**
 * The earlier proposal that a new one restates by intent: the same targets,
 * and the definition's `sameIntent` says the values mean the same change
 * (voiceq-63). Stored payloads are read back through the definition's own
 * schema; one that no longer parses never matches.
 */
export function findSameIntent<P, T>(
  definition: {
    readonly payload: z.ZodType<P>;
    readonly sameIntent?: ((previous: P, next: P) => boolean) | undefined;
  },
  candidates: readonly T[],
  read: (candidate: T) => {
    readonly targets: readonly unknown[];
    readonly payload: unknown;
  },
  next: { readonly targets: readonly unknown[]; readonly payload: P },
): T | undefined {
  const same = definition.sameIntent;
  if (same === undefined) return undefined;
  const key = (targets: readonly unknown[]) =>
    canonicalJsonStringify(JSON.parse(JSON.stringify(targets)) as unknown);
  const targetKey = key(next.targets);
  return candidates.find((candidate) => {
    const stored = read(candidate);
    if (key(stored.targets) !== targetKey) return false;
    const parsed = definition.payload.safeParse(stored.payload);
    return parsed.success && same(parsed.data, next.payload);
  });
}
