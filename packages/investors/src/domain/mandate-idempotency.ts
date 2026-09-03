import { createHash } from "node:crypto";

import type { CreateInvestorMandateRequest } from "@capital-q/contracts";

/**
 * Mandate creation idempotency stores hashes only, in its own namespace so
 * a key reused across operations can never collide. The request hash is a
 * canonical (sorted-key) JSON serialisation of the validated body.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashInvestorMandateIdempotencyKey(key: string): string {
  return sha256Hex(`investor.mandate.create:${key}`);
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

export function hashCreateInvestorMandateRequest(
  input: CreateInvestorMandateRequest,
): string {
  return sha256Hex(JSON.stringify(canonicalise(input)));
}
