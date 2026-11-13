import { describe, expect, it } from "vitest";

import type { QNavigateTarget } from "@capital-q/contracts";
import type { NavigationDecisionResult } from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import {
  completeScreen,
  createQPageMoves,
  namesARecord,
  pinnedLine,
  refinesPlace,
  type QNavigationOutcome,
  type QNavigationRecords,
} from "../src/q/index.js";

/**
 * Deep-link regression (live on b1bfae8e7): "Can I see Clinicrest's data
 * room?" landed on the bare company page because the fast CONTEXT
 * placement put the reading's coarser destination first. Only complete
 * screens of their own are placed early; record pages wait for the
 * decision's deep link; a later exact place on the same page or record
 * refines the move in place, never across records.
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

const nav = (destination: string | null, mode = "CONTEXT") =>
  ({ mode, negated: false, destination }) as never;

const request = (runId: string, pinned = false) =>
  ({
    runId,
    tenantId: "t",
    actorUserId: "u",
    correlationId: "c",
    askerSide: "INVESTOR",
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

const verdict = (
  over: Partial<NonNullable<NavigationDecisionResult["place"]>>,
  decision: "MOVE" | "STAY" = "MOVE",
): NavigationDecisionResult => ({
  decision,
  place:
    decision === "STAY"
      ? null
      : {
          route: "/company/[companyId]",
          record: null,
          tab: null,
          document: null,
          slide: null,
          sectionId: null,
          position: null,
          ...over,
        },
  back: false,
  askedForPage: false,
  reason: "",
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function run(options: {
  readonly id: string;
  readonly said: string;
  readonly decision: NavigationDecisionResult;
  readonly delayMs: number;
  readonly destination: string | null;
  readonly pinned?: boolean;
}) {
  const published: {
    content: string;
    blocks: readonly unknown[];
    at: number;
  }[] = [];
  const moves = createQPageMoves({
    decider: {
      decide: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(options.decision), options.delayMs),
        ),
    },
    records: () => Promise.resolve(RECORDS),
    config: { movesAllowed: true },
  });
  const r = request(options.id, options.pinned);
  const t0 = Date.now();
  moves.start(r, {
    utterance: options.said,
    recentTurns: [],
    pageText: null,
    readingFollows: true,
    publish: (move) => {
      published.push({ ...move, at: Date.now() - t0 });
      return Promise.resolve({ messageId: `m${String(published.length)}` });
    },
  });
  moves.heard?.(r, Promise.resolve({ navigation: nav(options.destination) }));
  return published;
}

const intentsOf = (
  published: readonly { readonly blocks: readonly unknown[] }[],
) =>
  published.flatMap((one) =>
    one.blocks.flatMap((block) => {
      const b = block as { kind: string; intent?: unknown };
      return b.kind === "UI_INTENT" ? [b.intent] : [];
    }),
  );

describe("record asks under CONTEXT land on the decision's tab, never the bare record", () => {
  it.each([
    ["Can I see Clinicrest's data room?", "OWN_DATA_ROOM", "dataroom"],
    ["What's in Clinicrest's deck?", "OWN_DECK", "deck"],
    ["Who is on Clinicrest's team?", "PROFILE", "team"],
    ["Show me Clinicrest's data room", "DISCOVER", "dataroom"],
  ])("%j (reading %s) opens the %s tab", async (said, destination, tab) => {
    const published = run({
      id: `deep-${tab}-${destination}`,
      said,
      destination,
      delayMs: 60,
      decision: verdict({
        record: { kind: "COMPANY", name: "Clinicrest" },
        tab,
      }),
    });
    await wait(150);
    expect(intentsOf(published)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: CLINICREST, tab },
    ]);
  });

  it("messages: the relationship's messages page for that record", async () => {
    const published = run({
      id: "deep-messages",
      said: "Any new messages from Clinicrest?",
      destination: "RELATIONSHIPS",
      delayMs: 60,
      decision: verdict({
        route: "/relationships/company/[companyId]",
        record: { kind: "COMPANY", name: "Clinicrest" },
        tab: "messages",
      }),
    });
    await wait(150);
    expect(intentsOf(published)).toEqual([
      expect.objectContaining({
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_COMPANY_MESSAGES",
        id: CLINICREST,
      }),
    ]);
  });
});

describe("complete screens are still placed with the reading", () => {
  it("the pipeline is published before a slow decider", async () => {
    const published = run({
      id: "fast-pipeline",
      said: "Who should I follow up with this week?",
      destination: "CRM_PIPELINE",
      delayMs: 400,
      decision: verdict({}, "STAY"),
    });
    await wait(50);
    expect(published).toHaveLength(1);
    expect(published[0]?.at).toBeLessThan(100);
    expect(intentsOf(published)).toEqual([
      { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
    ]);
  });

  it("a later exact place on the same page refines the move in place", async () => {
    const published = run({
      id: "refine-pipeline",
      said: "Who should I follow up with this week?",
      destination: "CRM_PIPELINE",
      delayMs: 60,
      decision: verdict({
        route: "/relationships",
        tab: "pipeline",
        sectionId: "relationships",
      }),
    });
    await wait(150);
    const intents = intentsOf(published) as {
      kind: string;
      destination?: string;
      target?: unknown;
    }[];
    // The early move, then the same page refined; never another page.
    expect(intents).toHaveLength(2);
    expect(intents.every((one) => one.destination === "CRM_PIPELINE")).toBe(
      true,
    );
    expect(intents[1]?.target).toBeDefined();
  });

  it("pinned: the early placement is an offer; nothing moves", async () => {
    const published = run({
      id: "fast-pinned",
      said: "Who should I follow up with this week?",
      destination: "CRM_PIPELINE",
      delayMs: 60,
      decision: verdict({ record: { kind: "COMPANY", name: "Clinicrest" } }),
      pinned: true,
    });
    await wait(150);
    expect(intentsOf(published)).toEqual([]);
    expect(published[0]?.content).toBe(pinnedLine("Pipeline"));
  });
});

describe("refinesPlace never crosses pages or records", () => {
  const move = (target: QNavigateTarget): QNavigationOutcome => ({
    decision: "MOVE",
    target,
    openPane: false,
    remembered: null,
    guard: null,
  });
  const bare = move({ page: "COMPANY", recordId: CLINICREST });
  it("adds a tab on the same record", () => {
    expect(
      refinesPlace(
        bare,
        move({ page: "COMPANY", recordId: CLINICREST, tab: "dataroom" }),
      ),
    ).toBe(true);
    expect(
      refinesPlace(
        move({ page: "CRM_PIPELINE" }),
        move({ page: "CRM_PIPELINE", sectionId: "stalled" }),
      ),
    ).toBe(true);
  });
  it("never another record, another page, a changed tab, an offer or nothing new", () => {
    expect(
      refinesPlace(
        bare,
        move({ page: "COMPANY", recordId: LEDGERLINE, tab: "dataroom" }),
      ),
    ).toBe(false);
    expect(
      refinesPlace(move({ page: "CRM_PIPELINE" }), move({ page: "DAILY" })),
    ).toBe(false);
    expect(
      refinesPlace(
        move({ page: "COMPANY", recordId: CLINICREST, tab: "deck" }),
        move({ page: "COMPANY", recordId: CLINICREST, tab: "dataroom" }),
      ),
    ).toBe(false);
    expect(
      refinesPlace(bare, {
        ...move({ page: "COMPANY", recordId: CLINICREST, tab: "dataroom" }),
        decision: "OFFER",
      }),
    ).toBe(false);
    expect(refinesPlace(bare, bare)).toBe(false);
  });
});

describe("what may be placed early", () => {
  it("own complete screens yes; screens that stand for a record no", () => {
    for (const screen of ["CRM_PIPELINE", "GATEQ_INBOX", "DAILY"])
      expect(completeScreen(screen)).toBe(true);
    for (const screen of ["PROFILE", "PITCH", "OWN_DATA_ROOM", "OWN_DECK"])
      expect(completeScreen(screen)).toBe(false);
  });
  it("words naming one of their records wait for the decision", () => {
    expect(namesARecord("Can I see Clinicrest's data room?", RECORDS)).toBe(
      true,
    );
    expect(namesARecord("Who should I follow up with?", RECORDS)).toBe(false);
  });
});
