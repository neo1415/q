import { createHash } from "node:crypto";

import type { CreateInvestorOrganisationRequest } from "@capital-q/contracts";

/**
 * Investor creation idempotency stores hashes only -- the same design as
 * organisation and company creation, with its own namespace so a key
 * reused across operations can never collide.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashInvestorIdempotencyKey(key: string): string {
  return sha256Hex(`investor.create:${key}`);
}

export function hashCreateInvestorOrganisationRequest(
  input: CreateInvestorOrganisationRequest,
): string {
  const canonical: Record<string, string> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key as keyof CreateInvestorOrganisationRequest];
    if (value !== undefined) {
      canonical[key] = value;
    }
  }
  return sha256Hex(JSON.stringify(canonical));
}
