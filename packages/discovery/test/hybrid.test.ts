import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import type { StructuredCandidate } from "../src/candidates/contracts.js";
import type { StructuredCandidateService } from "../src/candidates/service.js";
import {
  ELIGIBILITY_CRITERIA,
  type EligibilityResult,
} from "../src/eligibility/contracts.js";
import { HybridCandidatePoolSchema } from "../src/hybrid/contracts.js";
import { mergeCandidatePools } from "../src/hybrid/merge.js";
import { createHybridCandidateService } from "../src/hybrid/service.js";
import type { SemanticCandidate } from "../src/semantic/contracts.js";
import type { SemanticCandidateService } from "../src/semantic/service.js";

/**
 * The hybrid pool (CQ-REC-003 §29–§30, §38): UNION by canonical id, both
 * provenances kept, canonical order, and a semantic failure that leaves
 * the structured pool exactly as it was.
 */

const ACTOR = {
  userId: "11111111-0000-4000-8000-000000000014",
  tenantId: "11111111-0000-4000-8000-000000000011",
  organisationId: "11111111-0000-4000-8000-000000000012",
  membershipId: "11111111-0000-4000-8000-000000000015",
  actorType: "HUMAN",
} as unknown as ActorContext;

const id = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;

const eligible = (companyId: string): EligibilityResult => ({
  eligibilityPolicyVersion: "eligibility.v1",
  mode: "INVESTOR_DISCOVER",
  companyId,
  investorOrganisationId: "11111111-0000-4000-8000-000000000013",
  mandateId: "33333333-0000-4000-8000-000000000031",
  mandateVersion: 1,
  taxonomyVersion: null,
  decision: "ELIGIBLE",
  reasonCodes: [],
  criteria: ELIGIBILITY_CRITERIA.map((criterion) => ({
    criterion,
    outcome: "PASS" as const,
    reasonCode: null,
    detail: null,
  })),
  evaluatedAt: "2026-09-18T12:00:00.000Z",
});

const structured = (n: number): StructuredCandidate => ({
  companyId: id(n),
  provenance: {
    generatorId: "STRUCTURED_MANDATE",
    generatorVersion: "structured-mandate.v1",
    matchedDimensions: ["STAGE"],
    reasonCodes: ["STAGE_OVERLAP"],
    matchedNodes: [],
    taxonomyVersion: null,
  },
  eligibility: eligible(id(n)),
});

const semantic = (n: number, similarity: number): SemanticCandidate => ({
  companyId: id(n),
  provenance: {
    generatorId: "SEMANTIC_MANDATE",
    generatorVersion: "semantic-mandate.v1",
    metric: "COSINE",
    similarity,
    companyRepresentationVersion: "company-investment-representation.v1",
    investorRepresentationVersion: "investor-mandate-representation.v1",
    configurationVersion: "capital-q-fake-embedding-v1",
    documentInstructionVersion: "none-v1",
    queryInstructionVersion: "capital-q-mandate-matching-v1",
  },
  eligibility: eligible(id(n)),
});

describe("mergeCandidatePools", () => {
  it("one company, both provenances; structured-only and semantic-only retained; canonical order (C, D, E)", () => {
    const merged = mergeCandidatePools({
      structured: [structured(3), structured(1)],
      semantic: [semantic(2, 0.91), semantic(3, 0.72)],
      poolMax: 200,
    });
    expect(merged.candidates.map((c) => c.companyId)).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
    const [one, two, three] = merged.candidates;
    expect(one?.structured).not.toBeNull();
    expect(one?.semantic).toBeNull();
    expect(two?.structured).toBeNull();
    expect(two?.semantic?.similarity).toBe(0.91);
    expect(three?.structured?.reasonCodes).toEqual(["STAGE_OVERLAP"]);
    expect(three?.semantic?.similarity).toBe(0.72);
    expect(merged).toMatchObject({
      structuredOnly: 1,
      semanticOnly: 1,
      both: 1,
      truncated: false,
    });
  });

  it("similarity never orders the pool and no threshold drops a candidate (§31)", () => {
    const merged = mergeCandidatePools({
      structured: [],
      semantic: [semantic(9, 0.05), semantic(4, 0.99), semantic(7, -0.3)],
      poolMax: 200,
    });
    expect(merged.candidates.map((c) => c.companyId)).toEqual([
      id(4),
      id(7),
      id(9),
    ]);
  });

  it("is bounded by the pool budget on canonical order", () => {
    const merged = mergeCandidatePools({
      structured: [structured(5), structured(6)],
      semantic: [semantic(1, 0.5), semantic(2, 0.5)],
      poolMax: 3,
    });
    expect(merged.truncated).toBe(true);
    expect(merged.candidates.map((c) => c.companyId)).toEqual([
      id(1),
      id(2),
      id(5),
    ]);
  });
});

describe("hybrid candidate service", () => {
  const context = {
    tenantId: ACTOR.tenantId,
    investorOrganisationId: "11111111-0000-4000-8000-000000000013",
    mode: "INVESTOR_DISCOVER" as const,
    mandateId: "33333333-0000-4000-8000-000000000031",
    taxonomyVersion: null,
    eligibilityPolicyVersion: "eligibility.v1" as const,
  };
  const structuredService: StructuredCandidateService = {
    generate: () =>
      Promise.resolve({
        kind: "GENERATED",
        generatorId: "STRUCTURED_MANDATE",
        generatorVersion: "structured-mandate.v1",
        eligibilityPolicyVersion: "eligibility.v1",
        context,
        candidates: [structured(1), structured(2)],
        diagnostics: {
          rawHitsByDimension: {
            STAGE: 2,
            GEOGRAPHY: 0,
            TAXONOMY: 0,
            CHEQUE: 0,
          },
          rawHits: 2,
          deduped: 2,
          truncated: false,
          eligible: 2,
          ineligible: 0,
          undetermined: 0,
          chequeSignal: "NOT_COMPUTABLE",
          durationMs: 1,
        },
      }),
  };

  it("a semantic failure degrades safely: the structured pool is untouched and the result says so (M)", async () => {
    const semanticService: SemanticCandidateService = {
      generate: () =>
        Promise.resolve({
          kind: "UNAVAILABLE",
          generatorId: "SEMANTIC_MANDATE",
          generatorVersion: "semantic-mandate.v1",
          context,
          failureClass: "UNAVAILABLE",
          retryable: true,
        }),
      refreshCompanyRepresentations: () => Promise.reject(new Error("unused")),
    };
    const pool = await createHybridCandidateService({
      structured: structuredService,
      semantic: semanticService,
    }).generate({ actor: ACTOR });
    expect(HybridCandidatePoolSchema.parse(pool)).toEqual(pool);
    if (pool.kind !== "GENERATED") throw new Error(pool.kind);
    expect(pool.semanticUnavailable).toEqual({
      failureClass: "UNAVAILABLE",
      retryable: true,
    });
    expect(pool.candidates.map((c) => c.companyId)).toEqual([id(1), id(2)]);
    expect(pool.candidates.every((c) => c.semantic === null)).toBe(true);
    expect(pool.diagnostics.semantic).toBeNull();
    expect(pool.diagnostics.structured.eligible).toBe(2);
  });

  it("merges both generators' pools into one, with both provenances where both found a company", async () => {
    const semanticService: SemanticCandidateService = {
      generate: () =>
        Promise.resolve({
          kind: "GENERATED",
          generatorId: "SEMANTIC_MANDATE",
          generatorVersion: "semantic-mandate.v1",
          eligibilityPolicyVersion: "eligibility.v1",
          context,
          candidates: [semantic(2, 0.8), semantic(3, 0.6)],
          diagnostics: {
            topK: 200,
            queryVector: "COMPUTED",
            investorRepresentation: "BUILT",
            rawHits: 3,
            eligible: 2,
            ineligible: 1,
            undetermined: 0,
            queryDurationMs: 1,
            durationMs: 2,
          },
        }),
      refreshCompanyRepresentations: () => Promise.reject(new Error("unused")),
    };
    const pool = await createHybridCandidateService({
      structured: structuredService,
      semantic: semanticService,
    }).generate({ actor: ACTOR });
    if (pool.kind !== "GENERATED") throw new Error(pool.kind);
    expect(pool.semanticUnavailable).toBeNull();
    expect(pool.candidates.map((c) => c.companyId)).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
    expect(pool.diagnostics).toMatchObject({
      merged: 3,
      structuredOnly: 1,
      semanticOnly: 1,
      both: 1,
    });
    // The pool carries no user-facing verdict vocabulary: no percentage, no
    // probability, no "match score" (matchedDimensions is REC-002's
    // structured provenance, a list of dimensions, not a score).
    expect(JSON.stringify(pool)).not.toMatch(
      /matchScore|matchPercent|probability|percent|fitScore|investiq/i,
    );
  });
});
