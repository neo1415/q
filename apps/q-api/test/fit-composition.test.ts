import { describe, expect, it } from "vitest";

import type { EligibilityPorts } from "@capital-q/discovery";
import type { ActorContext } from "@capital-q/security";

import { createFitComposition } from "../src/composition/fit.js";

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
function cardSql(published: ReadonlyMap<string, unknown>) {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!strings.join("?").includes("core.shareable_identities")) {
      return Promise.resolve([]);
    }
    const subjectId = values.find(
      (v): v is string => typeof v === "string" && published.has(v),
    );
    if (subjectId === undefined) return Promise.resolve([]);
    return Promise.resolve([
      {
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
      },
    ]);
  }) as never;
}

function compose(
  viewCalls: { n: number },
  published: ReadonlyMap<string, unknown> = new Map(),
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
    sql: cardSql(published),
    eligibilityPorts,
    eligibility: {
      evaluate: (q) =>
        Promise.resolve({
          context: {} as never,
          results: q.companyIds.map((companyId) => ({
            companyId,
            mandateId: ID(200),
            reasonCodes: [],
          })) as never,
        }),
    },
    companies: {
      findCanonicalCompany: (id) =>
        Promise.resolve({
          id,
          tenantId: ID(5),
          organisationId: ID(6),
          canonicalName: id === SHARED ? "Sunline" : "Kora",
          companyStatus: "active",
        } as never),
    },
    capital: {
      getCurrentForCompany: (_tenant, companyId) =>
        Promise.resolve({
          id: `obj-${companyId}`,
          companyId,
          status: "ACTIVE",
          target: { amount: "2000000", currency: "USD" },
        } as never),
    },
    disclosure: {
      evaluateMany: (requests) =>
        Promise.resolve(
          requests.map((r) => ({
            outcome: r.resource.id === `obj-${SHARED}` ? "ALLOW" : "DENY",
          })) as never,
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
    expect(cheque(SHARED)?.reason).toBe("$2M round; your $300k fits.");
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
    expect(cheque?.reason).toBe("$2M round; your $300k fits.");
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
