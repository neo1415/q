import { createHash } from "node:crypto";

import type { CreateOrganisationRequest } from "@capital-q/contracts";

/**
 * Idempotency for organisation creation stores hashes only.
 *
 *   key hash      SHA-256 of the client's Idempotency-Key; the raw key is
 *                 client-chosen and never persisted
 *   request hash  SHA-256 of the validated request in canonical form (sorted
 *                 keys, absent optionals omitted), so "the same request" is a
 *                 question of meaning, not of byte order
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashIdempotencyKey(key: string): string {
  return sha256Hex(`organisation.create:${key}`);
}

export function hashCreateOrganisationRequest(
  input: CreateOrganisationRequest,
): string {
  const canonical: Record<string, string> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key as keyof CreateOrganisationRequest];
    if (value !== undefined) {
      canonical[key] = value;
    }
  }
  return sha256Hex(JSON.stringify(canonical));
}
