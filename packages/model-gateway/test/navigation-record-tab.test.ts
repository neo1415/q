import { describe, expect, it } from "vitest";

import type { NavigationDecisionResult } from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import {
  createQPageMoves,
  pitchOnElevator,
  readingTabPlace,
  subjectPlace,
  type QNavigationOutcome,
  type QNavigationRecords,
  type QPageMoveSubject,
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
  /** One proposal per sample, in turn (a split vote); else `decision`. */
  readonly samples?: readonly NavigationDecisionResult[];
  readonly mode: "GO" | "CONTEXT" | "NONE" | "OFFER_ONLY";
  readonly tab: string | null;
  readonly at?: string;
  readonly pinned?: boolean;
  readonly pitch?: boolean;
  readonly subject?: QPageMoveSubject | null;
  readonly records?: QNavigationRecords;
}) {
  const published: { content: string; blocks: readonly unknown[] }[] = [];
  let sampled = 0;
  const moves = createQPageMoves({
    decider: {
      decide: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            const one =
              options.samples?.[sampled % options.samples.length] ??
              options.decision;
            sampled += 1;
            resolve(one);
          }, 20),
        ),
    },
    records: () => Promise.resolve(options.records ?? RECORDS),
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
      ...(options.pitch === undefined ? {} : { pitch: options.pitch }),
      ...(options.subject === undefined ? {} : { subject: options.subject }),
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

/**
 * Live replay on d96c63ee1 (13 Nov 2026, investor, Q Workspace). Readings,
 * decisions and the pane are the logged ones; the subject is what the
 * answer path tells the port (turnSubjectOf over the conversation).
 */
const company = (
  name: string,
  tab: string | null,
): NavigationDecisionResult => ({
  decision: "MOVE",
  place: {
    route: "/company/[companyId]",
    record: { kind: "COMPANY", name },
    tab,
    document: null,
    slide: null,
    sectionId: null,
    position: null,
  },
  back: false,
  askedForPage: false,
  reason: "",
});
const STAYS: NavigationDecisionResult = clinicrest("STAY");
const ledgerline = (named: boolean): QPageMoveSubject => ({
  kind: "COMPANY",
  name: "Ledgerline",
  id: LEDGERLINE,
  named,
});
const MESSAGES_AT = `/relationships/company/${CLINICREST}/messages`;

describe("live d96c63ee1: a pitch to watch, read tab null", () => {
  it("on Clinicrest's data room, 'Play me their pitch.' (GO, tab null, pitch) moves to elevator, never the decision's deck", async () => {
    const published = turn({
      id: "live-pitch-null-tab",
      said: "Could I watch how Clinicrest presents itself? Play me their pitch.",
      decision: company("Clinicrest", "deck"),
      mode: "GO",
      tab: null,
      pitch: true,
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

  it("a pitch deck asked for (pitch false) keeps the deck", async () => {
    const published = turn({
      id: "live-pitch-deck",
      said: "Show me Clinicrest's pitch deck.",
      decision: company("Clinicrest", "deck"),
      mode: "GO",
      tab: null,
      pitch: false,
      at: `/company/${CLINICREST}?tab=dataroom`,
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: CLINICREST,
        tab: "deck",
      },
    ]);
  });

  it("pitchOnElevator: already on the elevator tab is a STAY; a remembered deck becomes elevator", () => {
    const pane = {
      at: { page: "COMPANY", recordId: CLINICREST, tab: "elevator" } as const,
      previous: null,
      pane: "OPEN" as const,
      dirty: false,
      busy: null,
    };
    const deck = {
      page: "COMPANY",
      recordId: CLINICREST,
      tab: "deck",
    } as const;
    expect(
      pitchOnElevator(
        {
          decision: "MOVE",
          target: deck,
          openPane: false,
          remembered: null,
          guard: null,
        },
        true,
        pane,
      ),
    ).toMatchObject({ decision: "STAY", guard: "ALREADY_THERE" });
    expect(
      pitchOnElevator(
        {
          decision: "STAY",
          target: null,
          openPane: false,
          remembered: deck,
          guard: "COLLAPSED_PANE",
        },
        true,
        { ...pane, at: null },
      ).remembered,
    ).toEqual({ page: "COMPANY", recordId: CLINICREST, tab: "elevator" });
  });
});

describe("live d96c63ee1: the conversation's record, not the pane's", () => {
  it("pane on Clinicrest's messages, 'Tell me about Ledgerline.' (CONTEXT, overview; decision STAY) moves to Ledgerline", async () => {
    const published = turn({
      id: "live-ctx-ledgerline",
      said: "Tell me about Ledgerline.",
      decision: STAYS,
      mode: "CONTEXT",
      tab: "overview",
      subject: ledgerline(true),
      at: MESSAGES_AT,
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: LEDGERLINE },
    ]);
  });

  it("then 'And what's their team like?' (CONTEXT, team; SPLIT_VOTE stay) moves to Ledgerline's team tab", async () => {
    const published = turn({
      id: "live-ctx-team",
      said: "And what's their team like?",
      decision: STAYS,
      // Two places, one vote each, and a stay: the logged SPLIT_VOTE.
      samples: [
        company("Ledgerline", "team"),
        company("Clinicrest", "team"),
        STAYS,
      ],
      mode: "CONTEXT",
      tab: "team",
      subject: ledgerline(false),
      at: `/company/${LEDGERLINE}`,
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: LEDGERLINE,
        tab: "team",
      },
    ]);
  });

  it("the same turn with the pane still on Clinicrest's messages lands on Ledgerline, never Clinicrest's team", async () => {
    const published = turn({
      id: "live-ctx-team-from-messages",
      said: "And what's their team like?",
      decision: STAYS,
      mode: "CONTEXT",
      tab: "team",
      subject: ledgerline(false),
      at: MESSAGES_AT,
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: LEDGERLINE,
        tab: "team",
      },
    ]);
  });

  it("pinned: Ledgerline's team is offered; the page stays", async () => {
    const published = turn({
      id: "live-ctx-pinned",
      said: "And what's their team like?",
      decision: STAYS,
      mode: "CONTEXT",
      tab: "team",
      subject: ledgerline(false),
      at: MESSAGES_AT,
      pinned: true,
    });
    await wait(80);
    expect(blocksOf(published, "UI_INTENT")).toEqual([]);
    expect(blocksOf(published, "NAVIGATION_OFFER")).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: LEDGERLINE,
        tab: "team",
      },
    ]);
  });

  it("NONE: nothing moves or is offered", async () => {
    const published = turn({
      id: "live-ctx-none",
      said: "Is their team any good?",
      decision: STAYS,
      mode: "NONE",
      tab: "team",
      subject: ledgerline(false),
      at: MESSAGES_AT,
    });
    await wait(80);
    expect(published).toEqual([]);
  });

  it("two records in play (subject null): nothing, and never the pane's record in its stead", async () => {
    const published = turn({
      id: "live-ctx-two",
      said: "Can I see their team?",
      decision: STAYS,
      mode: "CONTEXT",
      tab: "team",
      subject: null,
      at: `/company/${CLINICREST}`,
    });
    await wait(80);
    expect(published).toEqual([]);
  });

  it("a record they may not open: nothing", async () => {
    const published = turn({
      id: "live-ctx-no-access",
      said: "Tell me about Ledgerline.",
      decision: STAYS,
      mode: "CONTEXT",
      tab: "overview",
      subject: ledgerline(true),
      at: MESSAGES_AT,
      records: {
        ...RECORDS,
        companies: [{ id: CLINICREST, name: "Clinicrest" }],
      },
    });
    await wait(80);
    expect(published).toEqual([]);
  });

  it("a guarded stay other than a split vote (unsaved work proposed nothing; NO_ACCESS) places nothing", () => {
    const outcome = readingTabPlace({
      proposed: {
        decision: "STAY",
        target: null,
        openPane: false,
        remembered: null,
        guard: "NO_ACCESS",
      },
      navigation: {
        mode: "CONTEXT",
        negated: false,
        destination: null,
        tab: "team",
      } as never,
      pane: {
        at: { page: "COMPANY", recordId: CLINICREST },
        previous: null,
        pane: "OPEN",
        dirty: false,
        busy: null,
      },
      canOpen: () => true,
      config: { movesAllowed: true },
      records: RECORDS,
      subject: {
        place: { page: "COMPANY", recordId: LEDGERLINE },
        named: false,
      },
    });
    expect(outcome).toBeNull();
  });

  it("unsaved work in the pane: Ledgerline's team is an offer", () => {
    const outcome = readingTabPlace({
      proposed: {
        decision: "STAY",
        target: null,
        openPane: false,
        remembered: null,
        guard: "SPLIT_VOTE",
      },
      navigation: {
        mode: "CONTEXT",
        negated: false,
        destination: null,
        tab: "team",
      } as never,
      pane: {
        at: { page: "COMPANY", recordId: CLINICREST },
        previous: null,
        pane: "OPEN",
        dirty: true,
        busy: null,
      },
      canOpen: () => true,
      config: { movesAllowed: true },
      records: RECORDS,
      subject: {
        place: { page: "COMPANY", recordId: LEDGERLINE },
        named: false,
      },
    });
    expect(outcome).toMatchObject({
      decision: "OFFER",
      guard: "UNSAVED_WORK",
      target: { page: "COMPANY", recordId: LEDGERLINE, tab: "team" },
    });
  });
});

describe("subjectPlace", () => {
  const resolver =
    (status: "FOUND" | "WHICH_ONE" | "NONE", exact = true) =>
    () =>
      Promise.resolve(
        status === "FOUND"
          ? {
              status,
              recordId: LEDGERLINE,
              documentId: null,
              exact,
            }
          : { status },
      );
  it("one record they may open, by name: its page", async () => {
    await expect(
      subjectPlace(ledgerline(true), resolver("FOUND"), RECORDS),
    ).resolves.toEqual({
      place: { page: "COMPANY", recordId: LEDGERLINE },
      named: true,
    });
  });
  it("two, none, a lookalike, or an id the name does not resolve to: null", async () => {
    for (const found of [
      resolver("WHICH_ONE"),
      resolver("NONE"),
      resolver("FOUND", false),
    ])
      await expect(
        subjectPlace(ledgerline(true), found, RECORDS),
      ).resolves.toBeNull();
    await expect(
      subjectPlace(
        { ...ledgerline(true), id: CLINICREST },
        resolver("FOUND"),
        RECORDS,
      ),
    ).resolves.toBeNull();
  });
  it("not told: undefined (the pane's record, as before)", async () => {
    await expect(
      subjectPlace(undefined, resolver("FOUND"), RECORDS),
    ).resolves.toBeUndefined();
  });
});
