import { createHash } from "node:crypto";

import type { CreateCapitalObjectiveRequest } from "@capital-q/contracts";

/**
 * Capital objective creation idempotency stores hashes only, in its own
 * namespace so a key reused across operations can never collide. The
 * request hash is a canonical (sorted-key) JSON serialisation of the
 * validated body.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashCapitalObjectiveIdempotencyKey(key: string): string {
  return sha256Hex(`capital_objective.create:${key}`);
}

function canonicalise(value: unknown): unknown {
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

export function hashCreateCapitalObjectiveRequest(
  input: CreateCapitalObjectiveRequest,
): string {
  return sha256Hex(JSON.stringify(canonicalise(input)));
}
