import { describe, expect, it } from "vitest";

import type {
  PermittedContextPlan,
  QAuthorisedKnowledgeScope,
} from "@capital-q/contracts";

import {
  assembleAuthorisedFacts,
  describeLocator,
  describeRetrieval,
  describeSource,
  DEFAULT_RETRIEVAL_CONFIG,
  envelopeFromPlan,
  envelopeIsCurrent,
  fuseByReciprocalRank,
  RetrievalPermissionEnvelopeSchema,
  retrievalConstraintsFor,
  type AuthorisedRetrievalResult,
  type RetrievalHit,
} from "../src/index.js";

/**
 * The deterministic half of CQ-RAG-004: the plan → envelope projection,
 * Reciprocal Rank Fusion, and the assembler. Everything here is pure, so
 * everything here is asserted exactly rather than approximately.
 *
 * The security assertions in this file are about SHAPE — that the envelope
 * never invents a scope, never widens a label set, never raises a ceiling.
 * Whether the database honours the envelope is a question about SQL, and it
 * is answered against a real Postgres in the integration suite.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const COMPANY = "44444444-4444-4444-8444-444444444444";
const OTHER_COMPANY = "55555555-5555-4555-8555-555555555555";
const RUN = "66666666-6666-4666-8666-666666666666";

function plan(
  overrides: Partial<PermittedContextPlan> = {},
): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: "context-firewall-v1",
    planId: "77777777-7777-4777-8777-777777777777",
    fingerprint: "a".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: ACTOR, organisationId: ORG },
    purpose: { capability: "INVESTIGATE", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    scopes: [],
    denied: [],
    maxSensitivity: "HIGHLY_CONFIDENTIAL",
    allowedLayers: [
      "EVIDENCE_DOCUMENTS",
      "SEMANTIC_HYBRID",
      "PUBLIC_EXTERNAL",
      "STRUCTURED_STATE",
    ],
    combinationConstraints: [],
    evaluatedAt: "2026-09-07T10:00:00.000Z",
    revalidateAfter: "2026-09-07T10:05:00.000Z",
    revalidateOnResume: true,
    ...overrides,
  } as PermittedContextPlan;
}

const evidenceScope: QAuthorisedKnowledgeScope = {
  kind: "EVIDENCE_DOCUMENTS",
  subject: { kind: "COMPANY", companyId: COMPANY },
  contextLabel: "founder_private",
  sensitivity: "HIGHLY_CONFIDENTIAL",
  layer: "EVIDENCE_DOCUMENTS",
  factCategories: [],
  projection: "FULL",
  rights: {
    canUseForReasoning: true,
    canDiscloseExistence: true,
    canQuote: true,
    canProvideLink: false,
  },
  filter: {
    tenantId: TENANT,
    organisationId: ORG,
    companyId: COMPANY,
    contextLabels: ["founder_private", "organisation_private"],
  },
  isEvidence: true,
};

const networkScope: QAuthorisedKnowledgeScope = {
  kind: "NETWORK_VISIBLE_DATA",
  contextLabel: "network_visible",
  sensitivity: "NETWORK_VISIBLE",
  layer: "SEMANTIC_HYBRID",
  factCategories: [],
  projection: "FULL",
  rights: {
    canUseForReasoning: true,
    canDiscloseExistence: true,
    canQuote: true,
    canProvideLink: true,
  },
  filter: { tenantId: TENANT },
  isEvidence: true,
};

const profileScope: QAuthorisedKnowledgeScope = {
  kind: "COMPANY_PROFILE",
  subject: { kind: "COMPANY", companyId: COMPANY },
  contextLabel: "network_visible",
  sensitivity: "NETWORK_VISIBLE",
  layer: "STRUCTURED_STATE",
  factCategories: ["COMPANY_IDENTITY"],
  projection: "FULL",
  rights: {
    canUseForReasoning: true,
    canDiscloseExistence: true,
    canQuote: true,
    canProvideLink: true,
  },
  filter: { tenantId: TENANT, companyId: COMPANY },
  isEvidence: true,
};

describe("plan → retrieval envelope", () => {
  it("projects only the scopes derived chunks can answer", () => {
    const constraints = retrievalConstraintsFor(
      plan({ scopes: [profileScope, evidenceScope, networkScope] }),
    );
    // COMPANY_PROFILE is canonical structured state. Answering "what stage
    // is the company?" by searching a deck would be a worse answer, not a
    // better one, so it is absent by design rather than unimplemented.
    expect(constraints.map((c) => c.scopeKind)).toEqual([
      "EVIDENCE_DOCUMENTS",
      "NETWORK_VISIBLE_DATA",
    ]);
  });

  it("keeps each scope's labels paired with its own subject", () => {
    const constraints = retrievalConstraintsFor(
      plan({ scopes: [evidenceScope, networkScope] }),
    );
    const evidence = constraints[0];
    const network = constraints[1];
    expect(evidence?.subjectIds).toEqual([COMPANY]);
    expect(evidence?.visibilityScopes).toEqual([
      "founder_private",
      "organisation_private",
    ]);
    // The actor-wide network scope is not narrowed by subject, and carries
    // only the network label. If these two were flattened into one union the
    // actor would gain founder-private access to every company in the
    // tenant — which is exactly the bug the disjunction exists to prevent.
    expect(network?.subjectIds).toBeNull();
    expect(network?.visibilityScopes).toEqual(["network_visible"]);
  });

  it("never lets a scope exceed the run's overall sensitivity ceiling", () => {
    const constraints = retrievalConstraintsFor(
      plan({ scopes: [evidenceScope], maxSensitivity: "INTERNAL" }),
    );
    expect(constraints[0]?.sensitivityCeiling).toBe("INTERNAL");
  });

  it("drops a scope whose layer the plan does not allow", () => {
    const constraints = retrievalConstraintsFor(
      plan({ scopes: [evidenceScope], allowedLayers: ["STRUCTURED_STATE"] }),
    );
    expect(constraints).toEqual([]);
  });

  it("drops a scope policy reduced to an aggregate projection", () => {
    const constraints = retrievalConstraintsFor(
      plan({
        scopes: [{ ...evidenceScope, projection: "AGGREGATE" }],
      }),
    );
    // A chunk is raw material; there is no honest aggregate of one.
    expect(constraints).toEqual([]);
  });

  it("produces a valid, empty envelope when nothing is authorised", () => {
    const envelope = envelopeFromPlan(plan({ scopes: [profileScope] }));
    expect(RetrievalPermissionEnvelopeSchema.safeParse(envelope).success).toBe(
      true,
    );
    expect(envelope.constraints).toEqual([]);
    expect(envelope.tenantId).toBe(TENANT);
    expect(envelope.planFingerprint).toBe("a".repeat(64));
  });

  it("treats an expired plan as no longer current", () => {
    const envelope = envelopeFromPlan(plan({ scopes: [evidenceScope] }));
    expect(envelopeIsCurrent(envelope, new Date("2026-09-07T10:04:59Z"))).toBe(
      true,
    );
    expect(envelopeIsCurrent(envelope, new Date("2026-09-07T10:05:01Z"))).toBe(
      false,
    );
  });

  it("carries a scope's disclosure rights through unchanged", () => {
    const constraints = retrievalConstraintsFor(
      plan({
        scopes: [
          {
            ...evidenceScope,
            rights: {
              canUseForReasoning: true,
              canDiscloseExistence: false,
              canQuote: false,
              canProvideLink: false,
            },
          },
        ],
      }),
    );
    expect(constraints[0]?.canDiscloseExistence).toBe(false);
    expect(constraints[0]?.canQuote).toBe(false);
  });

  it("does not reach a subject the plan did not name", () => {
    const constraints = retrievalConstraintsFor(
      plan({ scopes: [evidenceScope] }),
    );
    expect(constraints[0]?.subjectIds).not.toContain(OTHER_COMPANY);
  });
});

describe("reciprocal rank fusion", () => {
  const lexical = (keys: readonly string[]) =>
    keys.map((key, at) => ({ key, item: key, rank: at + 1 }));

  it("fuses a chunk found by both halves into one entry with both ranks", () => {
    const fused = fuseByReciprocalRank(
      lexical(["a", "b", "c"]),
      lexical(["c", "a", "d"]),
      { rrfK: 60, limit: 10 },
    );
    expect(fused).toHaveLength(4);
    const a = fused.find((f) => f.key === "a");
    expect(a?.lexicalRank).toBe(1);
    expect(a?.semanticRank).toBe(2);
    expect(a?.fusedScore).toBeCloseTo(1 / 61 + 1 / 62, 12);
  });

  it("ranks agreement above either list's single best", () => {
    // "b" is second in both; "a" is first lexically and absent semantically.
    const fused = fuseByReciprocalRank(
      lexical(["a", "b"]),
      lexical(["z", "b"]),
      { rrfK: 60, limit: 10 },
    );
    expect(fused[0]?.key).toBe("b");
  });

  it("keeps a lexical-only and a semantic-only candidate", () => {
    const fused = fuseByReciprocalRank(lexical(["a"]), lexical(["b"]), {
      rrfK: 60,
      limit: 10,
    });
    expect(fused.map((f) => f.key).sort()).toEqual(["a", "b"]);
    expect(fused.find((f) => f.key === "a")?.semanticRank).toBeNull();
    expect(fused.find((f) => f.key === "b")?.lexicalRank).toBeNull();
  });

  it("breaks ties deterministically and identically across runs", () => {
    const once = fuseByReciprocalRank(lexical(["b", "a"]), [], {
      rrfK: 60,
      limit: 10,
    });
    const twice = fuseByReciprocalRank(lexical(["b", "a"]), [], {
      rrfK: 60,
      limit: 10,
    });
    expect(once.map((f) => f.key)).toEqual(twice.map((f) => f.key));
    // Equal scores: the better original rank wins before the key does.
    const tied = fuseByReciprocalRank(
      [{ key: "z", item: "z", rank: 1 }],
      [{ key: "a", item: "a", rank: 1 }],
      { rrfK: 60, limit: 10 },
    );
    expect(tied.map((f) => f.key)).toEqual(["a", "z"]);
  });

  it("honours the fused bound", () => {
    const many = lexical(Array.from({ length: 50 }, (_, i) => `k${String(i)}`));
    expect(
      fuseByReciprocalRank(many, [], { rrfK: 60, limit: 20 }),
    ).toHaveLength(20);
  });

  it("numbers the fused output from one", () => {
    const fused = fuseByReciprocalRank(lexical(["a", "b"]), [], {
      rrfK: 60,
      limit: 10,
    });
    expect(fused.map((f) => f.fusedRank)).toEqual([1, 2]);
  });

  it("returns nothing when both lists are empty", () => {
    expect(fuseByReciprocalRank([], [], { rrfK: 60, limit: 10 })).toEqual([]);
  });

  it("cannot admit a candidate that was in neither list", () => {
    const fused = fuseByReciprocalRank(lexical(["a"]), lexical(["a"]), {
      rrfK: 60,
      limit: 10,
    });
    expect(fused.map((f) => f.key)).toEqual(["a"]);
  });
});

describe("context assembly", () => {
  const hit = (overrides: Partial<RetrievalHit> = {}): RetrievalHit =>
    ({
      chunkId: "88888888-8888-4888-8888-888888888888",
      chunkSetId: "99999999-9999-4999-8999-999999999999",
      documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      documentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentTitle: "Northstar Seed Deck",
      subjectType: "COMPANY",
      subjectId: COMPANY,
      chunkKind: "slide",
      role: "LEAF",
      locator: { slide: 7 },
      content: "The addressable market is estimated at 4.2bn.",
      visibilityScope: "founder_private",
      sensitivityClass: "HIGHLY_CONFIDENTIAL",
      lexicalRank: 1,
      semanticRank: 2,
      fusedRank: 1,
      fusedScore: 0.03,
      scopeKind: "EVIDENCE_DOCUMENTS",
      canDiscloseExistence: true,
      canQuote: true,
      canProvideLink: false,
      parentChunkId: null,
      expandedFromChunkId: null,
      ...overrides,
    }) as RetrievalHit;

  const result = (
    hits: readonly RetrievalHit[],
  ): AuthorisedRetrievalResult => ({
    configVersion: DEFAULT_RETRIEVAL_CONFIG.configVersion,
    requestedStrategy: "HYBRID",
    executedStrategy: "HYBRID",
    degraded: { lexical: "OK", semantic: "OK", reason: null },
    hits,
    diagnostics: {
      lexicalCandidates: 1,
      semanticCandidates: 1,
      fusedCandidates: 1,
      constraintCount: 1,
      queryEmbeddingMs: 5,
      lexicalMs: 2,
      semanticMs: 3,
      fusionMs: 0,
      expansionMs: 0,
      totalMs: 10,
      contextCharacters: 44,
    },
  });

  it("never presents retrieved material as verified", () => {
    const facts = assembleAuthorisedFacts(result([hit()]));
    expect(facts[0]?.truthClass).toBe("USER_CLAIM");
    expect(facts[0]?.evidenceStatus).toBe("DOCUMENT_SUPPORTED");
  });

  it("names the source and the locator when existence may be disclosed", () => {
    expect(describeSource(hit())).toBe("Northstar Seed Deck, slide 7");
  });

  it("withholds the title when existence may not be disclosed", () => {
    const source = describeSource(hit({ canDiscloseExistence: false }));
    expect(source).not.toContain("Northstar");
    expect(source).toBe("an internal source (slide 7)");
  });

  it("carries no score, no rank and no fingerprint into the model's context", () => {
    const facts = assembleAuthorisedFacts(result([hit()]));
    const text = JSON.stringify(facts);
    expect(text).not.toContain("fusedScore");
    expect(text).not.toContain("0.03");
    expect(text).not.toContain("fusedRank");
  });

  it("describes locators for every source shape it can cite", () => {
    expect(describeLocator({ slide: 3, slideTitle: "Market" })).toBe(
      "slide 3 (Market)",
    );
    expect(describeLocator({ pageStart: 4, pageEnd: 6 })).toBe("pages 4-6");
    expect(describeLocator({ sheet: "Model", range: "A1:D20" })).toBe(
      "sheet Model, A1:D20",
    );
    expect(describeLocator({ headingPath: ["Overview", "Risks"] })).toBe(
      'section "Risks"',
    );
    expect(describeLocator({})).toBeNull();
  });

  it("tells the model that an outage is an outage, not an absence of evidence", () => {
    const outage: AuthorisedRetrievalResult = {
      ...result([]),
      degraded: {
        lexical: "UNAVAILABLE",
        semantic: "UNAVAILABLE",
        reason: "LEXICAL_UNAVAILABLE",
      },
    };
    expect(describeRetrieval(outage)).toContain("temporarily unavailable");
    // An empty corpus and a broken index must not read the same to Q: one
    // means "nothing is there", the other means "I could not look".
    expect(describeRetrieval(result([]))).toContain("no authorised source");
  });

  it("says nothing about what was excluded", () => {
    const description = describeRetrieval(result([]));
    expect(description).not.toMatch(/withheld|excluded|restricted|denied/i);
  });
});
