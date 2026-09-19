import { describe, expect, it } from "vitest";

import type { TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { CandidateDiagnostics } from "../src/candidates/contracts.js";
import {
  ELIGIBILITY_CRITERIA,
  type EligibilityResult,
} from "../src/eligibility/contracts.js";
import type { EligibilityPorts } from "../src/eligibility/ports.js";
import { FEATURE_SCHEMA_VERSION } from "../src/features/contracts.js";
import type {
  FeatureSnapshotStore,
  StoredFeatureSnapshotRef,
} from "../src/features/ports.js";
import type {
  HybridCandidate,
  HybridCandidatePool,
} from "../src/hybrid/contracts.js";
import type { HybridCandidateService } from "../src/hybrid/service.js";
import {
  RANKER_VERSION,
  RankedCandidateSchema,
  RankingInputError,
  type RankedCandidate,
} from "../src/ranking/contracts.js";
import type {
  RankCandidatesResult,
  RankingService,
} from "../src/ranking/service.js";
import {
  createSlateBuilder,
  slateFingerprint,
  type SlateBuilderDependencies,
} from "../src/slates/builder.js";
import {
  RecommendationItemSchema,
  RecommendationSlateSchema,
  SLATE_POLICY_V1,
  type NewRecommendationItem,
  type RecommendationItem,
  type RecommendationSlate,
} from "../src/slates/contracts.js";
import {
  SlateBuildInProgressError,
  type SlateKey,
  type SlateRepository,
} from "../src/slates/ports.js";

/**
 * The slate builder over fakes (CQ-REC-006 Checkpoint B): the pipeline's
 * word becomes items verbatim, the fingerprint is a pure function of the
 * inputs, an unchanged fingerprint is a no-op, a failure after the claim
 * leaves a FAILED row and the served slate alone, and nothing private
 * reaches a row.
 */

const MARKER = "REC006_PRIVATE_FOUNDER_DATA_MUST_NOT_CHANGE_SLATE";
const TENANT = "11111111-0000-4000-8000-000000000001";
const ORG = "11111111-0000-4000-8000-000000000002";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const COMPANY_TENANT = "22222222-0000-4000-8000-000000000001";
const id = (n: number) =>
  `44444444-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fp = (c: string) => c.repeat(64);

const actor: ActorContext = {
  userId: "11111111-0000-4000-8000-000000000003",
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "11111111-0000-4000-8000-000000000004",
  actorType: "HUMAN",
};

const eligible = (companyId: string): EligibilityResult => ({
  eligibilityPolicyVersion: "eligibility.v2",
  mode: "INVESTOR_DISCOVER",
  companyId,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
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
  evaluatedAt: "2026-09-19T10:00:00.000Z",
});

const candidate = (n: number): HybridCandidate => ({
  companyId: id(n),
  structured: {
    generatorId: "STRUCTURED_MANDATE",
    generatorVersion: "structured-mandate.v2",
    matchedDimensions: ["STAGE"],
    reasonCodes: ["STAGE_OVERLAP"],
    matchedNodes: [],
    taxonomyVersion: null,
  },
  semantic: null,
  eligibility: eligible(id(n)),
});

const structuredDiagnostics: CandidateDiagnostics = {
  rawHitsByDimension: { STAGE: 3 },
  rawHits: 3,
  deduped: 3,
  truncated: false,
  eligible: 3,
  ineligible: 0,
  undetermined: 0,
  chequeSignal: "NOT_COMPUTABLE",
  durationMs: 1,
};

function pool(
  candidates: readonly HybridCandidate[],
  options: { readonly semanticUnavailable?: string | undefined } = {},
): HybridCandidatePool {
  const unavailable = options.semanticUnavailable;
  return {
    kind: "GENERATED",
    poolVersion: "hybrid-candidate-pool.v1",
    structuredGeneratorVersion: "structured-mandate.v2",
    semanticGeneratorVersion: "semantic-mandate.v1",
    eligibilityPolicyVersion: "eligibility.v2",
    context: {
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      mode: "INVESTOR_DISCOVER",
      mandateId: MANDATE,
      taxonomyVersion: { industry: 2 },
      eligibilityPolicyVersion: "eligibility.v2",
    },
    semanticUnavailable:
      unavailable === undefined
        ? null
        : { failureClass: unavailable, retryable: true },
    candidates: [...candidates],
    diagnostics: {
      structured: structuredDiagnostics,
      semantic:
        unavailable === undefined
          ? {
              topK: 200,
              queryVector: "REUSED",
              investorRepresentation: "UNCHANGED",
              rawHits: 2,
              eligible: 2,
              ineligible: 0,
              undetermined: 0,
              queryDurationMs: 1,
              durationMs: 2,
            }
          : null,
      merged: candidates.length,
      structuredOnly: candidates.length,
      semanticOnly: 0,
      both: 0,
      durationMs: 3,
    },
  };
}

function rankedCandidate(
  companyId: string,
  rank: number,
  fingerprint: string,
  score: number | null = 0.5,
): RankedCandidate {
  return RankedCandidateSchema.parse({
    companyId,
    rank,
    internalScore: score,
    scored: score !== null,
    rankerId: "DETERMINISTIC",
    rankerVersion: RANKER_VERSION,
    rankingConfigVersion: "ranking-config.v1",
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    featureSnapshot: {
      fingerprint,
      mandateVersion: 1,
      companyProjectionVersion: 1,
    },
    candidateProvenance: {
      structured: {
        generatorVersion: "structured-mandate.v2",
        reasonCodes: ["STAGE_OVERLAP"],
      },
      semantic: null,
    },
    factors: [],
    reasonCodes: score === null ? ["NO_SCOREABLE_FEATURES"] : ["STAGE_ALIGNED"],
    diagnostics: {
      configuredWeight: 1,
      availableWeight: score === null ? 0 : 1,
      factorCoverage: score === null ? 0 : 1,
      presentFactorCount: score === null ? 0 : 1,
      missingFactorCount: score === null ? 1 : 0,
      notApplicableFactorCount: 0,
    },
  });
}

function rankedResult(
  ranked: readonly RankedCandidate[],
): RankCandidatesResult {
  const scored = ranked.filter((r) => r.scored).length;
  return {
    kind: "RANKED",
    ranked,
    diagnostics: {
      rankerId: "DETERMINISTIC",
      rankerVersion: RANKER_VERSION,
      rankingConfigVersion: "ranking-config.v1",
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      candidates: ranked.length,
      scored,
      unscored: ranked.length - scored,
      factorsMissing: 0,
      rankDurationMs: 1,
      features: {
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        candidates: ranked.length,
        withoutProjection: 0,
        featureValues: ranked.length * 6,
        present: ranked.length * 6,
        missing: 0,
        notApplicable: 0,
        scopeViolations: 0,
        reused: 0,
        superseded: 0,
        inserted: ranked.length,
        queries: 6,
        computeDurationMs: 1,
        persistDurationMs: 1,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// An in-memory slate store with the lifecycle rules of the real one.
// ---------------------------------------------------------------------------

type Stored = { slate: RecommendationSlate; items: RecommendationItem[] };

function memorySlates(options: { readonly failPublish?: boolean } = {}) {
  const rows = new Map<string, Stored>();
  let n = 0;
  const nextId = () =>
    `55555555-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
  const sameKey = (s: RecommendationSlate, key: SlateKey) =>
    s.tenantId === key.tenantId &&
    s.investorOrganisationId === key.investorOrganisationId &&
    s.mandateId === key.mandateId &&
    s.mode === key.mode;
  const byStatus = (key: SlateKey, status: string) =>
    [...rows.values()].find(
      (r) => sameKey(r.slate, key) && r.slate.status === status,
    );
  const repo: SlateRepository = {
    beginBuild: (input) => {
      if (byStatus(input, "BUILDING") !== undefined) {
        return Promise.reject(new SlateBuildInProgressError());
      }
      const slate = RecommendationSlateSchema.parse({
        id: nextId(),
        tenantId: input.tenantId,
        investorOrganisationId: input.investorOrganisationId,
        mandateId: input.mandateId,
        mandateVersion: input.mandateVersion,
        mode: input.mode,
        status: "BUILDING",
        ...input.versions,
        generationFingerprint: null,
        itemCount: 0,
        diagnostics: null,
        generatedAt: input.generatedAt,
        publishedAt: null,
        expiresAt: null,
        invalidatedAt: null,
        invalidationReason: null,
        supersededAt: null,
        supersedesSlateId: null,
        failureCode: null,
      });
      rows.set(slate.id, { slate, items: [] });
      return Promise.resolve(slate);
    },
    insertItems: (
      slateId,
      _tenantId,
      items: readonly NewRecommendationItem[],
    ) => {
      const row = rows.get(slateId);
      if (row === undefined || row.slate.status !== "BUILDING") {
        return Promise.reject(new Error("items only while BUILDING"));
      }
      for (const item of items) {
        row.items.push(
          RecommendationItemSchema.parse({
            ...item,
            id: nextId(),
            slateId,
            createdAt: row.slate.generatedAt,
          }),
        );
      }
      return Promise.resolve(items.length);
    },
    publish: (_transactions, input) => {
      if (options.failPublish === true) {
        return Promise.reject(new Error("publish exploded"));
      }
      const row = rows.get(input.slateId);
      if (row === undefined || row.slate.status !== "BUILDING") {
        return Promise.reject(new Error("not BUILDING"));
      }
      const previous = byStatus(row.slate, "CURRENT");
      if (previous !== undefined) {
        previous.slate = {
          ...previous.slate,
          status: "SUPERSEDED",
          supersededAt: input.publishedAt,
        };
      }
      row.slate = {
        ...row.slate,
        status: "CURRENT",
        generationFingerprint: input.generationFingerprint,
        itemCount: input.itemCount,
        diagnostics: input.diagnostics,
        publishedAt: input.publishedAt,
        expiresAt: input.expiresAt,
        supersedesSlateId: previous?.slate.id ?? null,
      };
      return Promise.resolve({
        slate: row.slate,
        supersededSlateId: previous?.slate.id ?? null,
      });
    },
    fail: (slateId, failureCode) => {
      const row = rows.get(slateId);
      if (row !== undefined && row.slate.status === "BUILDING") {
        row.slate = { ...row.slate, status: "FAILED", failureCode };
      }
      return Promise.resolve();
    },
    invalidate: () => Promise.resolve(false),
    expire: () => Promise.resolve(false),
    findById: (slateId) => Promise.resolve(rows.get(slateId)?.slate ?? null),
    findCurrent: (key) =>
      Promise.resolve(byStatus(key, "CURRENT")?.slate ?? null),
    findCurrentContaining: () => Promise.resolve([]),
    findCurrentForInvestor: () => Promise.resolve([]),
    pageItems: (input) =>
      Promise.resolve(
        (rows.get(input.slateId)?.items ?? [])
          .filter((i) => i.rank > input.afterRank)
          .sort((a, b) => a.rank - b.rank)
          .slice(0, input.limit),
      ),
    listHistory: (key) =>
      Promise.resolve(
        [...rows.values()]
          .filter((r) => sameKey(r.slate, key))
          .map((r) => r.slate),
      ),
  };
  return { repo, rows };
}

const transactions: TransactionManager = {
  run: () =>
    Promise.reject(new Error("the fake store publishes without a transaction")),
};

function ports(
  lookup: "FOUND" | "NONE" = "FOUND",
  investor: boolean = true,
): SlateBuilderDependencies["ports"] {
  return {
    investorSubject: {
      investorOrganisationFor: () =>
        Promise.resolve(investor ? { investorOrganisationId: INVESTOR } : null),
    },
    mandates: {
      activeMandate: () =>
        Promise.resolve(
          lookup === "NONE"
            ? { kind: "NONE" }
            : {
                kind: "FOUND",
                mandate: {
                  mandateId: MANDATE,
                  investorOrganisationId: INVESTOR,
                  version: 1,
                  status: "ACTIVE",
                  constraints: [],
                  taxonomyPreferences: [],
                },
              },
        ),
    },
    taxonomyVersions: {
      currentVersions: () => Promise.resolve({ industry: 2 }),
    },
  } satisfies Partial<EligibilityPorts>;
}

function refsFor(
  ranked: readonly RankedCandidate[],
  override: Partial<Record<string, StoredFeatureSnapshotRef | null>> = {},
): FeatureSnapshotStore {
  return {
    currentFor: (input) => {
      const out = new Map<string, StoredFeatureSnapshotRef>();
      for (const r of ranked) {
        if (!input.companyIds.includes(r.companyId)) continue;
        const o = override[r.companyId];
        if (o === null) continue;
        out.set(
          r.companyId,
          o ?? {
            id: `66666666-0000-4000-8000-${r.companyId.slice(-12)}`,
            companyTenantId: COMPANY_TENANT,
            fingerprint: r.featureSnapshot.fingerprint,
          },
        );
      }
      return Promise.resolve(out);
    },
    supersede: () => Promise.resolve(),
    insertMany: () => Promise.resolve([]),
  };
}

type Scenario = {
  readonly pool?: HybridCandidatePool;
  readonly ranked?: readonly RankedCandidate[];
  readonly ranking?: RankingService;
  readonly snapshots?: FeatureSnapshotStore;
  readonly lookup?: "FOUND" | "NONE";
  readonly investor?: boolean;
  readonly failPublish?: boolean;
  readonly now?: () => Date;
};

const THREE = [candidate(1), candidate(2), candidate(3)];
const RANKED_THREE = [
  rankedCandidate(id(1), 1, fp("a"), 0.9),
  rankedCandidate(id(2), 2, fp("b"), 0.4),
  rankedCandidate(id(3), 3, fp("c"), null),
];

function scenario(s: Scenario = {}) {
  const ranked = s.ranked ?? RANKED_THREE;
  const hybrid: HybridCandidateService = {
    generate: () => Promise.resolve(s.pool ?? pool(THREE)),
  };
  const ranking: RankingService = s.ranking ?? {
    rankCandidates: () => Promise.resolve(rankedResult(ranked)),
  };
  const store = memorySlates({ failPublish: s.failPublish ?? false });
  const builder = createSlateBuilder({
    ports: ports(s.lookup, s.investor),
    hybrid,
    ranking,
    snapshots: s.snapshots ?? refsFor(ranked),
    slates: store.repo,
    transactions,
    clock: s.now ?? (() => new Date("2026-09-19T10:00:00.000Z")),
  });
  return { builder, store };
}

const query = { actor, mode: "INVESTOR_DISCOVER" as const };

describe("slate builder (CQ-REC-006)", () => {
  it("publishes the pipeline's order verbatim: rank, score, reason codes and the exact stored snapshot", async () => {
    const { builder, store } = scenario();
    const result = await builder.build(query);
    expect(result.kind).toBe("PUBLISHED");
    if (result.kind !== "PUBLISHED") return;
    expect(result.slate.status).toBe("CURRENT");
    expect(result.slate.itemCount).toBe(3);
    expect(result.slate.generationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.slate.semanticGeneratorVersion).toBe("semantic-mandate.v1");
    expect(result.slate.rankingConfigVersion).toBe("ranking-config.v1");
    expect(result.slate.taxonomyVersion).toEqual({ industry: 2 });
    expect(result.slate.expiresAt).toBe(
      new Date(
        Date.parse("2026-09-19T10:00:00.000Z") + SLATE_POLICY_V1.ttlMs,
      ).toISOString(),
    );
    expect(result.diagnostics).toMatchObject({
      structuredCandidates: 3,
      semanticCandidates: 2,
      semanticUnavailable: false,
      mergedCandidates: 3,
      featureSnapshots: 3,
      ranked: 3,
      scored: 2,
    });
    const items = store.rows.get(result.slate.id)?.items ?? [];
    expect(items.map((i) => [i.rank, i.companyId, i.internalScore])).toEqual([
      [1, id(1), 0.9],
      [2, id(2), 0.4],
      [3, id(3), null],
    ]);
    expect(items[0]?.featureSnapshotFingerprint).toBe(fp("a"));
    expect(items[0]?.featureSnapshotId).toBe(
      `66666666-0000-4000-8000-${id(1).slice(-12)}`,
    );
    expect(items[0]?.companyTenantId).toBe(COMPANY_TENANT);
    expect(items[2]?.reasonCodes).toEqual(["NO_SCOREABLE_FEATURES"]);
  });

  it("is a no-op while the CURRENT slate has the same fingerprint, and republishes it once expired", async () => {
    let now = new Date("2026-09-19T10:00:00.000Z");
    const { builder, store } = scenario({ now: () => now });
    const first = await builder.build(query);
    const again = await builder.build(query);
    expect(again.kind).toBe("UNCHANGED");
    if (first.kind !== "PUBLISHED" || again.kind !== "UNCHANGED") return;
    expect(again.slate.id).toBe(first.slate.id);
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(store.rows.size).toBe(1);

    now = new Date(
      Date.parse("2026-09-19T10:00:00.000Z") + SLATE_POLICY_V1.ttlMs + 1,
    );
    const later = await builder.build(query);
    expect(later.kind).toBe("PUBLISHED");
    if (later.kind !== "PUBLISHED") return;
    expect(later.fingerprint).toBe(first.fingerprint);
    expect(later.supersededSlateId).toBe(first.slate.id);
    expect(store.rows.get(first.slate.id)?.slate.status).toBe("SUPERSEDED");
  });

  it("a changed order is a new slate that supersedes the previous one; the old items stay", async () => {
    const { builder, store } = scenario();
    const first = await builder.build(query);
    if (first.kind !== "PUBLISHED") throw new Error(first.kind);
    const swapped = scenario({
      ranked: [
        rankedCandidate(id(2), 1, fp("b"), 0.8),
        rankedCandidate(id(1), 2, fp("a"), 0.7),
        rankedCandidate(id(3), 3, fp("c"), null),
      ],
    });
    // Same store, new ranking.
    const builder2 = createSlateBuilder({
      ports: ports(),
      hybrid: { generate: () => Promise.resolve(pool(THREE)) },
      ranking: {
        rankCandidates: () =>
          Promise.resolve(
            rankedResult([
              rankedCandidate(id(2), 1, fp("b"), 0.8),
              rankedCandidate(id(1), 2, fp("a"), 0.7),
              rankedCandidate(id(3), 3, fp("c"), null),
            ]),
          ),
      },
      snapshots: refsFor([
        rankedCandidate(id(2), 1, fp("b"), 0.8),
        rankedCandidate(id(1), 2, fp("a"), 0.7),
        rankedCandidate(id(3), 3, fp("c"), null),
      ]),
      slates: store.repo,
      transactions,
      clock: () => new Date("2026-09-19T11:00:00.000Z"),
    });
    void swapped;
    void builder;
    const second = await builder2.build(query);
    expect(second.kind).toBe("PUBLISHED");
    if (second.kind !== "PUBLISHED") return;
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.supersededSlateId).toBe(first.slate.id);
    expect(second.slate.supersedesSlateId).toBe(first.slate.id);
    expect(store.rows.get(first.slate.id)?.slate.status).toBe("SUPERSEDED");
    expect(store.rows.get(first.slate.id)?.items.length).toBe(3);
  });

  it("a degraded semantic generator yields a structured-only slate that says so, with its own fingerprint", async () => {
    const full = await scenario().builder.build(query);
    const degraded = await scenario({
      pool: pool(THREE, { semanticUnavailable: "TIMEOUT" }),
    }).builder.build(query);
    expect(degraded.kind).toBe("PUBLISHED");
    if (degraded.kind !== "PUBLISHED" || full.kind !== "PUBLISHED") return;
    expect(degraded.slate.semanticGeneratorVersion).toBeNull();
    expect(degraded.diagnostics.semanticUnavailable).toBe(true);
    expect(degraded.diagnostics.semanticCandidates).toBe(0);
    expect(degraded.fingerprint).not.toBe(full.fingerprint);
  });

  it("a stored snapshot that is not the ranked one fails the build; the served slate is untouched", async () => {
    const { builder, store } = scenario();
    const first = await builder.build(query);
    if (first.kind !== "PUBLISHED") throw new Error(first.kind);
    const mismatched = createSlateBuilder({
      ports: ports(),
      hybrid: { generate: () => Promise.resolve(pool(THREE)) },
      ranking: {
        rankCandidates: () => Promise.resolve(rankedResult(RANKED_THREE)),
      },
      snapshots: refsFor(RANKED_THREE, {
        [id(2)]: {
          id: id(9),
          companyTenantId: COMPANY_TENANT,
          fingerprint: fp("f"),
        },
      }),
      slates: store.repo,
      transactions,
      clock: () => new Date("2026-09-19T11:00:00.000Z"),
    });
    const result = await mismatched.build(query);
    expect(result.kind).toBe("FAILED");
    if (result.kind !== "FAILED") return;
    expect(result.failureCode).toBe("FINGERPRINT_MISMATCH");
    expect(result.slateId).not.toBeNull();
    expect(store.rows.get(result.slateId ?? "")?.slate.status).toBe("FAILED");
    expect(store.rows.get(result.slateId ?? "")?.slate.failureCode).toBe(
      "FINGERPRINT_MISMATCH",
    );
    expect(store.rows.get(first.slate.id)?.slate.status).toBe("CURRENT");
  });

  it("a missing snapshot, a ranker refusal and a publish failure each leave a FAILED row under a bounded code", async () => {
    const missing = scenario({
      snapshots: refsFor(RANKED_THREE, { [id(3)]: null }),
    });
    const m = await missing.builder.build(query);
    expect(m).toMatchObject({
      kind: "FAILED",
      failureCode: "SNAPSHOT_MISSING",
    });

    const refused = scenario({
      ranking: {
        rankCandidates: () =>
          Promise.reject(
            new RankingInputError(
              "ELIGIBILITY_POLICY_MISMATCH",
              id(1),
              "stale policy",
            ),
          ),
      },
    });
    const r = await refused.builder.build(query);
    expect(r).toMatchObject({ kind: "FAILED", failureCode: "RANKER_REFUSED" });
    expect([...refused.store.rows.values()].map((x) => x.slate.status)).toEqual(
      ["FAILED"],
    );

    const exploded = scenario({ failPublish: true });
    const p = await exploded.builder.build(query);
    expect(p).toMatchObject({ kind: "FAILED", failureCode: "PUBLISH_FAILED" });
    expect(
      [...exploded.store.rows.values()].map((x) => x.slate.status),
    ).toEqual(["FAILED"]);
    expect(
      await exploded.store.repo.findCurrent({
        tenantId: TENANT,
        investorOrganisationId: INVESTOR,
        mandateId: MANDATE,
        mode: "INVESTOR_DISCOVER",
      }),
    ).toBeNull();
  });

  it("stands down while another build holds the claim, and reports NO_ACTIVE_MANDATE / NOT_AN_INVESTOR without touching the store", async () => {
    const { builder, store } = scenario();
    await store.repo.beginBuild({
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      mandateId: MANDATE,
      mode: "INVESTOR_DISCOVER",
      mandateVersion: 1,
      versions: {
        eligibilityPolicyVersion: "eligibility.v2",
        structuredGeneratorVersion: "structured-mandate.v2",
        semanticGeneratorVersion: "semantic-mandate.v1",
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        rankerVersion: RANKER_VERSION,
        rankingConfigVersion: "ranking-config.v1",
        taxonomyVersion: null,
      },
      generatedAt: "2026-09-19T09:00:00.000Z",
    });
    const busy = await builder.build(query);
    expect(busy.kind).toBe("BUILD_IN_PROGRESS");
    expect(store.rows.size).toBe(1);

    const none = scenario({ lookup: "NONE" });
    expect(await none.builder.build(query)).toEqual({
      kind: "NO_ACTIVE_MANDATE",
    });
    expect(none.store.rows.size).toBe(0);
    const outsider = scenario({ investor: false });
    expect(await outsider.builder.build(query)).toEqual({
      kind: "NOT_AN_INVESTOR",
    });
    expect(outsider.store.rows.size).toBe(0);
  });

  it("the fingerprint is a pure function of the key, versions and ranked items — never a time, an id or a count", () => {
    const key: SlateKey = {
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      mandateId: MANDATE,
      mode: "INVESTOR_DISCOVER",
    };
    const versions = {
      eligibilityPolicyVersion: "eligibility.v2" as const,
      structuredGeneratorVersion: "structured-mandate.v2" as const,
      semanticGeneratorVersion: "semantic-mandate.v1" as const,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      rankerVersion: RANKER_VERSION,
      rankingConfigVersion: "ranking-config.v1",
      taxonomyVersion: { industry: 2, geography: 1 },
    };
    const items = [
      { companyId: id(1), rank: 1, featureSnapshotFingerprint: fp("a") },
      { companyId: id(2), rank: 2, featureSnapshotFingerprint: fp("b") },
    ];
    const a = slateFingerprint({ key, mandateVersion: 1, versions, items });
    const b = slateFingerprint({
      key,
      mandateVersion: 1,
      versions: { ...versions, taxonomyVersion: { geography: 1, industry: 2 } },
      items: items.map((i) => ({ ...i })),
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(
      slateFingerprint({ key, mandateVersion: 2, versions, items }),
    ).not.toBe(a);
    expect(
      slateFingerprint({
        key,
        mandateVersion: 1,
        versions: { ...versions, semanticGeneratorVersion: null },
        items,
      }),
    ).not.toBe(a);
    expect(
      slateFingerprint({
        key,
        mandateVersion: 1,
        versions,
        items: [...items].reverse().map((i, n) => ({ ...i, rank: n + 1 })),
      }),
    ).not.toBe(a);
  });

  it(`${MARKER}: text outside the contract never reaches a slate or its fingerprint`, async () => {
    const clean = await scenario().builder.build(query);
    const tainted = scenario({
      pool: {
        ...pool(THREE),
        candidates: THREE.map((c) => ({
          ...c,
          eligibility: { ...c.eligibility, reasonCodes: [] },
        })),
      },
    });
    const withMarker = await tainted.builder.build(query);
    expect(withMarker.kind).toBe("PUBLISHED");
    if (clean.kind !== "PUBLISHED" || withMarker.kind !== "PUBLISHED") return;
    expect(withMarker.fingerprint).toBe(clean.fingerprint);
    const persisted = JSON.stringify([...tainted.store.rows.values()]);
    expect(persisted).not.toContain(MARKER);
    expect(JSON.stringify(withMarker)).not.toContain(MARKER);
    // The degraded-run failure class is bounded text the slate never stores.
    const degraded = scenario({
      pool: pool(THREE, { semanticUnavailable: MARKER.slice(0, 60) }),
    });
    const d = await degraded.builder.build(query);
    expect(JSON.stringify([...degraded.store.rows.values()])).not.toContain(
      "REC006_PRIVATE",
    );
    expect(JSON.stringify(d)).not.toContain("REC006_PRIVATE");
  });
});
