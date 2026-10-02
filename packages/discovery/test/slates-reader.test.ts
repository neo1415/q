import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  ELIGIBILITY_CRITERIA,
  type EligibilityResult,
} from "../src/eligibility/contracts.js";
import type { EligibilityService } from "../src/eligibility/service.js";
import { FEATURE_SCHEMA_VERSION } from "../src/features/contracts.js";
import { RANKER_VERSION } from "../src/ranking/contracts.js";
import { createProactiveSuppression } from "../src/rerank/suppression.js";
import {
  decodeSlateCursor,
  encodeSlateCursor,
  SLATE_POLICY_V1,
} from "../src/slates/contracts.js";
import type {
  CompanyCard,
  CompanyCardPort,
  DiscoverablePoolPort,
  SlateKey,
} from "../src/slates/ports.js";
import {
  createSlateReadService,
  SlateCursorRejectedError,
  type SlateReadServiceDependencies,
} from "../src/slates/reader.js";
import type {
  RefreshRequester,
  RequestRefreshInput,
} from "../src/slates/refresh.js";
import { compareAmounts } from "../src/slates/filters.js";
import { memorySlates } from "./support/memory-slates.js";

/**
 * Serving a slate over fakes (CQ-REC-006 Checkpoint D): pages follow
 * (slate, rank), the cursor is opaque and never authority, the read-time
 * guard withholds what REC-001 no longer allows, an unservable slate
 * restarts honestly, a missing slate asks for a rebuild, and nothing
 * internal reaches a page.
 */

const MARKER = "REC006_PRIVATE_FOUNDER_DATA_MUST_NOT_CHANGE_SLATE";
const TENANT = "11111111-0000-4000-8000-000000000001";
const ORG = "11111111-0000-4000-8000-000000000002";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const OTHER_INVESTOR = "11111111-0000-4000-8000-000000000014";
const OTHER_MANDATE = "33333333-0000-4000-8000-000000000032";
const COMPANY_TENANT = "22222222-0000-4000-8000-000000000001";
const id = (n: number) =>
  `44444444-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-09-19T12:00:00.000Z");

const actor: ActorContext = ActorContextSchema.parse({
  userId: "11111111-0000-4000-8000-000000000003",
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "11111111-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});
const KEY: SlateKey = {
  tenantId: TENANT,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
  mode: "INVESTOR_DISCOVER",
};

const VERSIONS = {
  eligibilityPolicyVersion: "eligibility.v3" as const,
  structuredGeneratorVersion: "structured-mandate.v5" as const,
  semanticGeneratorVersion: "semantic-mandate.v1" as const,
  featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  rankerVersion: RANKER_VERSION,
  rankingConfigVersion: "ranking-config.v1",
  taxonomyVersion: null,
};

async function publish(
  store: ReturnType<typeof memorySlates>,
  key: SlateKey,
  count: number,
  options: { readonly expiresAt?: string; readonly publishedAt?: string } = {},
) {
  const slate = await store.repo.beginBuild({
    ...key,
    mandateVersion: 1,
    versions: VERSIONS,
    generatedAt: "2026-09-19T09:00:00.000Z",
  });
  await store.repo.insertItems(
    slate.id,
    key.tenantId,
    Array.from({ length: count }, (_, index) => ({
      companyId: id(index + 1),
      companyTenantId: COMPANY_TENANT,
      rank: index + 1,
      internalScore: 0.9 - index * 0.1,
      reasonCodes: ["STAGE_ALIGNED", "FACTOR_MISSING"],
      featureSnapshotId: "66666666-0000-4000-8000-000000000001",
      featureSnapshotFingerprint: "a".repeat(64),
      candidateProvenance: {
        structured: {
          generatorVersion: "structured-mandate.v5",
          reasonCodes: ["STAGE_OVERLAP"],
        },
        semantic: null,
      },
    })),
  );
  const published = await store.repo.publish(
    { run: () => Promise.reject(new Error("unused")) },
    {
      slateId: slate.id,
      generationFingerprint: "b".repeat(64),
      itemCount: count,
      diagnostics: {
        structuredCandidates: count,
        semanticCandidates: 0,
        semanticUnavailable: false,
        mergedCandidates: count,
        featureSnapshots: count,
        ranked: count,
        scored: count,
        buildDurationMs: 1,
      },
      publishedAt: options.publishedAt ?? "2026-09-19T10:00:00.000Z",
      expiresAt: options.expiresAt ?? "2026-09-20T10:00:00.000Z",
    },
  );
  return published.slate;
}

const eligible = (
  companyId: string,
  decision: EligibilityResult["decision"],
): EligibilityResult => ({
  eligibilityPolicyVersion: "eligibility.v3",
  mode: "INVESTOR_DISCOVER",
  companyId,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
  mandateVersion: 1,
  taxonomyVersion: null,
  decision,
  reasonCodes:
    decision === "ELIGIBLE" ? [] : ["COMPANY_NOT_DISCOVERABLE_BY_INVESTOR"],
  criteria: ELIGIBILITY_CRITERIA.map((criterion) => ({
    criterion,
    outcome: decision === "ELIGIBLE" ? ("PASS" as const) : ("FAIL" as const),
    reasonCode: null,
    detail: null,
  })),
  evaluatedAt: NOW.toISOString(),
});

/** The same result with the stage exclusion FAILing or unanswerable. */
function withStage(
  r: EligibilityResult,
  outcome: "FAIL" | "UNKNOWN",
): EligibilityResult {
  return {
    ...r,
    decision: outcome === "FAIL" ? "INELIGIBLE" : "ELIGIBLE",
    reasonCodes: [
      outcome === "FAIL"
        ? "STAGE_OUTSIDE_HARD_MANDATE"
        : "COMPANY_STAGE_UNKNOWN",
    ],
    criteria: r.criteria.map((c) =>
      c.criterion === "HARD_EXCLUSION_STAGE"
        ? {
            ...c,
            outcome,
            reasonCode:
              outcome === "FAIL"
                ? "STAGE_OUTSIDE_HARD_MANDATE"
                : "COMPANY_STAGE_UNKNOWN",
          }
        : c,
    ),
  };
}

function harness(
  options: {
    readonly ineligible?: readonly string[];
    readonly requester?: boolean;
    readonly cards?: readonly string[];
    readonly investor?: boolean;
    readonly mandate?: "FOUND" | "NONE";
    /** BILLING-2: the plan's recommendation volume (a rank cut). */
    readonly volume?: number | null;
    /** Companies this organisation has passed on (CQ-REC-009R). */
    readonly passed?: readonly string[];
    /** A proven reason to offer one of them again; nothing produces one in V1. */
    readonly reintroduce?: Readonly<
      Record<string, string | { reason: string; change: string | null }>
    >;
    /** What is discoverable at all (ADR 0020); nothing by default. */
    readonly pool?: {
      readonly discoverable: number;
      readonly latestChangeAt?: string | null;
      readonly sample?: readonly string[];
    };
    /** Companies a declared stage exclusion removes (a positive match). */
    readonly stageExcluded?: readonly string[];
    /** Companies whose stage is unknown under a declared stage exclusion. */
    readonly stageUnknown?: readonly string[];
    /** The mandate declares an exclusion V1 cannot evaluate (red_flag). */
    readonly redFlag?: boolean;
    /** Per-company declared card facts; NG / seed otherwise. */
    readonly cardFacts?: Readonly<
      Record<
        string,
        {
          readonly country?: string | null;
          readonly stage?: string | null;
        }
      >
    >;
    /** Discover filter facts (ux/discover-filters). */
    readonly filterFacts?: SlateReadServiceDependencies["filterFacts"];
  } = {},
) {
  const store = memorySlates();
  let now = NOW;
  const evaluated: string[][] = [];
  const suppressionAsked: string[][] = [];
  const eligibility: EligibilityService = {
    qualifiesForInvestor: () => Promise.resolve(false),
    evaluate: (query) => {
      evaluated.push([...query.companyIds]);
      return Promise.resolve({
        context: {
          tenantId: TENANT,
          investorOrganisationId: INVESTOR,
          mode: "INVESTOR_DISCOVER",
          mandateId: MANDATE,
          taxonomyVersion: null,
          eligibilityPolicyVersion: "eligibility.v3",
        },
        results: query.companyIds.map((companyId) => {
          if ((options.stageExcluded ?? []).includes(companyId)) {
            return withStage(eligible(companyId, "ELIGIBLE"), "FAIL");
          }
          if ((options.stageUnknown ?? []).includes(companyId)) {
            return withStage(eligible(companyId, "ELIGIBLE"), "UNKNOWN");
          }
          return eligible(
            companyId,
            (options.ineligible ?? []).includes(companyId)
              ? "INELIGIBLE"
              : "ELIGIBLE",
          );
        }),
      });
    },
  };
  const cards: CompanyCardPort = {
    cardsByIds: (ids) =>
      Promise.resolve(
        new Map<string, CompanyCard>(
          ids
            .filter(
              (c) => options.cards === undefined || options.cards.includes(c),
            )
            .map((companyId) => [
              companyId,
              {
                companyId,
                canonicalName: `Company ${companyId.slice(-2)}`,
                websiteUrl: null,
                headquartersCountry:
                  options.cardFacts?.[companyId]?.country === undefined
                    ? "NG"
                    : options.cardFacts[companyId].country,
                currentStageCode:
                  options.cardFacts?.[companyId]?.stage === undefined
                    ? "seed"
                    : options.cardFacts[companyId].stage,
                shortDescription: `${MARKER.slice(0, 6)}-free description`,
              },
            ]),
        ),
      ),
  };
  const requested: RequestRefreshInput[] = [];
  const requester: RefreshRequester = {
    request: (input) => {
      requested.push(input);
      return Promise.resolve({
        kind: "ENQUEUED",
        request: {
          id: "77777777-0000-4000-8000-000000000001",
          tenantId: input.tenantId,
          investorOrganisationId: input.investorOrganisationId,
          mandateId: input.mandateId,
          mode: input.mode,
          status: "PENDING",
          priority: input.priority,
          reason: input.reason,
          requestSequence: 1,
          claimedSequence: null,
          attempts: 0,
        },
      });
    },
  };
  const ports: SlateReadServiceDependencies["ports"] = {
    investorSubject: {
      investorOrganisationFor: () =>
        Promise.resolve(
          options.investor === false
            ? null
            : { investorOrganisationId: INVESTOR },
        ),
    },
    mandates: {
      activeMandate: () =>
        Promise.resolve(
          options.mandate === "NONE"
            ? { kind: "NONE" }
            : {
                kind: "FOUND",
                mandate: {
                  mandateId: MANDATE,
                  investorOrganisationId: INVESTOR,
                  version: 1,
                  status: "ACTIVE",
                  constraints:
                    options.redFlag === true
                      ? [
                          {
                            dimension: "red_flag",
                            operator: "IN",
                            value: { kind: "codes", values: ["litigation"] },
                            importance: "HARD_EXCLUSION",
                            isHardExclusion: true,
                            automatedUse: "ELIGIBLE",
                          },
                        ]
                      : [],
                  taxonomyPreferences: [],
                },
              },
        ),
    },
  };
  const poolAsked: string[] = [];
  const pool: DiscoverablePoolPort = {
    summary: (input) => {
      poolAsked.push(input.excludeOrganisationId);
      return Promise.resolve({
        discoverable: options.pool?.discoverable ?? 0,
        latestChangeAt: options.pool?.latestChangeAt ?? null,
        sampleCompanyIds: options.pool?.sample ?? [],
      });
    },
  };
  // The real rule over a fake store of interaction state, so what the
  // reader withholds is decided by the same code the build uses.
  const passed = new Set(options.passed ?? []);
  const suppression = createProactiveSuppression({
    signals: {
      forCompanies: (q) => {
        suppressionAsked.push([...q.companyIds]);
        return Promise.resolve(
          new Map(
            q.companyIds.map((companyId) => [
              companyId,
              {
                exposed: true,
                lastSeenAt: null,
                passed: passed.has(companyId),
              },
            ]),
          ),
        );
      },
    },
    ...(options.reintroduce === undefined
      ? {}
      : {
          reintroductions: {
            reasonsFor: (q) =>
              Promise.resolve(
                new Map(
                  q.companyIds
                    .filter((c) => options.reintroduce?.[c] !== undefined)
                    .map((c) => [c, options.reintroduce?.[c] ?? ""]),
                ),
              ),
          },
        }),
  });
  const reader = createSlateReadService({
    ports,
    eligibility,
    suppression,
    slates: store.repo,
    cards,
    pool,
    requester: options.requester === false ? undefined : requester,
    filterFacts: options.filterFacts,
    ...(options.volume === undefined
      ? {}
      : { volume: () => Promise.resolve(options.volume ?? null) }),
    clock: () => now,
  });
  return {
    store,
    reader,
    evaluated,
    suppressionAsked,
    requested,
    poolAsked,
    setNow: (next: Date) => {
      now = next;
    },
  };
}

describe("slate reader (CQ-REC-006)", () => {
  it("pages by (slate, rank) with an opaque continuation key, and exposes cards and public alignment codes only", async () => {
    const h = harness();
    const slate = await publish(h.store, KEY, 5);
    const first = await h.reader.pageCompanies({ actor, limit: 2 });
    expect(first.slateId).toBe(slate.id);
    expect(first.rankingVersion).toBe("ranking-config.v1");
    expect(first.items.map((i) => i.companyId)).toEqual([id(1), id(2)]);
    expect(first.items[0]).toEqual({
      companyId: id(1),
      canonicalName: "Company 01",
      websiteUrl: null,
      headquartersCountry: "NG",
      currentStageCode: "seed",
      shortDescription: "REC006-free description",
      reasonCodes: ["STAGE_ALIGNED"],
      unverifiedExclusions: [],
    });
    expect(first.notes).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const cursor = decodeSlateCursor(first.nextCursor ?? "");
    expect(cursor).toEqual({ v: 1, slateId: slate.id, afterRank: 2 });
    // Nothing internal, whatever the shape of the page.
    const text = JSON.stringify(first);
    for (const forbidden of [
      "internalScore",
      "featureSnapshot",
      "candidateProvenance",
      "fingerprint",
      "FACTOR_MISSING",
      'rank"',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain(MARKER);

    const second = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((i) => i.companyId)).toEqual([id(3), id(4)]);
    const third = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.items.map((i) => i.companyId)).toEqual([id(5)]);
    expect(third.nextCursor).toBeNull();
    // Page size is bounded by the policy, never by the caller.
    const big = await h.reader.pageCompanies({ actor, limit: 999 });
    expect(big.items.length).toBe(5);
    expect(
      h.evaluated.every((ids) => ids.length <= SLATE_POLICY_V1.pageSizeMax),
    ).toBe(true);
    // One eligibility batch per page.
    expect(h.evaluated.length).toBe(4);
  });

  it("the read-time guard withholds a company REC-001 no longer allows, and one without a declared card", async () => {
    const h = harness({ ineligible: [id(2)], cards: [id(1), id(2), id(4)] });
    await publish(h.store, KEY, 4);
    const page = await h.reader.pageCompanies({ actor, limit: 4 });
    expect(page.items.map((i) => i.companyId)).toEqual([id(1), id(4)]);
    expect(page.nextCursor).toBeNull();
    // The guard saw the whole page: withholding is a filter, not a re-rank.
    expect(h.evaluated[0]).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it("a cursor is not authority: another investor's slate, a forged value and a stale format are all refused alike", async () => {
    const h = harness();
    await publish(h.store, KEY, 2);
    const theirs = await publish(
      h.store,
      {
        ...KEY,
        investorOrganisationId: OTHER_INVESTOR,
        mandateId: OTHER_MANDATE,
      },
      2,
    );
    await expect(
      h.reader.pageCompanies({
        actor,
        cursor: encodeSlateCursor({ v: 1, slateId: theirs.id, afterRank: 1 }),
      }),
    ).rejects.toBeInstanceOf(SlateCursorRejectedError);
    await expect(
      h.reader.pageCompanies({ actor, cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(SlateCursorRejectedError);
    await expect(
      h.reader.pageCompanies({
        actor,
        cursor: Buffer.from(
          JSON.stringify({ v: 2, slateId: theirs.id, afterRank: 0 }),
        ).toString("base64url"),
      }),
    ).rejects.toBeInstanceOf(SlateCursorRejectedError);
    await expect(
      h.reader.pageCompanies({
        actor,
        cursor: encodeSlateCursor({
          v: 1,
          slateId: "99999999-0000-4000-8000-000000000001",
          afterRank: 0,
        }),
      }),
    ).rejects.toBeInstanceOf(SlateCursorRejectedError);
    expect(h.requested).toEqual([]);
  });

  it("a superseded slate keeps serving its remaining pages; an invalidated one restarts from the current slate and says so", async () => {
    const h = harness();
    const old = await publish(h.store, KEY, 4);
    const first = await h.reader.pageCompanies({ actor, limit: 2 });
    const fresh = await publish(h.store, KEY, 3);
    expect((await h.store.repo.findById(old.id))?.status).toBe("SUPERSEDED");
    // The reader keeps the old ordering for the client mid-scroll.
    const continued = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(continued.slateId).toBe(old.id);
    expect(continued.items.map((i) => i.companyId)).toEqual([id(3), id(4)]);
    expect(continued.notes).toEqual([]);
    // A fresh start serves the new slate.
    expect((await h.reader.pageCompanies({ actor, limit: 2 })).slateId).toBe(
      fresh.id,
    );

    await h.store.repo.invalidate(
      fresh.id,
      "MANDATE_HARD_CHANGED",
      NOW.toISOString(),
    );
    // The superseded slate is still inside its expiry: still servable.
    const restarted = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(restarted.slateId).toBe(old.id);
    // Past the old slate's expiry the cursor names nothing servable: the
    // page restarts from whatever is current and says so.
    h.setNow(new Date("2026-09-21T12:00:00.000Z"));
    const rebuilt = await publish(h.store, KEY, 1, {
      publishedAt: "2026-09-21T11:00:00.000Z",
      expiresAt: "2026-09-22T11:00:00.000Z",
    });
    const after = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(after.notes).toEqual(["SLATE_RESTARTED"]);
    expect(after.slateId).toBe(rebuilt.id);
    expect(after.items.map((i) => i.companyId)).toEqual([id(1)]);
  });

  it("no servable slate: an empty page that says a rebuild was requested, once per page, and an expired slate is not served", async () => {
    const h = harness();
    const none = await h.reader.pageCompanies({ actor });
    expect(none).toEqual({
      slateId: null,
      rankingVersion: "ranking-config.v3",
      items: [],
      notes: ["RECOMMENDATIONS_REFRESHING"],
      nextCursor: null,
      unverifiableExclusions: [],
      excludingRules: [],
      discoverableCount: null,
    });
    expect(h.requested).toHaveLength(1);
    expect(h.requested[0]).toMatchObject({
      ...KEY,
      reason: "NO_CURRENT_SLATE",
      priority: "NORMAL",
    });

    await publish(h.store, KEY, 2, { expiresAt: "2026-09-19T11:00:00.000Z" });
    const expired = await h.reader.pageCompanies({ actor });
    expect(expired.slateId).toBeNull();
    expect(expired.notes).toEqual(["RECOMMENDATIONS_REFRESHING"]);
    expect(h.requested[1]).toMatchObject({ reason: "SLATE_EXPIRED" });

    // Without a requester the page is still honest.
    const quiet = harness({ requester: false });
    expect((await quiet.reader.pageCompanies({ actor })).notes).toEqual([
      "RECOMMENDATIONS_REFRESHING",
    ]);
    expect(quiet.requested).toEqual([]);
  });

  it("an empty slate is a valid answer, and no mandate or no investor organisation is not a slate", async () => {
    const h = harness();
    const empty = await publish(h.store, KEY, 0);
    const page = await h.reader.pageCompanies({ actor });
    expect(page.slateId).toBe(empty.id);
    expect(page.items).toEqual([]);
    expect(page.notes).toEqual(["NO_DISCOVERABLE_COUNTERPARTS"]);
    expect(page.discoverableCount).toBe(0);
    expect(h.evaluated).toEqual([]);
    // The investor's own organisation is never counted as a counterpart.
    expect(h.poolAsked).toEqual([INVESTOR]);

    const noMandate = harness({ mandate: "NONE" });
    expect((await noMandate.reader.pageCompanies({ actor })).notes).toEqual([
      "NO_ACTIVE_MANDATE",
    ]);
    const founder = harness({ investor: false });
    expect((await founder.reader.pageCompanies({ actor })).notes).toEqual([
      "NO_ACTIVE_MANDATE",
    ]);
    expect(noMandate.requested).toEqual([]);
  });
});

/**
 * Pass suppression at serving time (CQ-REC-009R).
 *
 * REC-009 demotes a passed company to the tail of the slate, which keeps
 * the slate a complete, reproducible permutation. A tail is still
 * reachable, so demotion alone was ordering rather than suppression. These
 * cases are about the difference.
 */
describe("a company this organisation passed on", () => {
  it("3: is never served, including after every higher item is exhausted", async () => {
    const h = harness({ passed: [id(3)] });
    await publish(h.store, KEY, 5);
    const seen: string[] = [];
    let cursor: string | null | undefined;
    // Page all the way to the end, which is exactly the route by which a
    // tail-demoted company used to come back.
    for (let page = 0; page < 10; page += 1) {
      const result = await h.reader.pageCompanies({ actor, limit: 2, cursor });
      seen.push(...result.items.map((i) => i.companyId));
      cursor = result.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([id(1), id(2), id(4), id(5)]);
    expect(seen).not.toContain(id(3));
  });

  it("4: stays in the slate, so the ordering and the history are intact", async () => {
    const h = harness({ passed: [id(3)] });
    const slate = await publish(h.store, KEY, 5);
    await h.reader.pageCompanies({ actor, limit: 10 });
    // The withholding is a serving decision. Nothing was deleted, and the
    // stored slate still reproduces the order it was built with.
    const items = await h.store.repo.pageItems({
      slateId: slate.id,
      afterRank: 0,
      limit: 50,
    });
    expect(items.map((i) => i.companyId)).toEqual([
      id(1),
      id(2),
      id(3),
      id(4),
      id(5),
    ]);
    expect(items.find((i) => i.companyId === id(3))?.rank).toBe(3);
  });

  it("leaves a shorter page rather than a substitute", async () => {
    // The same rule REC-001's guard follows: what is withheld is withheld,
    // and pulling the next item forward would make the page's contents
    // depend on what was hidden.
    const h = harness({ passed: [id(1)] });
    await publish(h.store, KEY, 5);
    const page = await h.reader.pageCompanies({ actor, limit: 2 });
    expect(page.items.map((i) => i.companyId)).toEqual([id(2)]);
    expect(page.nextCursor).not.toBeNull();
  });

  it("6: an explicit reset makes it servable again", async () => {
    // Two shapes of the same thing. A reset that clears the pass leaves
    // nothing to suppress; a reset recorded as a reason is one the policy
    // accepts. Neither exists as a command yet -- this is the mechanism,
    // proved, waiting for a surface.
    const cleared = harness({ passed: [] });
    await publish(cleared.store, KEY, 3);
    expect(
      (await cleared.reader.pageCompanies({ actor, limit: 10 })).items.map(
        (i) => i.companyId,
      ),
    ).toEqual([id(1), id(2), id(3)]);

    const reasoned = harness({
      passed: [id(2)],
      reintroduce: { [id(2)]: "EXPLICIT_PASS_RESET" },
    });
    await publish(reasoned.store, KEY, 3);
    expect(
      (await reasoned.reader.pageCompanies({ actor, limit: 10 })).items.map(
        (i) => i.companyId,
      ),
    ).toEqual([id(1), id(2), id(3)]);
  });

  it("7 and 8: a mandate change or a company edit does not reintroduce it on its own", async () => {
    // Nothing in the system produces either reason today, so the honest
    // behaviour is that neither happens. When a source exists it supplies
    // the reason; it does not get inferred here.
    const h = harness({ passed: [id(2)] });
    await publish(h.store, KEY, 3);
    const page = await h.reader.pageCompanies({ actor, limit: 10 });
    expect(page.items.map((i) => i.companyId)).toEqual([id(1), id(3)]);
  });

  it("a new pitch since the pass offers it again, labelled; nothing else is labelled or moved (founder report 2026-10-02)", async () => {
    const h = harness({
      passed: [id(2)],
      reintroduce: {
        [id(2)]: { reason: "MATERIAL_COMPANY_UPDATE", change: "NEW_PITCH" },
      },
    });
    await publish(h.store, KEY, 3);
    const page = await h.reader.pageCompanies({ actor, limit: 10 });
    // Same order as the slate: reintroduction un-withholds, it never ranks.
    expect(page.items.map((i) => i.companyId)).toEqual([id(1), id(2), id(3)]);
    expect(page.items[1]?.reintroduced).toEqual({ change: "NEW_PITCH" });
    expect(page.items[0]?.reintroduced).toBeUndefined();
    expect(page.items[2]?.reintroduced).toBeUndefined();
  });

  it("an unrecognised reason suppresses rather than erroring the page", async () => {
    // Fail closed. A build can stop and be retried; a feed page cannot,
    // and a 500 would be a worse answer than one missing company.
    const h = harness({
      passed: [id(2)],
      reintroduce: { [id(2)]: "I_CHANGED_MY_MIND" },
    });
    await publish(h.store, KEY, 3);
    const page = await h.reader.pageCompanies({ actor, limit: 10 });
    expect(page.items.map((i) => i.companyId)).toEqual([id(1), id(3)]);
  });

  it("9: it is asked only about this page, for this organisation", async () => {
    const h = harness({ passed: [] });
    await publish(h.store, KEY, 5);
    await h.reader.pageCompanies({ actor, limit: 2 });
    expect(h.suppressionAsked).toEqual([[id(1), id(2)]]);
  });
});

/**
 * Truthful empty states and unknown-never-excludes at read time (ADR 0020).
 * The live defect: twelve discoverable companies, an empty slate, and the
 * page said nobody had made themselves discoverable.
 */
describe("why a slate is empty, and what could not be checked", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => id(100 + i));

  it("discoverable companies all removed by a declared rule: NONE_PASS_HARD_RULES, the rule named, never 'nobody is discoverable'", async () => {
    const h = harness({
      pool: { discoverable: 12, latestChangeAt: null, sample: twelve },
      stageExcluded: twelve,
    });
    await publish(h.store, KEY, 0);
    const page = await h.reader.pageCompanies({ actor });
    expect(page.notes).toEqual(["NONE_PASS_HARD_RULES"]);
    expect(page.excludingRules).toEqual(["stage"]);
    expect(page.discoverableCount).toBe(12);
    expect(h.evaluated).toEqual([twelve]);
    expect(h.requested).toEqual([]);
  });

  it("discoverable companies that pass the rules but matched nothing: NONE_MATCH_MANDATE", async () => {
    const h = harness({
      pool: { discoverable: 12, latestChangeAt: null, sample: twelve },
    });
    await publish(h.store, KEY, 0);
    const page = await h.reader.pageCompanies({ actor });
    expect(page.notes).toEqual(["NONE_MATCH_MANDATE"]);
    expect(page.excludingRules).toEqual([]);
  });

  it("an empty slate older than the newest discoverable-company change is rebuilt on read, and says so", async () => {
    const h = harness({
      pool: {
        discoverable: 12,
        // The slate was generated at 09:00; a company became discoverable at 11:00.
        latestChangeAt: "2026-09-19T11:00:00.000Z",
        sample: twelve,
      },
    });
    await publish(h.store, KEY, 0);
    const page = await h.reader.pageCompanies({ actor });
    expect(page.notes).toEqual(["RECOMMENDATIONS_REFRESHING"]);
    expect(h.requested).toEqual([
      expect.objectContaining({ ...KEY, priority: "HIGH" }),
    ]);
    // Not re-evaluated: the rebuild answers the question.
    expect(h.evaluated).toEqual([]);
  });

  it("an empty slate newer than every change is believed", async () => {
    const h = harness({
      pool: {
        discoverable: 3,
        latestChangeAt: "2026-09-19T08:00:00.000Z",
        sample: twelve.slice(0, 3),
      },
    });
    await publish(h.store, KEY, 0);
    const page = await h.reader.pageCompanies({ actor });
    expect(page.notes).toEqual(["NONE_MATCH_MANDATE"]);
    expect(h.requested).toEqual([]);
  });

  it("a card whose stage is unknown under a stage exclusion is shown with the rule marked unverified", async () => {
    const h = harness({ stageUnknown: [id(2)] });
    await publish(h.store, KEY, 3);
    const page = await h.reader.pageCompanies({ actor });
    expect(page.items.map((i) => i.companyId)).toEqual([id(1), id(2), id(3)]);
    expect(page.items.map((i) => i.unverifiedExclusions)).toEqual([
      [],
      ["stage"],
      [],
    ]);
  });

  it("an exclusion V1 cannot evaluate is reported once per page, never per card, and withholds nothing", async () => {
    const h = harness({ redFlag: true });
    await publish(h.store, KEY, 2);
    const page = await h.reader.pageCompanies({ actor });
    expect(page.items).toHaveLength(2);
    expect(page.unverifiableExclusions).toEqual(["red_flag"]);
    expect(page.items.every((i) => i.unverifiedExclusions.length === 0)).toBe(
      true,
    );
  });
});

describe("Discover filters narrow the served slate (ux/discover-filters)", () => {
  const FINTECH = "eacf7107-9af3-5b76-91a2-3c169e396347";
  const HEALTH = "7c953fc5-a6bc-5014-afef-068150e5209a";
  const none = {
    sectorNodeIds: [],
    stageCodes: [],
    countryCodes: [],
    raise: null,
    raiseDisclosedOnly: false,
    verifiedOnly: false,
    hasPitch: false,
  };

  it("keeps slate order, drops non-matches, and keeps unknown countries marked", async () => {
    const h = harness({
      cardFacts: {
        [id(2)]: { country: "KE" },
        [id(3)]: { country: null },
        [id(5)]: { country: "KE" },
      },
    });
    await publish(h.store, KEY, 6);
    const page = await h.reader.pageCompanies({
      actor,
      limit: 10,
      filters: { ...none, countryCodes: ["NG"] },
    });
    expect(page.items.map((i) => i.companyId)).toEqual([
      id(1),
      id(3),
      id(4),
      id(6),
    ]);
    expect(
      page.items.find((i) => i.companyId === id(3))?.filterUnknown,
    ).toEqual(["country"]);
    expect(page.items[0]?.filterUnknown).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("an undisclosed raise stays under 'Raise not shared' unless disclosed-only is asked", async () => {
    const raises = new Map([
      [id(1), { amount: "500000", currency: "USD" }],
      [id(2), { amount: "5000000", currency: "USD" }],
      [id(3), { amount: "500000", currency: "NGN" }],
    ]);
    const asked: string[][] = [];
    const h = harness({
      filterFacts: {
        disclosedRaises: ({ companyIds }) => {
          asked.push([...companyIds]);
          return Promise.resolve(
            new Map([...raises].filter(([c]) => companyIds.includes(c))),
          );
        },
      },
    });
    await publish(h.store, KEY, 4);
    const range = { min: "100000", max: "1000000", currency: "USD" };
    const open = await h.reader.pageCompanies({
      actor,
      limit: 10,
      filters: { ...none, raise: range },
    });
    expect(open.items.map((i) => [i.companyId, i.filterUnknown])).toEqual([
      [id(1), []],
      [id(3), ["raise"]],
      [id(4), ["raise"]],
    ]);
    const disclosed = await h.reader.pageCompanies({
      actor,
      limit: 10,
      filters: { ...none, raise: range, raiseDisclosedOnly: true },
    });
    expect(disclosed.items.map((i) => i.companyId)).toEqual([id(1)]);
    // The raise is asked only for companies the guards already allowed.
    expect(asked.every((ids) => ids.length <= 4)).toBe(true);
  });

  it("sector, verified and pitch filters need the positive fact; a missing sector is unknown", async () => {
    const h = harness({
      filterFacts: {
        sectors: (ids) =>
          Promise.resolve(
            new Map<string, readonly string[]>(
              ids.flatMap((c): [string, readonly string[]][] =>
                c === id(1)
                  ? [[c, [FINTECH]]]
                  : c === id(2)
                    ? [[c, [HEALTH]]]
                    : c === id(3)
                      ? [[c, [FINTECH]]]
                      : [],
              ),
            ),
          ),
        verified: () => Promise.resolve(new Set([id(1), id(4)])),
        withPitch: () => Promise.resolve(new Set([id(1), id(3), id(4)])),
      },
    });
    await publish(h.store, KEY, 4);
    const sector = await h.reader.pageCompanies({
      actor,
      filters: { ...none, sectorNodeIds: [FINTECH] },
    });
    expect(sector.items.map((i) => [i.companyId, i.filterUnknown])).toEqual([
      [id(1), []],
      [id(3), []],
      [id(4), ["sector"]],
    ]);
    const strict = await h.reader.pageCompanies({
      actor,
      filters: { ...none, verifiedOnly: true, hasPitch: true },
    });
    expect(strict.items.map((i) => i.companyId)).toEqual([id(1), id(4)]);
  });

  it("the cursor carries the filters: pages stay consistent, and a filter change restarts from the first page", async () => {
    const h = harness({
      cardFacts: Object.fromEntries(
        Array.from({ length: 9 }, (_, n) => [
          id(n + 1),
          { country: n % 2 === 0 ? "NG" : "KE" },
        ]),
      ),
    });
    const slate = await publish(h.store, KEY, 9);
    const filters = { ...none, countryCodes: ["NG"] };
    const first = await h.reader.pageCompanies({ actor, limit: 2, filters });
    expect(first.items.map((i) => i.companyId)).toEqual([id(1), id(3)]);
    const cursor = decodeSlateCursor(first.nextCursor ?? "");
    expect(cursor.slateId).toBe(slate.id);
    expect(cursor.afterRank).toBe(3);
    expect(cursor.f).toMatch(/^[0-9a-f]{16}$/);

    const seen = [...first.items.map((i) => i.companyId)];
    let next = first.nextCursor;
    while (next !== null) {
      const page = await h.reader.pageCompanies({
        actor,
        limit: 2,
        filters,
        cursor: next,
      });
      expect(page.notes).toEqual([]);
      seen.push(...page.items.map((i) => i.companyId));
      next = page.nextCursor;
    }
    expect(seen).toEqual([id(1), id(3), id(5), id(7), id(9)]);

    // Same cursor, other filters: starts again, and says so.
    const changed = await h.reader.pageCompanies({
      actor,
      limit: 2,
      filters: { ...none, countryCodes: ["KE"] },
      cursor: first.nextCursor,
    });
    expect(changed.notes).toEqual(["SLATE_RESTARTED"]);
    expect(changed.items.map((i) => i.companyId)).toEqual([id(2), id(4)]);
    // A filtered cursor used without filters restarts too.
    const cleared = await h.reader.pageCompanies({
      actor,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(cleared.notes).toEqual(["SLATE_RESTARTED"]);
    expect(cleared.items.map((i) => i.companyId)).toEqual([id(1), id(2)]);
  });

  it("filters never show what the guards withheld, and say when nothing matches", async () => {
    const h = harness({ ineligible: [id(1)], passed: [id(2)] });
    await publish(h.store, KEY, 3);
    const page = await h.reader.pageCompanies({
      actor,
      filters: { ...none, countryCodes: ["NG"] },
    });
    expect(page.items.map((i) => i.companyId)).toEqual([id(3)]);
    const empty = await h.reader.pageCompanies({
      actor,
      filters: { ...none, countryCodes: ["GB"] },
    });
    expect(empty.items).toEqual([]);
    expect(empty.notes).toEqual(["NONE_MATCH_FILTERS"]);
    expect(empty.nextCursor).toBeNull();
  });

  it("without filters the page is exactly as before (no fingerprint, no filterUnknown)", async () => {
    const h = harness();
    await publish(h.store, KEY, 3);
    const page = await h.reader.pageCompanies({
      actor,
      limit: 2,
      filters: none,
    });
    expect(page.items[0]).not.toHaveProperty("filterUnknown");
    expect(decodeSlateCursor(page.nextCursor ?? "")).not.toHaveProperty("f");
  });

  it("compares raise amounts exactly, never as floats", () => {
    expect(compareAmounts("1000000", "999999.99")).toBe(1);
    expect(compareAmounts("0500", "500.00")).toBe(0);
    expect(compareAmounts("0.1", "0.10")).toBe(0);
    expect(compareAmounts("12.5", "12.50001")).toBe(-1);
  });
});

describe("plan recommendation volume (BILLING-2, ADR 0036): volume only, never position", () => {
  it("cuts the feed at the plan's rank and keeps the order above it exactly", async () => {
    const full = harness();
    await publish(full.store, KEY, 6);
    const everything = await full.reader.pageCompanies({ actor, limit: 10 });

    const capped = harness({ volume: 4 });
    await publish(capped.store, KEY, 6);
    const first = await capped.reader.pageCompanies({ actor, limit: 3 });
    const second = await capped.reader.pageCompanies({
      actor,
      limit: 3,
      cursor: first.nextCursor,
    });
    const served = [...first.items, ...second.items].map((i) => i.companyId);
    expect(served).toEqual(
      everything.items.slice(0, 4).map((i) => i.companyId),
    );
    expect(second.nextCursor).toBeNull();
  });

  it("a filtered feed is cut at the same rank, never refilled from below it", async () => {
    const h = harness({ volume: 3 });
    await publish(h.store, KEY, 6);
    const page = await h.reader.pageCompanies({
      actor,
      limit: 10,
      filters: {
        sectorNodeIds: [],
        stageCodes: [],
        countryCodes: ["NG"],
        raise: null,
        raiseDisclosedOnly: false,
        verifiedOnly: false,
        hasPitch: false,
      },
    });
    expect(page.items.map((i) => i.companyId)).toEqual([id(1), id(2), id(3)]);
  });

  it("no plan value (null) serves the whole slate, as today", async () => {
    const h = harness({ volume: null });
    await publish(h.store, KEY, 6);
    const page = await h.reader.pageCompanies({ actor, limit: 10 });
    expect(page.items).toHaveLength(6);
  });
});
