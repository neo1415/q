import { createHash } from "node:crypto";

import type { CreateCompanyRequest } from "@capital-q/contracts";

/**
 * Company creation idempotency stores hashes only -- the same design as
 * organisation creation, with its own namespace so a key reused across the
 * two operations can never collide.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashCompanyIdempotencyKey(key: string): string {
  return sha256Hex(`company.create:${key}`);
}

export function hashCreateCompanyRequest(input: CreateCompanyRequest): string {
  const canonical: Record<string, string> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key as keyof CreateCompanyRequest];
    if (value !== undefined) {
      canonical[key] = value;
    }
  }
  return sha256Hex(JSON.stringify(canonical));
}
