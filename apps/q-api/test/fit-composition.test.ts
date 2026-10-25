import { describe, expect, it } from "vitest";

import type { EligibilityPorts } from "@capital-q/discovery";
import type { ActorContext } from "@capital-q/security";

import {
  createFitComposition,
  RANK_CACHE_MS,
  withRankCache,
} from "../src/composition/fit.js";

/**
 * The Q API's fit composition (ADR 0052): the raise reaches the fit only
 * where disclosure lets THIS reader view it, candidates are the reader's
 * own lists, and Q's view is cached per exact profile.
 */

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = {
  userId: ID(90),
  tenantId: ID(91),
  organisationId: ID(92),
  actorType: "USER",
} as unknown as ActorContext;
const SHARED = ID(1);
const PRIVATE = ID(2);

/**
 * The database as the fit sees it: empty, except a company's Q Card when a
 * test publishes one (read through public-identity's own repository).
 */
/** Queries the fit composition sent, by what they read (egress counts). */
const queries = {
  snapshots: 0,
  profiles: 0,
  cards: 0,
  identities: 0,
  objectives: 0,
  oneByOne: 0,
  unicorn: 0,
};

function cardSql(published: ReadonlyMap<string, unknown>) {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join("?").includes("recommendation.feature_snapshots")) {
      queries.snapshots += 1;
    }
    if (!strings.join("?").includes("core.shareable_identities")) {
      return Promise.resolve([]);
    }
    queries.cards += 1;
    // One card or many (a batch read passes the ids as one array).
    const subjects = values
      .flatMap((v): readonly unknown[] => (Array.isArray(v) ? v : [v]))
      .filter((v): v is string => typeof v === "string" && published.has(v));
    return Promise.resolve(
      subjects.map((subjectId) => ({
        id: ID(400),
        tenant_id: ID(5),
        organisation_id: ID(6),
        subject_type: "COMPANY",
        subject_id: subjectId,
        public_code: "abc123",
        field_scopes: published.get(subjectId),
        indexable: false,
        status: "ACTIVE",
        version: 1,
        updated_at: new Date(),
      })),
    );
  }) as never;
}

/** The real services' per-call bounds (eligibility and disclosure). */
const BATCH_MAX = 200;
const bounded = <T>(size: number, value: () => Promise<T>): Promise<T> =>
  size > BATCH_MAX
    ? Promise.reject(new RangeError(`batch of ${String(size)} exceeds 200`))
    : value();

function compose(
  viewCalls: { n: number },
  published: ReadonlyMap<string, unknown> = new Map(),
  raiseShared: (companyId: string) => boolean = (id) => id === SHARED,
  names: (companyId: string) => string = (id) =>
    id === SHARED ? "Sunline" : "Kora",
) {
  const eligibilityPorts = {
    investorSubject: {
      investorOrganisationFor: () =>
        Promise.resolve({ investorOrganisationId: ID(300) }),
    },
    mandates: {
      activeMandate: () =>
        Promise.resolve({
          kind: "FOUND",
          mandate: {
            mandateId: ID(200),
            investorOrganisationId: ID(300),
            version: 1,
            status: "ACTIVE",
            taxonomyPreferences: [],
            constraints: [
              {
                dimension: "cheque.typical",
                operator: "EQ",
                value: { kind: "amount", amount: "300000", currency: "USD" },
                importance: "NEUTRAL",
                isHardExclusion: false,
                automatedUse: "ELIGIBLE",
              },
            ],
          },
        }),
    },
    companies: { findMany: () => Promise.resolve([]) },
  } as unknown as EligibilityPorts;
  return createFitComposition({
    // A premium reader's Unicorn Potential (live, savanna-seed): history
    // for every company is slow, so it must only be read for what is shown.
    unicornPotential: async () => {
      queries.unicorn += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Map();
    },
    sql: cardSql(published),
    eligibilityPorts,
    eligibility: {
      evaluate: (q) =>
        bounded(q.companyIds.length, () =>
          Promise.resolve({
            context: {} as never,
            results: q.companyIds.map((companyId) => ({
              companyId,
              mandateId: ID(200),
              reasonCodes: [],
            })) as never,
          }),
        ),
    },
    companies: {
      findCanonicalCompanyProfile: () => {
        queries.profiles += 1;
        return Promise.resolve(null);
      },
      findCanonicalCompany: (id) => {
        queries.oneByOne += 1;
        return Promise.resolve({
          id,
          tenantId: ID(5),
          organisationId: ID(6),
          canonicalName: names(id),
          companyStatus: "active",
        } as never);
      },
      findCanonicalCompanies: (ids) => {
        queries.identities += 1;
        return Promise.resolve(
          ids.map(
            (id) =>
              ({
                id,
                tenantId: ID(5),
                organisationId: ID(6),
                canonicalName: names(id),
                companyStatus: "active",
              }) as never,
          ),
        );
      },
    },
    capital: {
      getCurrentForCompany: (_tenant, companyId) => {
        queries.oneByOne += 1;
        return Promise.resolve({
          id: `obj-${companyId}`,
          companyId,
          status: "ACTIVE",
          target: { amount: "2000000", currency: "USD" },
        } as never);
      },
      getCurrentForCompanies: (companies) => {
        queries.objectives += 1;
        return Promise.resolve(
          companies.map(
            ({ companyId }) =>
              ({
                id: `obj-${companyId}`,
                companyId,
                status: "ACTIVE",
                target: { amount: "2000000", currency: "USD" },
              }) as never,
          ),
        );
      },
    },
    disclosure: {
      evaluateMany: (requests) =>
        bounded(requests.length, () =>
          Promise.resolve(
            requests.map((r) => ({
              outcome: raiseShared(r.resource.id.replace(/^obj-/u, ""))
                ? "ALLOW"
                : "DENY",
            })) as never,
          ),
        ),
    },
    relationships: () => Promise.resolve([SHARED]),
    requests: () => Promise.reject(new Error("requests down")),
    feed: {
      page: () =>
        Promise.resolve({
          items: [{ companyId: PRIVATE }] as never,
          notes: [],
        }),
    },
    viewer: {
      view: (request) => {
        viewCalls.n += 1;
        return Promise.resolve({
          status: "READY",
          companyId: request.profile.companyId,
          verdict: "MAYBE",
          summary: "Ask about the round.",
          mainRisk: null,
          unknowns: [],
          truthClass: "Q_INFERENCE",
          configVersion: request.profile.configVersion,
        });
      },
    },
  });
}

describe("fit composition", () => {
  it("uses a raise only where disclosure allows this reader", async () => {
    const { fit } = compose({ n: 0 });
    const result = await fit.profiles(actor, [SHARED, PRIVATE]);
    if (result.kind !== "OK") throw new Error("expected profiles");
    const cheque = (id: string) =>
      result.items
        .find((i) => i.assessment.profile.companyId === id)
        ?.assessment.profile.parameters.find(
          (p) => p.parameter === "CHEQUE_SIZE",
        );
    expect(cheque(SHARED)?.outcome).toBe("STRONG");
    expect(cheque(SHARED)?.reason).toBe(
      "$2M round; your $300k cheque fits (up to 15% of it).",
    );
    expect(cheque(PRIVATE)?.outcome).toBe("UNKNOWN");
    expect(cheque(PRIVATE)?.reason).toBe(
      "The company has not shared its round size with you.",
    );
    expect(cheque(PRIVATE)?.unknownReason).toBe("ROUND_NOT_SHARED");
  });

  // Owner 23 Oct 2026: a company that put its raise on its Q Card shares
  // it with every signed-in investor; cheque fit is then known.
  it("uses a raise the company published on its Q Card, with no disclosure", async () => {
    const { fit } = compose(
      { n: 0 },
      new Map([[PRIVATE, { currentRaise: "public_external" }]]),
    );
    const result = await fit.profiles(actor, [PRIVATE]);
    if (result.kind !== "OK") throw new Error("expected profiles");
    const cheque = result.items[0]?.assessment.profile.parameters.find(
      (p) => p.parameter === "CHEQUE_SIZE",
    );
    expect(cheque?.outcome).toBe("STRONG");
    expect(cheque?.reason).toBe(
      "$2M round; your $300k cheque fits (up to 15% of it).",
    );
  });

  it("a card that does not show the raise shares nothing", async () => {
    const { fit } = compose(
      { n: 0 },
      new Map([[PRIVATE, { canonicalName: "public_external" }]]),
    );
    const result = await fit.profiles(actor, [PRIVATE]);
    if (result.kind !== "OK") throw new Error("expected profiles");
    expect(
      result.items[0]?.assessment.profile.parameters.find(
        (p) => p.parameter === "CHEQUE_SIZE",
      )?.outcome,
    ).toBe("UNKNOWN");
  });

  // F-82 (live bbb4b6773, 2026-10-24): over the whole network the raise
  // read sent every company's raise to disclosure in one call, which
  // throws past 200; rank failed and the answer fell to name order.
  it("rank over the live network's 463 companies: every one scored, the best (last by name) first", async () => {
    const ids = Array.from({ length: 463 }, (_, i) => ID(1000 + i));
    const SILO = ids[462] ?? "";
    const { fit } = compose(
      { n: 0 },
      new Map(),
      (id) => id === SILO,
      (id) => (id === SILO ? "Silo Credit" : `A company ${id.slice(-4)}`),
    );
    for (const key of Object.keys(queries) as (keyof typeof queries)[])
      queries[key] = 0;
    const result = await fit.rank?.(actor, ids, 5);
    expect(result?.kind).toBe("OK");
    if (result?.kind !== "OK") return;
    expect(result.comparison.considered).toBe(463);
    expect(result.comparison.entries[0]?.companyId).toBe(SILO);
    // Egress (owner 2026-10-24): one snapshot query per batch of 100,
    // never one per company, and no profile one-liners for a ranking.
    expect(queries.snapshots).toBe(5);
    expect(queries.profiles).toBe(0);
    // Owner 2026-10-25 (the rank took ~18 s): per batch of 100, one read
    // each for identities (names and raises), objectives and Q Cards;
    // never one query per company.
    expect(queries.oneByOne).toBe(0);
    // Owner 2026-10-25 (live 152f09980, savanna-seed: rank.scores 11,941
    // ms): the order never reads Investability or Unicorn Potential, so a
    // rank reads neither; the cards shown read them through fit_profile.
    expect(queries.unicorn).toBe(0);
    expect(result.phasesMs?.["scores"] ?? 0).toBeLessThan(300);
    // Where its time went, by phase (owner 2026-10-25), for the log.
    expect(Object.keys(result.phasesMs ?? {}).sort()).toEqual([
      "eligibility",
      "inputs",
      "scores",
      "subject",
    ]);
    expect(queries.identities).toBe(10);
    expect(queries.objectives).toBe(5);
    expect(queries.cards).toBe(5);
  });

  it("top N reads the reader's own lists, and one list failing does not fail it", async () => {
    const { fit } = compose({ n: 0 });
    const result = await fit.top(actor, 3);
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") return;
    expect(result.comparison.considered).toBe(2);
  });

  it("Q's view is cached per exact profile", async () => {
    const calls = { n: 0 };
    const { fit, qViews } = compose(calls);
    const result = await fit.profiles(actor, [SHARED]);
    if (result.kind !== "OK" || result.items[0] === undefined)
      throw new Error("expected a profile");
    const item = result.items[0];
    await qViews.viewFor({ actor, item, correlationId: "cor_1" });
    await qViews.viewFor({
      actor,
      item: {
        ...item,
        assessment: {
          ...item.assessment,
          profile: {
            ...item.assessment.profile,
            computedAt: "2026-10-06T00:00:00.000Z",
          },
        },
      },
      correlationId: "cor_2",
    });
    expect(calls.n).toBe(1);
  });
});

describe("the network ranking is reused for two minutes, per person (egress, owner 2026-10-24)", () => {
  it("the same person and companies read once; another person, a later ask or a failure read again", async () => {
    let calls = 0;
    let fail = false;
    let now = Date.parse("2026-10-24T23:00:00Z");
    const base = {
      profiles: () => Promise.reject(new Error("not used")),
      top: () => Promise.reject(new Error("not used")),
      compare: () => Promise.reject(new Error("not used")),
      rank: () => {
        calls += 1;
        return Promise.resolve(
          fail
            ? ({ kind: "NO_MANDATE" } as const)
            : ({ kind: "OK", comparison: {} as never } as const),
        );
      },
    };
    const fit = withRankCache(base, () => new Date(now));
    const other = { ...actor, userId: ID(99) } as ActorContext;
    await fit.rank?.(actor, [ID(1), ID(2)], 5);
    await fit.rank?.(actor, [ID(2), ID(1)], 5);
    expect(calls).toBe(1);
    await fit.rank?.(other, [ID(1), ID(2)], 5);
    expect(calls).toBe(2);
    now += RANK_CACHE_MS;
    await fit.rank?.(actor, [ID(1), ID(2)], 5);
    expect(calls).toBe(3);
    fail = true;
    await fit.rank?.(actor, [ID(3)], 5);
    await fit.rank?.(actor, [ID(3)], 5);
    expect(calls).toBe(5);
  });
});
