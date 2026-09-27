import { describe, expect, it } from "vitest";

import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createDiscoverFilterFacts } from "../src/discover-filter-facts.js";

/**
 * The Context Firewall on the raise filter: a founder-private raise never
 * narrows an investor's feed. Only a raise the disclosure evaluator lets
 * this reader view is a fact the filter may use.
 */

const TENANT = "11111111-0000-4000-8000-000000000001";
const SHARED = "44444444-0000-4000-8000-000000000001";
const PRIVATE = "44444444-0000-4000-8000-000000000002";
const NO_RAISE = "44444444-0000-4000-8000-000000000003";
const objectiveOf = (companyId: string) =>
  companyId.replace(/^4{8}/, "5".repeat(8));

const actor: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

function facts(options: { readonly verified?: readonly string[] } = {}) {
  const asked: string[] = [];
  const port = createDiscoverFilterFacts({
    companies: {
      findCanonicalCompany: (id) =>
        Promise.resolve({
          id,
          tenantId: TENANT,
          organisationId: `org-${id}`,
          canonicalName: "x",
          companyStatus: "active",
        } as never),
    },
    capital: {
      getCurrentForCompany: (_tenant, companyId) =>
        Promise.resolve(
          companyId === NO_RAISE
            ? null
            : ({
                id: objectiveOf(companyId),
                companyId,
                status: "ACTIVE",
                target: { amount: "750000", currency: "USD" },
              } as never),
        ),
    },
    disclosure: {
      evaluateMany: (requests) => {
        asked.push(...requests.map((r) => r.resource.id));
        return Promise.resolve(
          requests.map(
            (r) =>
              ({
                outcome:
                  r.resource.id === objectiveOf(SHARED) ? "ALLOW" : "DENY",
              }) as never,
          ),
        );
      },
    },
    verification: () => ({
      companyStandings: ({ organisationId }) =>
        Promise.resolve({
          organisation: {
            verified: (options.verified ?? []).some(
              (c) => `org-${c}` === organisationId,
            ),
          },
        }),
    }),
    pitches: () => ({
      findDiscoverablePitches: (ids) =>
        Promise.resolve(
          new Map(ids.filter((c) => c === SHARED).map((c) => [c, {} as never])),
        ),
    }),
  });
  return { port, asked };
}

describe("Discover filter facts (ux/discover-filters)", () => {
  it("a raise is a fact only where disclosure lets this reader view it", async () => {
    const { port, asked } = facts();
    const raises = await port.disclosedRaises?.({
      actor,
      companyIds: [SHARED, PRIVATE, NO_RAISE],
    });
    expect([...(raises ?? new Map()).entries()]).toEqual([
      [SHARED, { amount: "750000", currency: "USD" }],
    ]);
    // Asked about the raise objects, under this actor, and nothing else.
    expect(asked).toEqual([objectiveOf(SHARED), objectiveOf(PRIVATE)]);
  });

  it("verification and pitch are positive facts from their owners", async () => {
    const { port } = facts({ verified: [PRIVATE] });
    expect([...((await port.verified?.([SHARED, PRIVATE])) ?? [])]).toEqual([
      PRIVATE,
    ]);
    expect([...((await port.withPitch?.([SHARED, PRIVATE])) ?? [])]).toEqual([
      SHARED,
    ]);
  });
});
