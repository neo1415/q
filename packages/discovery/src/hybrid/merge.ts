import type { StructuredCandidate } from "../candidates/contracts.js";
import type { SemanticCandidate } from "../semantic/contracts.js";
import type { HybridCandidate } from "./contracts.js";

/**
 * UNION by canonical company id, both provenances kept, canonical id
 * order. Both inputs are already ELIGIBLE under the same policy version
 * for the same run, so a company found twice carries one eligibility
 * result; the structured one is kept when both exist, purely for
 * determinism (they are equal in substance). Nothing is dropped, weighed
 * or ordered by similarity or by match count.
 */
export function mergeCandidatePools(input: {
  readonly structured: readonly StructuredCandidate[];
  readonly semantic: readonly SemanticCandidate[];
  readonly poolMax: number;
}): {
  readonly candidates: readonly HybridCandidate[];
  readonly truncated: boolean;
  readonly structuredOnly: number;
  readonly semanticOnly: number;
  readonly both: number;
} {
  const byCompany = new Map<string, HybridCandidate>();
  for (const candidate of input.structured) {
    byCompany.set(candidate.companyId, {
      companyId: candidate.companyId,
      structured: candidate.provenance,
      semantic: null,
      eligibility: candidate.eligibility,
    });
  }
  for (const candidate of input.semantic) {
    const existing = byCompany.get(candidate.companyId);
    byCompany.set(candidate.companyId, {
      companyId: candidate.companyId,
      structured: existing?.structured ?? null,
      semantic: candidate.provenance,
      eligibility: existing?.eligibility ?? candidate.eligibility,
    });
  }
  const ordered = [...byCompany.values()].sort((a, b) =>
    a.companyId.localeCompare(b.companyId),
  );
  const truncated = ordered.length > input.poolMax;
  const candidates = truncated ? ordered.slice(0, input.poolMax) : ordered;
  let structuredOnly = 0;
  let semanticOnly = 0;
  let both = 0;
  for (const c of candidates) {
    if (c.structured !== null && c.semantic !== null) both += 1;
    else if (c.structured !== null) structuredOnly += 1;
    else semanticOnly += 1;
  }
  return { candidates, truncated, structuredOnly, semanticOnly, both };
}
