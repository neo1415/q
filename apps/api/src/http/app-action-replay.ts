import { createHash } from "node:crypto";

import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
} from "@capital-q/contracts";

/**
 * RECOVERY-2026-10 (lead security fix 1): a generated action route runs
 * its service call at most once per Idempotency-Key.
 *
 * The screen sends one key per intent (the same key when it retries); the
 * key is validated (printable ASCII, 8-255 characters) and bound to the
 * person, the action and the exact input. A retry with the same key and
 * input gets the first run's result without running again -- also while
 * the first is still running -- and the same key with a different input
 * is refused, never run. A failed run is not remembered, so the person can
 * try again. Without a key the request's own id is used, as before (no
 * replay protection; every first-party caller sends one).
 *
 * In this process, bounded and for a day: the owning services' own
 * idempotency (where they keep one) is the durable guard across instances.
 */

export const REPLAY_TTL_MS = 24 * 60 * 60_000;
export const REPLAY_MAX = 10_000;

export type IdempotencyKeyRead =
  | { readonly kind: "ABSENT" }
  | { readonly kind: "INVALID" }
  | { readonly kind: "KEY"; readonly key: string };

/** The request's Idempotency-Key, validated; a malformed one is refused, never ignored. */
export function idempotencyKeyOf(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): IdempotencyKeyRead {
  const raw = headers[IDEMPOTENCY_KEY_HEADER];
  if (raw === undefined) return { kind: "ABSENT" };
  if (Array.isArray(raw)) return { kind: "INVALID" };
  const parsed = IdempotencyKeyHeaderSchema.safeParse(raw);
  return parsed.success
    ? { kind: "KEY", key: parsed.data }
    : { kind: "INVALID" };
}

type Entry = {
  readonly digest: string;
  readonly at: number;
  readonly outcome: Promise<unknown>;
};

export type ReplayDecision =
  | { readonly kind: "RUN"; readonly outcome: Promise<unknown> }
  | { readonly kind: "REPLAY"; readonly outcome: Promise<unknown> }
  | { readonly kind: "CONFLICT" };

export type ActionReplayGuard = {
  /**
   * Runs `run` once for this scope and key: a repeat with the same input
   * replays the first outcome (waiting for it if it is still running);
   * a repeat with another input is a CONFLICT.
   */
  readonly once: (
    scope: string,
    key: string,
    input: unknown,
    run: () => Promise<unknown>,
  ) => ReplayDecision;
};

function digestOf(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input) ?? "undefined")
    .digest("hex");
}

export function createActionReplayGuard(
  options: { readonly now?: () => number; readonly max?: number } = {},
): ActionReplayGuard {
  const now = options.now ?? Date.now;
  const max = options.max ?? REPLAY_MAX;
  const entries = new Map<string, Entry>();
  const sweep = () => {
    const cutoff = now() - REPLAY_TTL_MS;
    for (const [id, entry] of entries) {
      if (entry.at >= cutoff && entries.size <= max) break;
      if (entry.at < cutoff || entries.size > max) entries.delete(id);
    }
  };
  return {
    once: (scope, key, input, run) => {
      sweep();
      const id = `${scope}\u0000${key}`;
      const digest = digestOf(input);
      const held = entries.get(id);
      if (held !== undefined && now() - held.at <= REPLAY_TTL_MS) {
        return held.digest === digest
          ? { kind: "REPLAY", outcome: held.outcome }
          : { kind: "CONFLICT" };
      }
      const outcome = run();
      entries.set(id, { digest, at: now(), outcome });
      // A failure is not an outcome to replay: the next try runs again.
      outcome.catch(() => {
        if (entries.get(id)?.outcome === outcome) entries.delete(id);
      });
      return { kind: "RUN", outcome };
    },
  };
}
