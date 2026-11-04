// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Q_BLOCK_SURFACES,
  Q_RESULT_BLOCK_KINDS,
  QResultBlockSchema,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";

import {
  answerCardRef,
  hideAllCards,
  hideKey,
  isCardHidden,
  noteSeen,
  resetCards,
  setCardsConversation,
} from "../src/features/q/cards/card-visibility";
import type { QTurn, QTurnObjectBlock } from "../src/features/q/conversation";
import {
  offerAnsweredLater,
  openOffers,
} from "../src/features/q/navigation-offers";
import { jobIdsIn } from "../src/features/q/pinned-work";
import { shownItems, stageOf } from "../src/features/q/shown";
import { withoutJobs } from "../src/features/q/work-progress-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { replyParts } = await import("../src/features/q/q-answer");
const { StaticAnswerCards } =
  await import("../src/features/q/static-answer-cards");
const { AnswerCanvas } = await import("../src/features/q/answer-canvas");
const { CardsControls } =
  await import("../src/features/q/cards/cards-controls");

/**
 * N3 (owner 2026-11-04): Q Chat, the Q page's presence view (stage and
 * captions), the dock and the voice room are one conversation. Every kind
 * of block an answer can carry is visible in Chat, and on the Q view it is
 * drawn exactly once -- by the stage, beside it, in the caption, or on the
 * one approval control -- never twice and never not at all.
 */

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID_2 = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";

/** One fixture per object kind; the Record type makes it exhaustive. */
const OBJECT_FIXTURES: Readonly<Record<QTurnObjectBlock["kind"], unknown>> = {
  COMPANY_REFERENCE: { kind: "COMPANY_REFERENCE", companyId: UUID },
  INVESTOR_REFERENCE: {
    kind: "INVESTOR_REFERENCE",
    investorOrganisationId: UUID_2,
  },
  COMPARISON: {
    kind: "COMPARISON",
    subjects: [
      { kind: "COMPANY", companyId: UUID },
      { kind: "COMPANY", companyId: UUID_2 },
    ],
    rows: [{ label: "Stage", values: ["Seed", "Series A"] }],
  },
  COMPARISON_CARDS: {
    kind: "COMPARISON_CARDS",
    title: null,
    items: [
      { name: "Ledgerfold", subtitle: "Seed", points: ["USD 40k MRR"] },
      { name: "Kivu Freight", subtitle: null, points: ["Not known"] },
    ],
  },
  ANSWER_CARDS: {
    kind: "ANSWER_CARDS",
    shape: "RANKED",
    title: "Top three for your mandate",
    cards: [
      {
        key: "ledgerfold",
        name: "Ledgerfold",
        line: "Treasury software",
        hue: 1,
        fit: null,
        reasons: ["Seed round in range"],
        measures: [],
        view: null,
        said: null,
        sourceCount: 2,
        subject: null,
      },
    ],
    followUps: [],
  },
  CLARIFICATION_REQUEST: {
    kind: "CLARIFICATION_REQUEST",
    question: "Which Apex do you mean?",
    options: ["Apex Robotics", "Apex Health"],
  },
  ACTION_PROPOSAL: {
    kind: "ACTION_PROPOSAL",
    proposal: {
      contractVersion: 1,
      proposalId: UUID,
      runId: UUID_2,
      actionType: "message.send",
      actionClass: "CONFIRM_REQUIRED",
      targets: [
        { kind: "INVESTOR_ORGANISATION", investorOrganisationId: UUID_2 },
      ],
      summary: "Send an introduction to Northgate Capital.",
      approval: { required: true },
      status: "PROPOSED",
      createdAt: "2026-09-05T10:00:00Z",
    },
  },
  ARTIFACT_REFERENCE: {
    kind: "ARTIFACT_REFERENCE",
    artifactId: UUID_2,
    type: "INVESTMENT_BRIEF",
    status: "READY",
    title: "Investment brief",
  },
  UI_INTENT: {
    kind: "UI_INTENT",
    intent: { kind: "OPEN_COMPANY", companyId: UUID },
  },
  TABLE: {
    kind: "TABLE",
    title: "Side by side",
    columns: [
      { label: "Apex Capital", subject: null },
      { label: "Northwind", subject: null },
    ],
    rows: [{ label: "Based in", cells: ["GB", ""] }],
  },
  CHART: {
    kind: "CHART",
    chart: "BAR",
    title: "Monthly revenue",
    unit: "a month",
    currency: "USD",
    series: [
      {
        label: "Revenue",
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
        source: "From the bank statements they uploaded.",
        points: [
          { label: "Aug", value: 1200 },
          { label: "Sep", value: 1800 },
        ],
      },
    ],
  },
  MAP: {
    kind: "MAP",
    title: "Where they're based",
    basis: "Head-office country, as each investor publishes it.",
    places: [
      { label: "Apex Capital", countryCode: "GB", subject: null, note: null },
    ],
  },
  TIMELINE: {
    kind: "TIMELINE",
    title: "Your relationship",
    events: [
      {
        at: "2026-09-12",
        label: "Interest expressed",
        note: null,
        subject: null,
      },
    ],
  },
  ATTENTION: {
    kind: "ATTENTION",
    report: {
      items: [
        {
          key: "approval:1",
          source: "APPROVAL",
          title: "One change waits for your yes",
          note: "Send the follow-up to Apex Capital",
          since: "2026-10-08T09:00:00.000Z",
          decidable: true,
        },
      ],
      activity: null,
      unread: [],
      readAt: "2026-10-08T09:05:00.000Z",
    },
  },
  SUMMARY: {
    kind: "SUMMARY",
    title: "Apex Capital in brief",
    points: [
      {
        text: "Leads seed rounds in fintech.",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
      {
        text: "Likely to want two years of runway.",
        truthClass: "Q_INFERENCE",
        evidenceStatus: "NO_EVIDENCE",
      },
    ],
    missing: [],
  },
  PICTURE: {
    kind: "PICTURE",
    url: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg",
    alt: "A busy market street in Lagos",
    credit: { name: "Ada Obi", url: "https://www.pexels.com/@ada-obi" },
    source: "PEXELS",
    pageUrl: "https://www.pexels.com/photo/market-street-1/",
  },
  WORK_IN_PROGRESS: {
    kind: "WORK_IN_PROGRESS",
    jobId: UUID,
    title: "Deck for Nixo",
  },
  SCHEDULE: {
    kind: "SCHEDULE",
    title: "Your day",
    span: "TODAY",
    timeZone: null,
    calls: [],
    reminders: [],
    approvals: [],
  },
  PLAN: {
    kind: "PLAN",
    planId: UUID,
    version: 2,
    title: "Close the seed round by March",
    steps: 6,
    reviewed: false,
    affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
  },
  NAVIGATION_OFFER: {
    kind: "NAVIGATION_OFFER",
    intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
    place: "Relationships",
    openLabel: "Open pipeline",
  },
};

function objectBlock(kind: QTurnObjectBlock["kind"]): QTurnObjectBlock {
  const parsed = QResultBlockSchema.parse(OBJECT_FIXTURES[kind]);
  // Narrowed by its kind: every key of OBJECT_FIXTURES is an object kind.
  if (parsed.kind !== kind) throw new Error(`fixture for ${kind}`);
  return parsed;
}

function qTurn(
  id: string,
  blocks: readonly QTurnObjectBlock[],
  overrides: Partial<Extract<QTurn, { kind: "Q" }>> = {},
): Extract<QTurn, { kind: "Q" }> {
  return {
    kind: "Q",
    id,
    runId: `run-${id}`,
    text: "Here it is.",
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
    ...overrides,
  };
}

function person(id: string, text: string): QTurn {
  return { kind: "PERSON", id, text, unconfirmed: false };
}

const OBJECT_KINDS = Object.keys(OBJECT_FIXTURES) as QTurnObjectBlock["kind"][];

afterEach(() => {
  cleanup();
  resetCards();
});

describe("N3: one rule for every view", () => {
  it("covers the whole union: the object kinds, and prose for the rest", () => {
    const prose = Q_RESULT_BLOCK_KINDS.filter(
      (kind) => !(OBJECT_KINDS as readonly string[]).includes(kind),
    );
    // TEXT, EVIDENCE, FINDING, UNCERTAINTY and PUBLIC_SOURCE are projected
    // into the answer's words, findings and Sources chip on every surface.
    expect([...prose].sort()).toEqual(
      ["EVIDENCE", "FINDING", "PUBLIC_SOURCE", "TEXT", "UNCERTAINTY"].sort(),
    );
    for (const kind of prose) {
      expect(Q_BLOCK_SURFACES[kind].thread, kind).toBe("PROSE");
    }
  });

  it.each(OBJECT_KINDS)("%s is visible in Chat (and the dock)", (kind) => {
    const block = objectBlock(kind);
    const parts = replyParts([block], "thread");
    const drawn =
      parts.inline.includes(block) ||
      parts.companies.includes(block) ||
      parts.investors.includes(block) ||
      // Decided once, where it is decided: QNow, mounted in every view.
      Q_BLOCK_SURFACES[kind].thread === "APPROVAL";
    expect(drawn).toBe(true);
  });

  it.each(OBJECT_KINDS)(
    "%s is visible on the Q view exactly once (stage, beside it, or caption)",
    (kind) => {
      const block = objectBlock(kind);
      const answer = qTurn("a1", [block]);
      const turns: QTurn[] = [person("p1", "Show me"), answer];
      const pick = stageOf(shownItems(turns), turns);
      const onStage = pick.item?.blocks.includes(block) === true ? 1 : 0;
      const beside = openOffers(turns).some((offer) => offer.block === block)
        ? 1
        : 0;
      const parts = replyParts(answer.blocks, "caption");
      const inCaption =
        parts.inline.includes(block) ||
        parts.companies.includes(block) ||
        parts.investors.includes(block)
          ? 1
          : 0;
      const approval = Q_BLOCK_SURFACES[kind].thread === "APPROVAL" ? 1 : 0;
      expect(onStage + beside + inCaption + approval).toBe(1);
    },
  );

  it("draws plans, schedules, attention and work in progress on the stage (D8)", () => {
    for (const kind of [
      "PLAN",
      "SCHEDULE",
      "ATTENTION",
      "WORK_IN_PROGRESS",
    ] as const) {
      const turns: QTurn[] = [
        person("p1", "Show me"),
        qTurn("a1", [objectBlock(kind)]),
      ];
      expect(stageOf(shownItems(turns), turns).why, kind).toBe("SHOWN");
    }
  });

  it("keeps a table on the stage only, never again in the caption beneath it", () => {
    const table = objectBlock("TABLE");
    expect(replyParts([table], "caption").inline).toEqual([]);
    expect(replyParts([table], "thread").inline).toEqual([table]);
  });
});

describe("D7: one dismiss key and one store for every view", () => {
  const cards = objectBlock("ANSWER_CARDS") as QAnswerCardsBlock;
  const card = cards.cards[0];

  it("a card closed in Chat is closed under the key the stage hides by, and Show again brings it back", async () => {
    if (card === undefined) throw new Error("fixture");
    setCardsConversation("conversation-1");
    const user = userEvent.setup();
    render(<StaticAnswerCards block={cards} />);
    await user.click(
      await screen.findByRole("button", { name: `Close ${card.name}` }),
    );
    // Outside a session the answer's key is the set's title (AnswerCanvas).
    expect(isCardHidden(answerCardRef(cards.title, card))).toBe(true);
    expect(
      screen.queryByRole("button", { name: `Close ${card.name}` }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show again" }));
    expect(isCardHidden(answerCardRef(cards.title, card))).toBe(false);
    expect(
      await screen.findByRole("button", { name: `Close ${card.name}` }),
    ).toBeTruthy();
  });

  it("a card closed on the stage (by its key) is not drawn in Chat either", () => {
    if (card === undefined) throw new Error("fixture");
    hideKey(answerCardRef("a1", card).key);
    render(<AnswerCanvas answerKey="a1" block={cards} focus={-1} />);
    expect(
      screen.queryByRole("button", { name: `Close ${card.name}` }),
    ).toBeNull();
  });
});

describe("Show again only after the person closed cards here (owner 2026-11-04)", () => {
  const cards = objectBlock("ANSWER_CARDS") as QAnswerCardsBlock;
  const card = cards.cards[0];

  it("is not offered in a conversation where nothing was closed", () => {
    if (card === undefined) throw new Error("fixture");
    // A clear in another conversation, earlier in the tab.
    setCardsConversation("conversation-1");
    noteSeen([answerCardRef(cards.title, card).key]);
    hideAllCards();
    // A fresh conversation shows an older answer's cards (hidden by that clear).
    setCardsConversation("conversation-2");
    render(
      <>
        <StaticAnswerCards block={cards} />
        <CardsControls />
      </>,
    );
    expect(isCardHidden(answerCardRef(cards.title, card))).toBe(true);
    expect(screen.queryByRole("button", { name: "Show again" })).toBeNull();
  });

  it("is never offered before a conversation exists", () => {
    if (card === undefined) throw new Error("fixture");
    hideKey(answerCardRef(cards.title, card).key);
    render(<StaticAnswerCards block={cards} />);
    expect(screen.queryByRole("button", { name: "Show again" })).toBeNull();
  });

  it("is offered, quietly, once the person closed a card in this conversation", async () => {
    if (card === undefined) throw new Error("fixture");
    setCardsConversation("conversation-3");
    const user = userEvent.setup();
    render(<StaticAnswerCards block={cards} />);
    await user.click(
      await screen.findByRole("button", { name: `Close ${card.name}` }),
    );
    const again = screen.getByRole("button", { name: "Show again" });
    expect(again.className).toContain("bg-transparent");
  });
});

describe("N2 leftover: the dock draws a job once", () => {
  it("leaves out of the progress list a job the latest answer draws as its card", () => {
    const work = objectBlock("WORK_IN_PROGRESS");
    if (work.kind !== "WORK_IN_PROGRESS") throw new Error("fixture");
    const other = { ...work, jobId: UUID_2, title: "Brief for Apex" };
    const shownHere = jobIdsIn([qTurn("a2", [work])]);
    const key = [...shownHere].join(",");
    expect(withoutJobs([work, other], key)).toEqual([other]);
    expect(withoutJobs([work, other], "")).toEqual([work, other]);
  });
});

describe("N1 leftover: an offer answered by a later message goes", () => {
  const offer = objectBlock("NAVIGATION_OFFER");

  it("is open while it is Q's latest word, and settled once a later answer came", () => {
    const offered = qTurn("o1", [offer]);
    const before: QTurn[] = [person("p1", "Show me my pipeline"), offered];
    expect(offerAnsweredLater(before, "o1")).toBe(false);
    expect(openOffers(before)).toHaveLength(1);
    const after: QTurn[] = [
      ...before,
      person("p2", "yes please"),
      qTurn("o2", [], { text: "Opening your pipeline." }),
    ];
    expect(offerAnsweredLater(after, "o1")).toBe(true);
    expect(openOffers(after)).toHaveLength(0);
  });

  it("a second message of the same run does not settle it", () => {
    const offered = qTurn("o1", [offer], { runId: "run-x" });
    const sameRun = qTurn("o1b", [], { runId: "run-x" });
    const turns: QTurn[] = [person("p1", "Show me"), offered, sameRun];
    expect(offerAnsweredLater(turns, "o1")).toBe(false);
    expect(openOffers(turns)).toHaveLength(1);
  });

  it("is not drawn while a newer answer is still arriving", () => {
    const turns: QTurn[] = [
      person("p1", "Show me"),
      qTurn("o1", [offer]),
      person("p2", "stay here"),
      qTurn("o2", [], { streaming: true }),
    ];
    expect(openOffers(turns)).toEqual([]);
  });
});
