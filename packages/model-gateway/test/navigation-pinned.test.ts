import { describe, expect, it } from "vitest";

import {
  QResultBlockSchema,
  type QNavigateTarget,
  type QResultBlock,
} from "@capital-q/contracts";
import type { NavigationDecisionResult } from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import {
  createQPageMoves,
  gateByReading,
  navigationPaneFromWorkspace,
  pinnedBlocks,
  pinnedLine,
  readingPlacesContext,
  type QNavigationOutcome,
  type QNavigationPane,
} from "../src/q/index.js";

/**
 * Pinned workspace (owner addendum, 13 Nov 2026): while the person has
 * pinned the adjacent workspace, no Q move changes the visible page. A
 * contextual move is offered; an explicit GO is offered as "unpin and
 * open"; NONE still yields nothing; every other guard is unchanged.
 */

const SILO = "11111111-1111-4111-8111-111111111111";
const CARD = "55555555-5555-4555-8555-555555555555";

const pane = (over: Partial<QNavigationPane> = {}): QNavigationPane => ({
  at: { page: "WORK" },
  previous: null,
  pane: "OPEN",
  dirty: false,
  busy: null,
  ...over,
});
const OVERVIEW: QNavigateTarget = {
  page: "COMPANY",
  recordId: SILO,
  tab: "overview",
};
const moved = (target: QNavigateTarget = OVERVIEW): QNavigationOutcome => ({
  decision: "MOVE",
  target,
  openPane: false,
  remembered: null,
  guard: null,
});
const stay = (
  guard: QNavigationOutcome["guard"] = null,
  remembered: QNavigateTarget | null = null,
): QNavigationOutcome => ({
  decision: "STAY",
  target: null,
  openPane: false,
  remembered,
  guard,
});
const nav = (
  mode: "GO" | "CONTEXT" | "OFFER_ONLY" | "NONE",
  negated = false,
  destination: string | null = null,
) => ({ mode, negated, destination }) as never;
const PINNED = pane({ pinned: true });

describe("the screen says the workspace is pinned (contract minor addition)", () => {
  it("pinned: true only when the screen says so; absent is not pinned", () => {
    expect(
      navigationPaneFromWorkspace({
        pagePane: "open",
        qPane: "open",
        at: "/work",
        pinned: true,
      }).pinned,
    ).toBe(true);
    expect(
      navigationPaneFromWorkspace({ pagePane: "open", qPane: "open" }).pinned,
    ).toBeUndefined();
  });
});

describe("gateByReading's PINNED hold", () => {
  it("CONTEXT or no reading: a move becomes a plain offer of the same place", () => {
    for (const navigation of [nav("CONTEXT"), null]) {
      expect(gateByReading(moved(), navigation, { pane: PINNED })).toEqual({
        decision: "OFFER",
        target: OVERVIEW,
        openPane: false,
        remembered: null,
        guard: "PINNED",
      });
    }
  });

  it("GO: a move becomes an unpin-and-open offer; an offer gains unpin", () => {
    expect(gateByReading(moved(), nav("GO"), { pane: PINNED })).toEqual({
      decision: "OFFER",
      target: OVERVIEW,
      openPane: false,
      remembered: null,
      guard: "PINNED",
      unpin: true,
    });
    const offer: QNavigationOutcome = {
      ...moved(),
      decision: "OFFER",
      guard: "UNSAVED_WORK",
    };
    expect(gateByReading(offer, nav("GO"), { pane: PINNED })).toEqual({
      ...offer,
      unpin: true,
    });
  });

  it("a move with the collapsed pane opening is offered too (the pane never opens)", () => {
    expect(
      gateByReading({ ...moved(), openPane: true }, nav("GO"), {
        pane: PINNED,
      }),
    ).toMatchObject({ decision: "OFFER", openPane: false, unpin: true });
  });

  it("NONE, negated and every STAY yield nothing new; the other holds still apply first", () => {
    for (const navigation of [nav("NONE"), nav("GO", true)]) {
      expect(gateByReading(moved(), navigation, { pane: PINNED })).toEqual(
        stay("NOT_ASKED"),
      );
    }
    const remembered = stay("COLLAPSED_PANE", OVERVIEW);
    expect(gateByReading(remembered, nav("CONTEXT"), { pane: PINNED })).toBe(
      remembered,
    );
    expect(
      gateByReading(stay("NO_ACCESS"), nav("GO"), { pane: PINNED }),
    ).toEqual(stay("NO_ACCESS"));
    // SAME_SUBJECT and BACK_AND_FORTH keep the page before PINNED offers it.
    expect(
      gateByReading(moved(), nav("CONTEXT"), {
        pane: { ...PINNED, at: OVERVIEW },
      }),
    ).toEqual(stay("SAME_SUBJECT"));
    expect(
      gateByReading(moved(), nav("CONTEXT"), {
        pane: { ...PINNED, previous: OVERVIEW },
      }),
    ).toEqual(stay("BACK_AND_FORTH"));
    expect(
      gateByReading(moved(), nav("GO"), { pane: PINNED, codeMoves: true }),
    ).toEqual(stay("ANSWER_MOVES"));
    expect(gateByReading(moved(), nav("OFFER_ONLY"), { pane: PINNED })).toEqual(
      { ...moved(), decision: "OFFER", guard: "OFFER_ONLY" },
    );
  });

  it("unpinned: unchanged (the existing behaviour)", () => {
    expect(gateByReading(moved(), nav("GO"), { pane: pane() })).toEqual(
      moved(),
    );
    expect(gateByReading(moved(), nav("CONTEXT"), { pane: pane() })).toEqual(
      moved(),
    );
  });
});

describe("a pinned GO to one of their own screens is placed, never dropped", () => {
  const base = {
    canOpen: () => true,
    config: { movesAllowed: true },
  };
  it("the reader's GO destination is placed through the policy, then offered with unpin", () => {
    for (const proposed of [stay(), stay("UNRESOLVED"), stay("SPLIT_VOTE")]) {
      const placed = readingPlacesContext({
        ...base,
        pane: PINNED,
        proposed,
        navigation: nav("GO", false, "CRM_PIPELINE"),
      });
      expect(placed).toMatchObject({
        decision: "MOVE",
        target: { page: "CRM_PIPELINE" },
      });
      expect(
        gateByReading(placed ?? stay(), nav("GO", false, "CRM_PIPELINE"), {
          pane: PINNED,
        }),
      ).toMatchObject({ decision: "OFFER", guard: "PINNED", unpin: true });
    }
    // Unpinned, a GO is code's fast move (answer.ts), not placed here.
    expect(
      readingPlacesContext({
        ...base,
        pane: pane(),
        proposed: stay(),
        navigation: nav("GO", false, "CRM_PIPELINE"),
      }),
    ).toBeNull();
  });

  it("permission boundary: a place they may not open is never offered", () => {
    const placed = readingPlacesContext({
      ...base,
      canOpen: () => false,
      pane: PINNED,
      proposed: stay(),
      navigation: nav("GO", false, "CRM_PIPELINE"),
    });
    expect(placed).toMatchObject({ decision: "STAY", guard: "NO_ACCESS" });
    expect(
      gateByReading(placed ?? stay(), nav("GO"), { pane: PINNED }),
    ).toMatchObject({ decision: "STAY", target: null });
  });

  it("unsaved work and a collapsed pane keep their own guards", () => {
    expect(
      readingPlacesContext({
        ...base,
        pane: { ...PINNED, dirty: true },
        proposed: stay(),
        navigation: nav("GO", false, "CRM_PIPELINE"),
      }),
    ).toMatchObject({ decision: "OFFER", guard: "UNSAVED_WORK" });
    expect(
      readingPlacesContext({
        ...base,
        pane: { ...PINNED, pane: "COLLAPSED" },
        proposed: stay(),
        navigation: nav("GO", false, "CRM_PIPELINE"),
      }),
    ).toMatchObject({ decision: "STAY", guard: "COLLAPSED_PANE" });
  });
});

const request = (
  runId: string,
  pinned: boolean,
  navigable?: readonly string[],
) =>
  ({
    runId,
    tenantId: "t",
    actorUserId: "u",
    correlationId: "c",
    askerSide: "INVESTOR",
    ...(navigable === undefined
      ? {}
      : { capabilities: { navigate: navigable } }),
    plan: {
      scopes: [],
      screen: {
        route: "WORK",
        workspace: {
          qPane: "open",
          pagePane: "open",
          at: "/work",
          ...(pinned ? { pinned: true } : {}),
        },
      },
    },
  }) as unknown as QAnswerRequest;

const staying = (): NavigationDecisionResult => ({
  decision: "STAY",
  place: null,
  back: false,
  askedForPage: false,
  reason: "",
});

describe("the answer path while pinned (createQPageMoves)", () => {
  const run = async (
    mode: "GO" | "CONTEXT" | "NONE",
    pinned: boolean,
  ): Promise<{ content: string; blocks: readonly unknown[] }[]> => {
    const published: { content: string; blocks: readonly unknown[] }[] = [];
    const moves = createQPageMoves({
      decider: { decide: () => Promise.resolve(staying()) },
      config: { movesAllowed: true },
    });
    const r = request(`pin-${mode}-${String(pinned)}`, pinned);
    moves.start(r, {
      utterance: "the pipeline",
      recentTurns: [],
      pageText: null,
      readingFollows: true,
      publish: (move) => {
        published.push(move);
        return Promise.resolve({ messageId: "m" });
      },
    });
    moves.heard?.(
      r,
      Promise.resolve({
        navigation: nav(mode, false, "CRM_PIPELINE"),
        codeMoves: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    return published;
  };

  it("CONTEXT: the page stays; the place is offered (plain Open)", async () => {
    const published = await run("CONTEXT", true);
    expect(published).toHaveLength(1);
    expect(published[0]?.content).toBe(pinnedLine("Pipeline"));
    const [offer] = published[0]?.blocks ?? [];
    expect(offer).toMatchObject({
      kind: "NAVIGATION_OFFER",
      intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
    });
    expect(offer).not.toHaveProperty("unpin");
    expect(QResultBlockSchema.safeParse(offer).success).toBe(true);
    // No block of the move moves the pane.
    expect(
      published[0]?.blocks.some(
        (block) => (block as { kind: string }).kind === "UI_INTENT",
      ),
    ).toBe(false);
  });

  it("GO: an unpin-and-open offer, never a move", async () => {
    const published = await run("GO", true);
    expect(published).toHaveLength(1);
    const [offer] = published[0]?.blocks ?? [];
    expect(offer).toMatchObject({ kind: "NAVIGATION_OFFER", unpin: true });
    expect(QResultBlockSchema.safeParse(offer).success).toBe(true);
  });

  it("NONE: nothing, pinned or not; unpinned CONTEXT still moves", async () => {
    expect(await run("NONE", true)).toEqual([]);
    expect(await run("NONE", false)).toEqual([]);
    const unpinned = await run("CONTEXT", false);
    expect(unpinned[0]?.content).toBe("I've opened Pipeline.");
  });
});

describe("settle while pinned: the answer's own moves are offered", () => {
  const navigate: QResultBlock = {
    kind: "UI_INTENT",
    intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
  };
  const text: QResultBlock = { kind: "TEXT", text: "Three deals are open." };
  const viewer: QResultBlock = {
    kind: "UI_INTENT",
    intent: { kind: "OPEN_RECORD_PAGE", page: "DOCUMENT", id: CARD },
  };
  const selectTab = {
    kind: "UI_INTENT",
    intent: {
      kind: "UI_ACT",
      actId: "uia_tab0000001",
      act: "SELECT_TAB",
      target: "tab.elevator",
    },
  } as unknown as QResultBlock;
  const moves = () =>
    createQPageMoves({
      decider: { decide: () => Promise.resolve(staying()) },
      config: { movesAllowed: true },
    });

  it("code's exact command becomes an unpin-and-open offer; conversation and a viewer open pass", async () => {
    const settled = await moves().settle(
      request("pin-settle-1", true),
      [text, navigate, viewer, selectTab],
      { keepAnswerMoves: true },
    );
    expect(settled).toEqual([
      text,
      {
        kind: "NAVIGATION_OFFER",
        intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
        place: "Pipeline",
        openLabel: "Open Pipeline",
        unpin: true,
      },
      viewer,
    ]);
    for (const block of settled ?? [])
      expect(QResultBlockSchema.safeParse(block).success).toBe(true);
  });

  it("unpinned: the exact command stands (unchanged)", async () => {
    const blocks = [text, navigate];
    expect(
      await moves().settle(request("pin-settle-2", false), blocks, {
        keepAnswerMoves: true,
      }),
    ).toEqual(blocks);
  });

  it("an offer of the same place is made once", () => {
    const offer: QResultBlock = {
      kind: "NAVIGATION_OFFER",
      intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
      place: "Pipeline",
      openLabel: "Open Pipeline",
    };
    expect(
      pinnedBlocks([offer, navigate], {
        explicit: true,
        canOpen: () => true,
        title: () => "Pipeline",
      }),
    ).toEqual([offer]);
  });

  it("permission boundary: a place they may not open is held, never offered", () => {
    expect(
      pinnedBlocks([text, navigate], {
        explicit: true,
        canOpen: () => false,
        title: () => "Pipeline",
      }),
    ).toEqual([text]);
    // This run's capability manifest does not list the pipeline: held.
    return moves()
      .settle(request("pin-settle-3", true, ["DISCOVER"]), [text, navigate], {
        keepAnswerMoves: true,
      })
      .then((settled) => {
        expect(settled).toEqual([text]);
      });
  });
});

describe("contextual moves land with the reading, not after the decider", () => {
  const slowDecider = (delayMs: number, result: NavigationDecisionResult) => ({
    decide: () =>
      new Promise<NavigationDecisionResult>((resolve) =>
        setTimeout(() => resolve(result), delayMs),
      ),
  });
  const team: NavigationDecisionResult = {
    decision: "MOVE",
    place: {
      route: "/work",
      record: null,
      tab: "team",
      document: null,
      slide: null,
      sectionId: null,
      position: null,
    },
    back: false,
    askedForPage: false,
    reason: "",
  };
  const start = (
    runId: string,
    decider: ReturnType<typeof slowDecider>,
    pinned = false,
    at?: string,
  ) => {
    const published: { content: string; at: number }[] = [];
    const moves = createQPageMoves({
      decider,
      config: { movesAllowed: true },
    });
    const base = request(runId, pinned);
    const r =
      at === undefined
        ? base
        : ({
            ...base,
            plan: {
              scopes: [],
              screen: {
                route: "WORK",
                workspace: { qPane: "open", pagePane: "open", at },
              },
            },
          } as unknown as QAnswerRequest);
    const t0 = Date.now();
    moves.start(r, {
      utterance: "who should I follow up with this week?",
      recentTurns: [],
      pageText: null,
      readingFollows: true,
      publish: (move) => {
        published.push({ content: move.content, at: Date.now() - t0 });
        return Promise.resolve({ messageId: "m" });
      },
    });
    return { moves, r, published };
  };
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("CONTEXT with a destination is published when the reading lands, before a slow decider", async () => {
    const { moves, r, published } = start(
      "fast-ctx",
      slowDecider(400, staying()),
    );
    moves.heard?.(
      r,
      Promise.resolve({ navigation: nav("CONTEXT", false, "CRM_PIPELINE") }),
    );
    await wait(50);
    expect(published).toHaveLength(1);
    expect(published[0]?.content).toBe("I've opened Pipeline.");
    expect(published[0]?.at).toBeLessThan(100);
  });

  it("a later decider verdict for another place never moves a second time", async () => {
    const { moves, r, published } = start("fast-ctx-2", slowDecider(80, team));
    moves.heard?.(
      r,
      Promise.resolve({ navigation: nav("CONTEXT", false, "CRM_PIPELINE") }),
    );
    await wait(200);
    expect(published.map((one) => one.content)).toEqual([
      "I've opened Pipeline.",
    ]);
  });

  it("pinned: the early placement is an offer, never a move", async () => {
    const { moves, r, published } = start(
      "fast-ctx-pin",
      slowDecider(400, staying()),
      true,
    );
    moves.heard?.(
      r,
      Promise.resolve({ navigation: nav("CONTEXT", false, "CRM_PIPELINE") }),
    );
    await wait(50);
    expect(published.map((one) => one.content)).toEqual([
      pinnedLine("Pipeline"),
    ]);
  });

  it("NONE, negated and OFFER_ONLY place nothing early; CONTEXT without a destination waits for the decider", async () => {
    for (const navigation of [
      nav("NONE", false, "CRM_PIPELINE"),
      nav("CONTEXT", true, "CRM_PIPELINE"),
      nav("OFFER_ONLY", false, "CRM_PIPELINE"),
    ]) {
      const { moves, r, published } = start(
        `fast-none-${JSON.stringify(navigation)}`,
        slowDecider(150, team),
      );
      moves.heard?.(r, Promise.resolve({ navigation }));
      await wait(50);
      expect(published).toEqual([]);
    }
    const { moves, r, published } = start(
      "fast-ctx-none",
      slowDecider(80, team),
    );
    moves.heard?.(r, Promise.resolve({ navigation: nav("CONTEXT") }));
    await wait(30);
    expect(published).toEqual([]);
    await wait(150);
    expect(published).toHaveLength(1);
    expect(published[0]?.at).toBeGreaterThanOrEqual(75);
  });

  it("the pane already on that subject keeps it (SAME_SUBJECT holds early too)", async () => {
    const { moves, r, published } = start(
      "fast-same",
      slowDecider(100, staying()),
      false,
      "/relationships?view=pipeline",
    );
    moves.heard?.(
      r,
      Promise.resolve({ navigation: nav("CONTEXT", false, "CRM_PIPELINE") }),
    );
    await wait(200);
    expect(published).toEqual([]);
  });
});
