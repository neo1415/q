import { describe, expect, it } from "vitest";

import type {
  DiscoveredCompanyDto,
  DiscoveryCompanySlateDto,
} from "@capital-q/contracts";

import {
  CONSTRAINED_PREFETCH_BUDGET,
  DEFAULT_PREFETCH_BUDGET,
  INITIAL_FEED_STATE,
  activeCard,
  canAdvance,
  canRetreat,
  decisionFor,
  feedReducer,
  isDecisionPending,
  prefetchWindow,
  shouldLoadMore,
  type FeedAction,
  type FeedState,
} from "../src/features/discover/feed/feed-state";

/**
 * The feed as arithmetic (CQ-WEB-020).
 *
 * Everything here runs without React, a network or a browser, which is the
 * point of the split: the rules that matter -- the order is the server's,
 * a failed save leaves no trace, a rebuilt slate is not more pages of the
 * old one -- are properties of a function and are checked as such.
 */

const SLATE_A = "11111111-1111-4111-8111-111111111111";
const SLATE_B = "22222222-2222-4222-8222-222222222222";

function company(n: number): DiscoveredCompanyDto {
  return {
    companyId: `c-${n}`,
    canonicalName: `Company ${n}`,
    websiteUrl: null,
    headquartersCountry: null,
    currentStageCode: null,
    shortDescription: null,
    reasons: [],
    reasonCodes: [],
    pitch: null,
  };
}

function slate(
  companies: readonly number[],
  overrides: Partial<DiscoveryCompanySlateDto> = {},
): DiscoveryCompanySlateDto {
  return {
    slateId: SLATE_A,
    rankingVersion: "declared.v1",
    items: companies.map(company),
    notes: [],
    nextCursor: null,
    ...overrides,
  };
}

function run(actions: readonly FeedAction[], from = INITIAL_FEED_STATE) {
  return actions.reduce(feedReducer, from);
}

function loaded(
  companies: readonly number[],
  overrides: Partial<DiscoveryCompanySlateDto> = {},
): FeedState {
  return run([
    { type: "LOAD_STARTED" },
    { type: "PAGE_LOADED", slate: slate(companies, overrides) },
  ]);
}

describe("loading the first page", () => {
  it("takes the server's order, ids and ranking version verbatim", () => {
    const state = loaded([1, 2, 3]);

    expect(state.status).toBe("READY");
    expect(state.slateId).toBe(SLATE_A);
    expect(state.rankingVersion).toBe("declared.v1");
    expect(state.items.map((item) => item.companyId)).toEqual([
      "c-1",
      "c-2",
      "c-3",
    ]);
    expect(activeCard(state)?.companyId).toBe("c-1");
  });

  it("reports LOADING_FIRST before anything has arrived, LOADING_MORE after", () => {
    const first = run([{ type: "LOAD_STARTED" }]);
    expect(first.status).toBe("LOADING_FIRST");

    const more = run([{ type: "LOAD_STARTED" }], loaded([1, 2]));
    expect(more.status).toBe("LOADING_MORE");
  });

  it("keeps the cards already on screen when a later page fails", () => {
    const state = run([{ type: "LOAD_FAILED" }], loaded([1, 2, 3]));

    expect(state.status).toBe("FAILED");
    expect(state.items).toHaveLength(3);
    expect(activeCard(state)?.companyId).toBe("c-1");
  });

  it("has no active card and no window when the slate is empty", () => {
    const state = loaded([]);

    expect(activeCard(state)).toBeNull();
    expect(prefetchWindow(state).active).toBeNull();
    expect(canAdvance(state)).toBe(false);
    expect(canRetreat(state)).toBe(false);
  });
});

describe("moving through the feed", () => {
  it("advances and retreats one card at a time", () => {
    const state = run(
      [{ type: "ADVANCED" }, { type: "ADVANCED" }],
      loaded([1, 2, 3]),
    );

    expect(activeCard(state)?.companyId).toBe("c-3");
    expect(
      activeCard(feedReducer(state, { type: "RETREATED" }))?.companyId,
    ).toBe("c-2");
  });

  it("stops at the last card rather than running off the end", () => {
    const state = run(
      [{ type: "ADVANCED" }, { type: "ADVANCED" }, { type: "ADVANCED" }],
      loaded([1, 2]),
    );

    expect(state.index).toBe(1);
    expect(canAdvance(state)).toBe(false);
  });

  it("stops at the first card rather than going negative", () => {
    const state = run(
      [{ type: "RETREATED" }, { type: "RETREATED" }],
      loaded([1, 2]),
    );

    expect(state.index).toBe(0);
    expect(canRetreat(state)).toBe(false);
  });

  it("records nothing when a card becomes active -- viewing is not interest", () => {
    const state = run([{ type: "ADVANCED" }], loaded([1, 2, 3]));

    expect(decisionFor(state, "c-2")).toEqual({ saved: false, passed: false });
    expect(state.pending).toEqual({});
  });

  it("ignores a move to a card that is not in the slate", () => {
    const state = feedReducer(loaded([1, 2]), {
      type: "MOVED_TO",
      companyId: "c-99",
    });

    expect(state.index).toBe(0);
  });
});

describe("the prefetch window", () => {
  it("gives one card ACTIVE, buffers the next, posters the one after", () => {
    const state = run(
      [{ type: "ADVANCED" }, { type: "ADVANCED" }],
      loaded([1, 2, 3, 4, 5, 6]),
    );
    const at = prefetchWindow(state, DEFAULT_PREFETCH_BUDGET);

    expect(at.active).toBe("c-3");
    expect(at.policyByCompanyId["c-3"]).toBe("ACTIVE");
    expect(at.policyByCompanyId["c-4"]).toBe("STARTUP_BUFFER");
    expect(at.policyByCompanyId["c-5"]).toBe("POSTER");
    // Behind stays lightweight but resident, so a retreat is not a reload.
    expect(at.policyByCompanyId["c-2"]).toBe("POSTER");
  });

  it("leaves everything outside the budget cold", () => {
    const state = run(
      [{ type: "ADVANCED" }, { type: "ADVANCED" }],
      loaded([1, 2, 3, 4, 5, 6]),
    );
    const at = prefetchWindow(state, DEFAULT_PREFETCH_BUDGET);

    expect(at.policyByCompanyId["c-1"]).toBe("NONE");
    expect(at.policyByCompanyId["c-6"]).toBe("NONE");
    expect(at.cold).toEqual(["c-1", "c-6"]);
    expect(at.warm).toEqual(["c-2", "c-4", "c-5"]);
  });

  it("buffers nothing ahead on a constrained connection", () => {
    const state = run([{ type: "ADVANCED" }], loaded([1, 2, 3, 4]));
    const at = prefetchWindow(state, CONSTRAINED_PREFETCH_BUDGET);

    expect(at.active).toBe("c-2");
    expect(at.policyByCompanyId["c-3"]).toBe("POSTER");
    expect(at.policyByCompanyId["c-1"]).toBe("NONE");
    expect(at.policyByCompanyId["c-4"]).toBe("NONE");
    expect(
      Object.values(at.policyByCompanyId).filter(
        (policy) => policy === "STARTUP_BUFFER",
      ),
    ).toHaveLength(0);
  });

  it("names exactly one active card, so only one player can own playback", () => {
    const state = run([{ type: "ADVANCED" }], loaded([1, 2, 3, 4]));
    const at = prefetchWindow(state);

    const actives = Object.values(at.policyByCompanyId).filter(
      (policy) => policy === "ACTIVE",
    );
    expect(actives).toHaveLength(1);
    expect(at.active).toBe("c-2");
    expect(at.warm).not.toContain("c-2");
    expect(at.cold).not.toContain("c-2");
  });
});

describe("a save made on an earlier visit (R30 #7)", () => {
  it("reads the server's saved mark until the person decides again", () => {
    const page = slate([1, 2]);
    const withSaved: DiscoveryCompanySlateDto = {
      ...page,
      items: page.items.map((item) =>
        item.companyId === "c-1" ? { ...item, viewerSaved: true } : item,
      ),
    };
    const state = run([
      { type: "LOAD_STARTED" },
      { type: "PAGE_LOADED", slate: withSaved },
    ]);
    expect(decisionFor(state, "c-1")).toEqual({ saved: true, passed: false });
    expect(decisionFor(state, "c-2")).toEqual({ saved: false, passed: false });

    const unsaved = feedReducer(state, {
      type: "DECISION_REQUESTED",
      companyId: "c-1",
      intent: "UNSAVE",
    });
    expect(decisionFor(unsaved, "c-1").saved).toBe(false);
    // A failed unsave puts back what the server had, not "undecided".
    const failed = feedReducer(unsaved, {
      type: "DECISION_FAILED",
      companyId: "c-1",
    });
    expect(decisionFor(failed, "c-1").saved).toBe(true);
  });
});

describe("optimistic save and pass", () => {
  it("shows a save immediately, before the server has answered", () => {
    const state = feedReducer(loaded([1, 2]), {
      type: "DECISION_REQUESTED",
      companyId: "c-1",
      intent: "SAVE",
    });

    expect(decisionFor(state, "c-1").saved).toBe(true);
    expect(isDecisionPending(state, "c-1")).toBe(true);
  });

  it("reverts a save the server rejected", () => {
    const state = run(
      [
        { type: "DECISION_REQUESTED", companyId: "c-1", intent: "SAVE" },
        { type: "DECISION_FAILED", companyId: "c-1" },
      ],
      loaded([1, 2]),
    );

    expect(decisionFor(state, "c-1")).toEqual({ saved: false, passed: false });
    expect(isDecisionPending(state, "c-1")).toBe(false);
  });

  it("reverts to what was true before, not to undecided", () => {
    const state = run(
      [
        { type: "DECISION_REQUESTED", companyId: "c-1", intent: "SAVE" },
        {
          type: "DECISION_CONFIRMED",
          companyId: "c-1",
          state: { saved: true, passed: false },
        },
        { type: "DECISION_REQUESTED", companyId: "c-1", intent: "UNSAVE" },
        { type: "DECISION_FAILED", companyId: "c-1" },
      ],
      loaded([1, 2]),
    );

    expect(decisionFor(state, "c-1").saved).toBe(true);
  });

  it("keeps a pass the server accepted, and takes the server's own state", () => {
    const state = run(
      [
        { type: "DECISION_REQUESTED", companyId: "c-2", intent: "PASS" },
        {
          type: "DECISION_CONFIRMED",
          companyId: "c-2",
          state: { saved: false, passed: true },
        },
      ],
      loaded([1, 2]),
    );

    expect(decisionFor(state, "c-2")).toEqual({ saved: false, passed: true });
    expect(isDecisionPending(state, "c-2")).toBe(false);
  });

  it("leaves the optimistic flag standing when the server states no outcome", () => {
    const state = run(
      [
        { type: "DECISION_REQUESTED", companyId: "c-1", intent: "PASS" },
        { type: "DECISION_CONFIRMED", companyId: "c-1", state: null },
      ],
      loaded([1, 2]),
    );

    expect(decisionFor(state, "c-1").passed).toBe(true);
    expect(isDecisionPending(state, "c-1")).toBe(false);
  });

  it("does not move the reader, because a decision is not a swipe", () => {
    const state = feedReducer(loaded([1, 2, 3]), {
      type: "DECISION_REQUESTED",
      companyId: "c-1",
      intent: "PASS",
    });

    expect(state.index).toBe(0);
  });

  it("ignores a failure for a decision that was never in flight", () => {
    const before = loaded([1, 2]);
    expect(
      feedReducer(before, { type: "DECISION_FAILED", companyId: "c-1" }),
    ).toBe(before);
  });
});

describe("cursor continuation", () => {
  it("appends the next page and keeps the reader where they were", () => {
    const first = run(
      [{ type: "ADVANCED" }],
      loaded([1, 2, 3], { nextCursor: "cursor-2" }),
    );
    const state = feedReducer(first, {
      type: "PAGE_LOADED",
      slate: slate([4, 5], { nextCursor: null }),
    });

    expect(state.items.map((item) => item.companyId)).toEqual([
      "c-1",
      "c-2",
      "c-3",
      "c-4",
      "c-5",
    ]);
    expect(activeCard(state)?.companyId).toBe("c-2");
    expect(state.nextCursor).toBeNull();
  });

  it("does not duplicate cards when a cursor is replayed", () => {
    const first = loaded([1, 2, 3], { nextCursor: "cursor-2" });
    const state = run(
      [
        {
          type: "PAGE_LOADED",
          slate: slate([3, 4], { nextCursor: "cursor-3" }),
        },
        {
          type: "PAGE_LOADED",
          slate: slate([3, 4], { nextCursor: "cursor-3" }),
        },
      ],
      first,
    );

    expect(state.items.map((item) => item.companyId)).toEqual([
      "c-1",
      "c-2",
      "c-3",
      "c-4",
    ]);
  });

  it("asks for more only when the reader is near the end and a cursor exists", () => {
    const withCursor = loaded([1, 2, 3, 4, 5, 6], { nextCursor: "cursor-2" });
    expect(shouldLoadMore(withCursor, 1)).toBe(false);
    expect(shouldLoadMore(run([{ type: "ADVANCED" }], withCursor), 1)).toBe(
      false,
    );

    const nearEnd = run(
      [
        { type: "ADVANCED" },
        { type: "ADVANCED" },
        { type: "ADVANCED" },
        { type: "ADVANCED" },
      ],
      withCursor,
    );
    expect(shouldLoadMore(nearEnd, 1)).toBe(true);

    const exhausted = loaded([1, 2], { nextCursor: null });
    expect(shouldLoadMore(exhausted, 1)).toBe(false);
  });

  it("starts again rather than splicing two rankings when the slate was rebuilt", () => {
    const first = run(
      [{ type: "ADVANCED" }],
      loaded([1, 2, 3], { nextCursor: "cursor-2" }),
    );
    const state = feedReducer(first, {
      type: "PAGE_LOADED",
      slate: slate([7, 8], {
        slateId: SLATE_B,
        notes: ["SLATE_RESTARTED"],
        nextCursor: null,
      }),
    });

    expect(state.slateId).toBe(SLATE_B);
    expect(state.items.map((item) => item.companyId)).toEqual(["c-7", "c-8"]);
    expect(state.index).toBe(0);
    expect(state.notes).toEqual(["SLATE_RESTARTED"]);
  });

  it("keeps decisions across a rebuild -- they are about companies, not order", () => {
    const first = run(
      [
        { type: "DECISION_REQUESTED", companyId: "c-1", intent: "SAVE" },
        {
          type: "DECISION_CONFIRMED",
          companyId: "c-1",
          state: { saved: true, passed: false },
        },
      ],
      loaded([1, 2], { nextCursor: "cursor-2" }),
    );
    const state = feedReducer(first, {
      type: "PAGE_LOADED",
      slate: slate([1, 9], { slateId: SLATE_B, nextCursor: null }),
    });

    expect(decisionFor(state, "c-1").saved).toBe(true);
  });
});

describe("restoring a position", () => {
  it("returns to the same card id after company profile -> Back", () => {
    const state = feedReducer(loaded([1, 2, 3, 4]), {
      type: "RESTORE_REQUESTED",
      companyId: "c-3",
    });

    expect(activeCard(state)?.companyId).toBe("c-3");
    expect(state.restoreTargetCompanyId).toBeNull();
  });

  it("keeps paging until the remembered card arrives", () => {
    const first = loaded([1, 2], { nextCursor: "cursor-2" });
    const chasing = feedReducer(first, {
      type: "RESTORE_REQUESTED",
      companyId: "c-4",
    });

    // Not here yet, so the target is held and the cursor is still open.
    expect(chasing.restoreTargetCompanyId).toBe("c-4");
    expect(chasing.index).toBe(0);

    const arrived = feedReducer(chasing, {
      type: "PAGE_LOADED",
      slate: slate([3, 4], { nextCursor: null }),
    });

    expect(activeCard(arrived)?.companyId).toBe("c-4");
    expect(arrived.restoreTargetCompanyId).toBeNull();
  });

  it("gives up once the cursor is spent and the card never appeared", () => {
    const state = feedReducer(loaded([1, 2], { nextCursor: null }), {
      type: "RESTORE_REQUESTED",
      companyId: "c-9",
    });

    expect(state.restoreTargetCompanyId).toBeNull();
    expect(activeCard(state)?.companyId).toBe("c-1");
  });
});
