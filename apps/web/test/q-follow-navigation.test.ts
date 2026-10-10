import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createQStreamState } from "@capital-q/api-client";

import { turnsFrom, type QTurn } from "../src/features/q/conversation";
import {
  followOfThread,
  navigationToFollow,
  noteTypedRun,
  seenAtOpen,
} from "../src/features/q/follow-navigation";
import { destinationPath } from "../src/features/voice/destinations";
import { loadWire } from "../src/features/q/wire";

// W7: the wire's contracts load after the first paint in the browser;
// here they are in before any test reads Q's data.
beforeAll(async () => {
  await loadWire();
});

/**
 * A typed "take me to Discover" moves the screen (CQ-QACT-001, F8): the
 * answer's NAVIGATE intent is followed through the spoken navigation's own
 * route map, once, and never for an answer that was already on screen.
 */

function qTurn(
  id: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"],
  streaming = false,
): QTurn {
  return {
    kind: "Q",
    id,
    text: "Taking you to Discover.",
    streaming,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}

const toDiscover = [
  {
    kind: "UI_INTENT" as const,
    intent: { kind: "NAVIGATE" as const, destination: "DISCOVER" as const },
  },
];

describe("following a navigation Q announced", () => {
  it("follows a new answer's NAVIGATE intent to the same route voice uses, once", () => {
    const seen = new Set<string>();
    const turns = [qTurn("m1", toDiscover)];
    const destination = navigationToFollow(turns, seen);
    expect(destination).toBe("DISCOVER");
    expect(destinationPath(destination)).toBe("/discover");
    expect(navigationToFollow(turns, seen)).toBeNull();
  });

  it("never follows an answer that was already on screen when the conversation opened", () => {
    const seen = new Set<string>(["m1"]);
    expect(navigationToFollow([qTurn("m1", toDiscover)], seen)).toBeNull();
  });

  it("waits for a streaming answer to finish, and ignores answers without an intent", () => {
    const seen = new Set<string>();
    expect(
      navigationToFollow([qTurn("m2", toDiscover, true)], seen),
    ).toBeNull();
    expect(navigationToFollow([qTurn("m3", [])], seen)).toBeNull();
    expect(navigationToFollow([qTurn("m2", toDiscover)], seen)).toBe(
      "DISCOVER",
    );
  });
});

describe("a typed question's move while a voice line is open (n-founder-strings, 2026-10-09)", () => {
  const toRehearsals = [
    {
      kind: "UI_INTENT" as const,
      intent: { kind: "NAVIGATE" as const, destination: "REHEARSALS" as const },
    },
  ];
  const answerOf = (id: string, runId: string): QTurn => ({
    ...(qTurn(id, toRehearsals) as Extract<QTurn, { kind: "Q" }>),
    runId,
  });

  it("is made here: the voice board never carries a typed answer", () => {
    const seen = new Set<string>();
    const followed = followOfThread([answerOf("m1", "run-typed")], seen, {
      active: true,
      typedRuns: new Set(["run-typed"]),
    });
    expect(followed.navigate).toBe("REHEARSALS");
  });

  it("a spoken answer's move is left to the voice board, and never made here later", () => {
    const seen = new Set<string>();
    const spoken = [answerOf("m2", "run-spoken")];
    expect(
      followOfThread(spoken, seen, { active: true, typedRuns: new Set() })
        .navigate,
    ).toBeNull();
    // The line ends: the spoken answer is not followed a second time.
    expect(
      followOfThread(spoken, seen, { active: false, typedRuns: new Set() })
        .navigate,
    ).toBeNull();
  });

  it("with no voice line, a new answer of a run this page followed live is followed; one from elsewhere is not (G2)", () => {
    expect(
      followOfThread([answerOf("m3", "run-spoken")], new Set(), {
        active: false,
        typedRuns: new Set(),
        liveRuns: new Set(["run-spoken"]),
      }).navigate,
    ).toBe("REHEARSALS");
    expect(
      followOfThread([answerOf("m4", "run-elsewhere")], new Set(), {
        active: false,
        typedRuns: new Set(),
        liveRuns: new Set(),
      }).navigate,
    ).toBeNull();
  });

  it("a typed run noted in this tab is followed by a surface set up again since (rerun 18:21)", () => {
    noteTypedRun("run-before-remount");
    // A fresh surface: its own followed set, no set of its own to pass.
    const followed = followOfThread(
      [answerOf("m4", "run-before-remount")],
      new Set(),
      { active: true },
    );
    expect(followed.navigate).toBe("REHEARSALS");
  });
});

describe("what is already there when a conversation opens (G2 follow-up)", () => {
  const SINCE = Date.parse("2026-10-10T10:00:00.000Z");
  const dated = (id: string, at: string): QTurn => ({
    ...(qTurn(id, toDiscover) as Extract<QTurn, { kind: "Q" }>),
    at,
  });

  it("an answer still streaming from a run this tab never started is already there: /home never bounces", () => {
    // The person asked something in this tab a minute ago, then opened
    // Home; Home's conversation has an older run still streaming.
    const streaming = {
      ...(qTurn("old-run-msg", [], true) as Extract<QTurn, { kind: "Q" }>),
      runId: "run-from-elsewhere",
    };
    const seen = seenAtOpen([streaming], SINCE, new Set(["run-typed-here"]));
    expect(seen.has("old-run-msg")).toBe(true);
    // Its persisted message (same id) lands with a NAVIGATE: not followed.
    expect(
      navigationToFollow([qTurn("old-run-msg", toDiscover)], seen),
    ).toBeNull();
  });

  it("G-D16 stays: the answer to what they just typed, still streaming at open, is followed", () => {
    const streaming = {
      ...(qTurn("fresh-msg", [], true) as Extract<QTurn, { kind: "Q" }>),
      runId: "run-typed-here",
    };
    const seen = seenAtOpen([streaming], SINCE, new Set(["run-typed-here"]));
    expect(seen.has("fresh-msg")).toBe(false);
    expect(navigationToFollow([qTurn("fresh-msg", toDiscover)], seen)).toBe(
      "DISCOVER",
    );
  });

  it("persisted answers: older than the question are there, newer are followed; nothing asked, all are there", () => {
    const old = dated("a", "2026-10-10T09:55:00.000Z");
    const fresh = dated("b", "2026-10-10T10:00:01.000Z");
    expect([...seenAtOpen([old, fresh], SINCE, new Set())]).toEqual(["a"]);
    expect([...seenAtOpen([old, fresh], null, new Set())]).toEqual(["a", "b"]);
  });

  it("the live turn carries its run, so the rule above can tell", () => {
    const state = {
      ...createQStreamState(),
      runId: "run-1",
      partial: { messageId: "m-live", text: "Opening Discover" },
    };
    const live = turnsFrom(state, []).at(-1);
    expect(live?.kind === "Q" ? live.runId : null).toBe("run-1");
  });
});

describe("an answer from before this page load never moves (G2 gate cd52c0ea)", () => {
  const NOW = Date.parse("2026-10-10T10:00:00.000Z");
  const answerOf = (id: string, runId: string, at: number): QTurn => ({
    ...(qTurn(id, toDiscover) as Extract<QTurn, { kind: "Q" }>),
    runId,
    at: new Date(at).toISOString(),
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const skewMs of [-120_000, 0, 120_000]) {
    it(`browser clock ${String(skewMs / 60_000)} min off: earlier runs' answers never move; this tab's typed run does (G-D16)`, () => {
      vi.useFakeTimers({ now: NOW + skewMs });
      const typed = new Set(["run-typed"]);
      const live = new Set<string>();
      // Opened with nothing on screen; nothing asked yet.
      const seen = seenAtOpen([], null, typed);
      // The room feed hands in the matrix's answers (recorded by the
      // server seconds ago, whatever this clock says).
      const backlog = [
        answerOf("r1", "run-old-1", NOW - 20_000),
        answerOf("r2", "run-old-2", NOW - 5_000),
      ];
      const stale = followOfThread(backlog, seen, {
        active: false,
        typedRuns: typed,
        liveRuns: live,
      });
      expect(stale.navigate).toBeNull();
      expect(stale.actions).toEqual([]);
      // The answer to what they just typed here, recorded by the server
      // after the browser's "now" or before it: followed either way.
      const fresh = followOfThread(
        [...backlog, answerOf("mine", "run-typed", NOW + 3_000 - skewMs * 2)],
        seen,
        { active: false, typedRuns: typed, liveRuns: live },
      );
      expect(fresh.navigate).toBe("DISCOVER");
    });
  }

  it("G-D16 with the laptop clock 2 min fast: the conversation reloading as the answer lands still follows this tab's run", () => {
    // since (browser) is 2 min ahead of the server's recorded-at.
    const since = NOW + 120_000;
    const seen = seenAtOpen(
      [answerOf("landing", "run-typed", NOW + 1_000)],
      since,
      new Set(["run-typed"]),
    );
    expect(seen.has("landing")).toBe(false);
  });

  it("a run this page followed live after open may move them", () => {
    const seen = new Set<string>();
    const followed = followOfThread([answerOf("x", "run-live", NOW)], seen, {
      active: false,
      typedRuns: new Set(),
      liveRuns: new Set(["run-live"]),
    });
    expect(followed.navigate).toBe("DISCOVER");
  });
});

describe("B6 guard: following never takes an answer's cards off the thread", () => {
  it("seenAtOpen and followOfThread only mark turns seen; every turn and block stays", () => {
    const turns: QTurn[] = [
      {
        ...(qTurn("old", toDiscover) as Extract<QTurn, { kind: "Q" }>),
        runId: "run-old",
      },
      {
        ...(qTurn("live", [], true) as Extract<QTurn, { kind: "Q" }>),
        runId: "run-live",
      },
    ];
    const before = structuredClone(turns);
    const seen = seenAtOpen(turns, Date.now(), new Set(["run-live"]));
    followOfThread(turns, seen, {
      active: false,
      typedRuns: new Set(),
      liveRuns: new Set(),
    });
    expect(turns).toEqual(before);
  });
});
