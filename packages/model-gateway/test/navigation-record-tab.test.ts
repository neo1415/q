import { describe, expect, it } from "vitest";

import type { NavigationDecisionResult } from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import {
  createQPageMoves,
  readingTabPlace,
  type QNavigationOutcome,
  type QNavigationRecords,
} from "../src/q/index.js";

/**
 * Record tabs (owner clarification, 13 Nov 2026; TURN_READER v87): the
 * page-move decision runs beside the reading and never sees its tab. With
 * Clinicrest's Overview in the pane, "Can I see their data room?" (read
 * CONTEXT, tab dataroom) was a SAME_SUBJECT stay. The reading's tab now
 * lands on the decision's record, or on the record in the pane, through
 * the same policy and holds (pinned, NONE). Readings are fixtures.
 */

const CLINICREST = "6b2f0000-0000-4000-8000-000000000001";
const LEDGERLINE = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
const RECORDS: QNavigationRecords = {
  companies: [
    { id: CLINICREST, name: "Clinicrest" },
    { id: LEDGERLINE, name: "Ledgerline" },
  ],
  investors: [],
  things: [],
  deleted: [],
};

const request = (
  runId: string,
  options: { readonly at?: string; readonly pinned?: boolean } = {},
) =>
  ({
    runId,
    tenantId: "t",
    actorUserId: "u",
    correlationId: "c",
    askerSide: "INVESTOR",
    plan: {
      scopes: [],
      screen: {
        route: "COMPANY",
        workspace: {
          qPane: "open",
          pagePane: "open",
          at: options.at ?? `/company/${CLINICREST}`,
          ...(options.pinned === true ? { pinned: true } : {}),
        },
      },
    },
  }) as unknown as QAnswerRequest;

const clinicrest = (decision: "MOVE" | "STAY"): NavigationDecisionResult => ({
  decision,
  place:
    decision === "STAY"
      ? null
      : {
          route: "/company/[companyId]",
          record: { kind: "COMPANY", name: "Clinicrest" },
          tab: null,
          document: null,
          slide: null,
          sectionId: null,
          position: null,
        },
  back: false,
  askedForPage: false,
  reason: "",
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One turn in the workspace: the decision, then the reading, published. */
function turn(options: {
  readonly id: string;
  readonly said: string;
  readonly decision: NavigationDecisionResult;
  readonly mode: "GO" | "CONTEXT" | "NONE" | "OFFER_ONLY";
  readonly tab: string | null;
  readonly at?: string;
  readonly pinned?: boolean;
}) {
  const published: { content: string; blocks: readonly unknown[] }[] = [];
  const moves = createQPageMoves({
    decider: {
      decide: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(options.decision), 20),
        ),
    },
    records: () => Promise.resolve(RECORDS),
    config: { movesAllowed: true },
  });
  const r = request(options.id, {
    ...(options.at === undefined ? {} : { at: options.at }),
    ...(options.pinned === true ? { pinned: true } : {}),
  });
  moves.start(r, {
    utterance: options.said,
    recentTurns: [],
    pageText: null,
    readingFollows: true,
    publish: (move) => {
      published.push(move);
      return Promise.resolve({ messageId: `m${String(published.length)}` });
    },
  });
  moves.heard?.(
    r,
    Promise.resolve({
      navigation: {
        mode: options.mode,
        negated: false,
        destination: null,
        tab: options.tab,
      } as never,
    }),
  );
  return published;
}

const blocksOf = (
  published: readonly { readonly blocks: readonly unknown[] }[],
  kind: "UI_INTENT" | "NAVIGATION_OFFER",
) =>
  published.flatMap((one) =>
    one.blocks.flatMap((block) => {
      const b = block as { kind: string; intent?: unknown };
      return b.kind === kind ? [b.intent] : [];
    }),
  );

describe("the reading's record tab reaches the page move (v87)", () => {
  it("Clinicrest's Overview in the pane, 'Can I see their data room?' (CONTEXT, dataroom) moves to its data room tab", async () => {
    const published = turn({
      id: "tab-context-stay",
      said: "Can I see their data room?",
      decision: clinicrest("STAY"),
      mode: "CONTEXT",
      tab: "dataroom",
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: CLINICREST,
        tab: "dataroom",
      },
    ]);
  });

  it("the decision's bare record (a SAME_SUBJECT stay before) gets the reading's tab", async () => {
    const published = turn({
      id: "tab-context-move",
      said: "What's in Clinicrest's data room?",
      decision: clinicrest("MOVE"),
      mode: "CONTEXT",
      tab: "dataroom",
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: CLINICREST,
        tab: "dataroom",
      },
    ]);
  });

  it("from another page, GO tab team on the decision's record opens that tab", async () => {
    const published = turn({
      id: "tab-go-elsewhere",
      said: "Who's on the Clinicrest team?",
      decision: clinicrest("MOVE"),
      mode: "GO",
      tab: "team",
      at: "/work",
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: CLINICREST,
        tab: "team",
      },
    ]);
  });

  it("a tab the page lacks (deal on a company profile) invents no move", async () => {
    const published = turn({
      id: "tab-lacking",
      said: "Where are we on the deal?",
      decision: clinicrest("STAY"),
      mode: "CONTEXT",
      tab: "deal",
    });
    await wait(80);
    expect(published).toEqual([]);
  });

  it("pinned: an offer of the same record that carries the tab; the page stays", async () => {
    const published = turn({
      id: "tab-pinned",
      said: "Can I see their data room?",
      decision: clinicrest("STAY"),
      mode: "GO",
      tab: "dataroom",
      pinned: true,
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([]);
    expect(blocksOf(published, "NAVIGATION_OFFER")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: CLINICREST,
        tab: "dataroom",
      },
    ]);
  });

  it.each(["NONE", "OFFER_ONLY"] as const)(
    "a %s reading with a tab never moves the pane",
    async (mode) => {
      const published = turn({
        id: `tab-${mode}`,
        said: "Does their data room have the audited accounts?",
        decision: clinicrest("MOVE"),
        mode,
        tab: "dataroom",
      });
      await wait(80);
      expect(blocksOf(published, "UI_INTENT")).toEqual([]);
    },
  );
});

describe("a pitch to watch lands on the Elevator pitch tab (live 550ecdd5c)", () => {
  it("the decision's COMPANY tab deck carries the tab the answer told it: elevator", async () => {
    const published = turn({
      id: "tab-pitch-watch",
      said: "Could I watch how Clinicrest presents itself? Play me their pitch.",
      decision: {
        ...clinicrest("MOVE"),
        place: {
          route: "/company/[companyId]",
          record: { kind: "COMPANY", name: "Clinicrest" },
          tab: "deck",
          document: null,
          slide: null,
          sectionId: null,
          position: null,
        },
      },
      mode: "GO",
      // answer.ts tells the decision tab elevator for companyMedia.pitch.
      tab: "elevator",
      at: `/company/${CLINICREST}?tab=dataroom`,
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: CLINICREST,
        tab: "elevator",
      },
    ]);
  });
});

describe("readingTabPlace", () => {
  const pane = {
    at: { page: "COMPANY", recordId: CLINICREST } as const,
    previous: null,
    pane: "OPEN" as const,
    dirty: false,
    busy: null,
  };
  const base = {
    pane,
    canOpen: () => true,
    config: { movesAllowed: true },
    records: RECORDS,
  };
  const stay: QNavigationOutcome = {
    decision: "STAY",
    target: null,
    openPane: false,
    remembered: null,
    guard: null,
  };
  const nav = (tab: string | null, mode = "CONTEXT") =>
    ({ mode, negated: false, destination: null, tab }) as never;

  it("unsaved work in the pane: an offer of the tab, never a move", () => {
    const outcome = readingTabPlace({
      ...base,
      pane: { ...pane, dirty: true },
      proposed: stay,
      navigation: nav("team"),
    });
    expect(outcome?.decision).toBe("OFFER");
    expect(outcome?.guard).toBe("UNSAVED_WORK");
    expect(outcome?.target).toEqual({
      page: "COMPANY",
      recordId: CLINICREST,
      tab: "team",
    });
  });

  it("already on that tab, or the Overview of a bare profile: unchanged", () => {
    expect(
      readingTabPlace({ ...base, proposed: stay, navigation: nav("overview") }),
    ).toBeNull();
    expect(
      readingTabPlace({
        ...base,
        pane: { ...pane, at: { ...pane.at, tab: "team" } },
        proposed: stay,
        navigation: nav("team"),
      }),
    ).toBeNull();
  });

  it("a relationship's messages are its thread page; its calls the relationship's tab", () => {
    const rel = {
      ...base,
      pane: {
        ...pane,
        at: {
          page: "RELATIONSHIP_COMPANY_MESSAGES",
          recordId: CLINICREST,
        } as const,
      },
    };
    expect(
      readingTabPlace({ ...rel, proposed: stay, navigation: nav("calls") })
        ?.target,
    ).toEqual({
      page: "RELATIONSHIP_COMPANY",
      recordId: CLINICREST,
      tab: "calls",
    });
    expect(
      readingTabPlace({ ...rel, proposed: stay, navigation: nav("messages") }),
    ).toBeNull();
  });

  it("no tab, a NONE reading, or a guarded stay: unchanged", () => {
    expect(
      readingTabPlace({ ...base, proposed: stay, navigation: nav(null) }),
    ).toBeNull();
    expect(
      readingTabPlace({
        ...base,
        proposed: stay,
        navigation: nav("team", "NONE"),
      }),
    ).toBeNull();
    expect(
      readingTabPlace({
        ...base,
        proposed: { ...stay, guard: "NO_ACCESS" },
        navigation: nav("team"),
      }),
    ).toBeNull();
  });
});
