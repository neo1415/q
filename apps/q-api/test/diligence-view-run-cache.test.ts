import { describe, expect, it } from "vitest";

import {
  createRoundTripCounter,
  withRoundTripCounter,
} from "@capital-q/database";
import type { DiligenceService } from "@capital-q/permissions";

import { withRunCachedDiligenceViews } from "../src/composition/run-read-cache.js";

/**
 * S5 (lane S, live 2026-10-15: one get_relationship took 55 round trips):
 * a relationship's diligence view is read once per run, for the same
 * actor and relationship only; outside a run every call reads.
 */
const ACTOR = {
  tenantId: "t1",
  userId: "u1",
  organisationId: "o1",
  membershipId: "m1",
  actorType: "HUMAN",
} as const;

function service() {
  let reads = 0;
  const base = {
    view: (query: { readonly relationshipId: string }) => {
      reads += 1;
      return Promise.resolve({ relationshipId: query.relationshipId });
    },
  } as unknown as DiligenceService;
  return { cached: withRunCachedDiligenceViews(base), reads: () => reads };
}

describe("diligence views read once per run (S5)", () => {
  it("the same actor and relationship twice in a run is one read", async () => {
    const s = service();
    await withRoundTripCounter(createRoundTripCounter("run-1"), async () => {
      await s.cached.view({ actor: ACTOR as never, relationshipId: "r1" });
      await s.cached.view({ actor: ACTOR as never, relationshipId: "r1" });
    });
    expect(s.reads()).toBe(1);
  });

  it("another relationship or another person is its own read", async () => {
    const s = service();
    await withRoundTripCounter(createRoundTripCounter("run-1"), async () => {
      await s.cached.view({ actor: ACTOR as never, relationshipId: "r1" });
      await s.cached.view({ actor: ACTOR as never, relationshipId: "r2" });
      await s.cached.view({
        actor: { ...ACTOR, userId: "u2" } as never,
        relationshipId: "r1",
      });
      await s.cached.view({
        actor: { ...ACTOR, membershipId: "m2" } as never,
        relationshipId: "r1",
      });
    });
    expect(s.reads()).toBe(4);
  });

  it("outside a run, and in a new run, it is read again", async () => {
    const s = service();
    await s.cached.view({ actor: ACTOR as never, relationshipId: "r1" });
    await s.cached.view({ actor: ACTOR as never, relationshipId: "r1" });
    await withRoundTripCounter(createRoundTripCounter("run-2"), () =>
      s.cached.view({ actor: ACTOR as never, relationshipId: "r1" }),
    );
    expect(s.reads()).toBe(3);
  });
});
