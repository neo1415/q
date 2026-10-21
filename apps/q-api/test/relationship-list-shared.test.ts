import { describe, expect, it } from "vitest";

import {
  createRoundTripCounter,
  withRoundTripCounter,
} from "@capital-q/database";
import type { InterestService } from "@capital-q/network";

import { withRunCachedRelationshipLists } from "../src/composition/run-read-cache.js";

/**
 * Speed lane 2026-10-20: a cold arrival snapshot read the person's
 * relationship list twice in one request -- once for the attention report
 * (the cached list read) and once inside the Relationship Briefs, which
 * listed again on their own. The briefs now take the request's cached
 * list: one list read for both, the same actor's own, same authorisation.
 */
const ACTOR = {
  tenantId: "t1",
  userId: "u1",
  organisationId: "o1",
  membershipId: "m1",
  actorType: "HUMAN",
} as const;
const OTHER = { ...ACTOR, userId: "u2", membershipId: "m2" } as const;

function service() {
  const calls = {
    investorLists: 0,
    companyLists: 0,
    briefsListedThemselves: 0,
  };
  const base = {
    listRelationshipsForInvestor: () => {
      calls.investorLists += 1;
      return Promise.resolve([{ relationship: { id: "r1" } }]);
    },
    listRelationshipsForCompany: () => {
      calls.companyLists += 1;
      return Promise.resolve([{ relationship: { id: "r2" } }]);
    },
    relationshipBriefs: async (query: {
      readonly listings?: () => Promise<readonly unknown[]>;
    }) => {
      if (query.listings === undefined) {
        calls.briefsListedThemselves += 1;
        return [];
      }
      return (await query.listings()).map(() => ({ brief: true }));
    },
  } as unknown as InterestService;
  return { cached: withRunCachedRelationshipLists(base), calls };
}

const briefsOf = (s: ReturnType<typeof service>["cached"]) => {
  const briefs = s.relationshipBriefs;
  if (briefs === undefined) throw new Error("briefs not composed");
  return briefs;
};

describe("the relationship list, read once per request for attention and briefs", () => {
  it("investor side: the list and the briefs share one list read", async () => {
    const s = service();
    await withRoundTripCounter(createRoundTripCounter("req-1"), async () => {
      await Promise.all([
        s.cached.listRelationshipsForInvestor({ actor: ACTOR as never }),
        briefsOf(s.cached)({ actor: ACTOR as never, sources: {} }),
      ]);
    });
    expect(s.calls).toEqual({
      investorLists: 1,
      companyLists: 0,
      briefsListedThemselves: 0,
    });
  });

  it("company side: keyed by the company, one list read", async () => {
    const s = service();
    await withRoundTripCounter(createRoundTripCounter("req-2"), async () => {
      await s.cached.listRelationshipsForCompany({
        actor: ACTOR as never,
        companyId: "c1",
      });
      const briefs = await briefsOf(s.cached)({
        actor: ACTOR as never,
        companyId: "c1",
        sources: {},
      });
      expect(briefs).toHaveLength(1);
    });
    expect(s.calls.companyLists).toBe(1);
  });

  it("another person never reads this person's list", async () => {
    const s = service();
    await withRoundTripCounter(createRoundTripCounter("req-3"), async () => {
      await s.cached.listRelationshipsForInvestor({ actor: ACTOR as never });
      await briefsOf(s.cached)({ actor: OTHER as never, sources: {} });
    });
    expect(s.calls.investorLists).toBe(2);
  });
});
