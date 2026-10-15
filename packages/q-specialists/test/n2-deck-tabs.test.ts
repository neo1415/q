import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type DeckSection,
  type QRecordPage,
  type QResultBlock,
  type QScreenContext,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import type { QOpenRecordPort } from "../src/references.js";
import { tabAskOf } from "../src/tab-request.js";
import type { DeckSpeech } from "../src/deck-speech.js";

/**
 * follow-55 (Zino live 2026-10-04): what a turn points back at -- one
 * record to open, or Q's last action again -- is bound by code to a record
 * of theirs or to that action. The phrasings are the founder's own, from
 * the logs. Deterministic doubles; code asserts.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const NIXO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(screen?: QScreenContext): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER, organisationId: actor.organisationId },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      ...(screen === undefined ? {} : { screen }),
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date().toISOString(),
      revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
      revalidateOnResume: true,
    }),
  };
}

/**
 * N2 (founder 2026-10-10): "open <company>'s pitch deck" from anywhere
 * opens the deck in its viewer and Q speaks what it says; a deck the
 * person may not see is a plain refusal; a page's tabs and sub-tabs open by
 * their names, read by code. Fakes only: no model, no provider.
 */

const BASE = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
} as unknown as QTurnReading;

function section(
  code: DeckSection["section"],
  status: DeckSection["status"],
  summary: string | null,
): DeckSection {
  return {
    section: code,
    status,
    summary,
    pages: [],
    facts: [],
    confidence: "MEDIUM",
  };
}

const READ: DeckSpeech = {
  viewer: "INVESTOR",
  confirmedByFounder: true,
  sections: [
    section("PROBLEM", "PRESENT", "Clinics lose a third of visits to no-shows"),
    section("TRACTION", "PRESENT", "Forty clinics are live across Lagos"),
    section("MARKET", "NOT_IN_DECK", null),
    section("THE_ASK", "UNCLEAR", null),
  ],
};

function chat(options: {
  readonly canOpenDeck: boolean;
  readonly deckRead: DeckSpeech | null;
  readonly reading?: QTurnReading;
}) {
  const conversationId = randomUUID();
  const lines: QConversationMessage[] = [];
  const opened: { page: QRecordPage; id?: string; name?: string }[] = [];
  const deckReads: string[] = [];
  let delegated = 0;
  const turns: QTurnReader = {
    read: () => Promise.resolve(options.reading ?? BASE),
  };
  const openRecord: QOpenRecordPort = {
    open: (_request, target) => {
      opened.push({
        page: target.page,
        ...(target.id === undefined ? {} : { id: target.id }),
        ...(target.name === undefined ? {} : { name: target.name }),
      });
      const company =
        target.page.startsWith("COMPANY") ||
        target.page.startsWith("RELATIONSHIP_COMPANY");
      const known =
        target.id === NIXO || target.name?.toLowerCase().includes("nixo");
      return Promise.resolve(
        company &&
          known &&
          (options.canOpenDeck || target.page !== "COMPANY_DECK")
          ? { kind: "OPEN_RECORD_PAGE" as const, page: target.page, id: NIXO }
          : null,
      );
    },
    deck: (_request, companyId) => {
      deckReads.push(companyId);
      return Promise.resolve(options.deckRead);
    },
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      answer: () => {
        delegated += 1;
        lines.push({
          ...(lines[0] as QConversationMessage),
          id: randomUUID() as QConversationMessage["id"],
          role: "Q",
          content: "An answer.",
        });
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "p",
          promptBundleVersion: "b",
        });
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([...lines]),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          const row = {
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          } as unknown as QConversationMessage;
          lines.push(row);
          return Promise.resolve(row);
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    offeredTools: () => Promise.resolve(["open_page"]),
    openRecord,
    counterpartNames: () => Promise.resolve(["Nixo", "Ledgerline"]),
  });
  const say = async (said: string, screen?: QScreenContext) => {
    lines.push({
      tenantId: TENANT,
      conversationId,
      runId: randomUUID(),
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      role: "USER",
      content: said,
    } as unknown as QConversationMessage);
    await answer.answer(request(screen));
    const last = lines.at(-1);
    return {
      content: last?.content ?? "",
      blocks: last?.blocks ?? [],
    };
  };
  return { say, opened, deckReads, delegated: () => delegated };
}

const intents = (blocks: readonly QResultBlock[]) =>
  blocks.flatMap((block) => (block.kind === "UI_INTENT" ? [block.intent] : []));

describe("tabs and the deck, read by code", () => {
  const cases: readonly [string, Record<string, unknown>][] = [
    ["open their team tab", { tab: "team", name: null }],
    ["go to diligence", { tab: "diligence", name: null }],
    ["go to the calls tab", { tab: "calls", name: null }],
    ["show the deck", { tab: "deck", name: null, viewer: true }],
    ["Open Nixo's pitch deck", { tab: "deck", name: "Nixo", viewer: true }],
    [
      "show me the pitch deck for Nixo",
      { tab: "deck", name: "Nixo", viewer: true },
    ],
    [
      "can you pull up the data room tab of Nixo please",
      { tab: "dataroom", name: "Nixo" },
    ],
    [
      "open the traction section of the deck",
      { tab: "deck", subTab: "TRACTION", name: null, viewer: false },
    ],
    [
      "Show me the ask in Nixo's pitch deck",
      { tab: "deck", subTab: "THE_ASK", name: "Nixo", viewer: false },
    ],
    ["take me to the messages tab", { tab: "messages", name: null }],
  ];
  for (const [said, expected] of cases) {
    it(`reads "${said}"`, () => {
      expect(tabAskOf(said)).toMatchObject(expected);
    });
  }

  it("does not read making, asking or someone else's work as opening", () => {
    for (const said of [
      "draft a deck",
      "make me a pitch deck for my seed round",
      "create a pitch deck for Nixo",
      "show me a deck template",
      "open my deck",
      "what is in the deck?",
      "improve the team slide in the deck",
    ]) {
      expect(tabAskOf(said), said).toBeNull();
    }
  });
});

describe("the pitch deck from anywhere", () => {
  it("opens an authorised deck in its viewer and speaks what it says", async () => {
    const c = chat({ canOpenDeck: true, deckRead: READ });
    const said = await c.say("Open Nixo's pitch deck.");
    const [intent] = intents(said.blocks);
    expect(intent).toMatchObject({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY_DECK",
      id: NIXO,
      tab: "deck",
      viewer: "OPEN",
    });
    expect(said.content).toContain("Clinics lose a third of visits");
    expect(said.content).toContain("Forty clinics are live across Lagos");
    expect(said.content).toContain("Not in the deck yet: market.");
    expect(said.content).toContain("Unclear: the ask.");
    expect(said.content).toContain("company's own claims");
    expect(c.deckReads).toEqual([NIXO]);
    expect(c.delegated()).toBe(0);
  });

  it("refuses a deck they may not see: no intent, no content", async () => {
    const c = chat({ canOpenDeck: true, deckRead: null });
    const said = await c.say("Open Nixo's pitch deck.");
    expect(intents(said.blocks)).toEqual([]);
    expect(said.content).toBe(
      "There is no pitch deck of Nixo's that I can open for you.",
    );
    expect(said.content).not.toContain("Clinics");
  });

  it("opens the deck the reader filed as a DOCUMENT (live 2026-10-10)", async () => {
    const c = chat({
      canOpenDeck: true,
      deckRead: READ,
      reading: {
        ...BASE,
        reference: {
          open: "DOCUMENT",
          name: "Nixo",
          shown: null,
          retryLast: false,
          sameFor: null,
        },
      } as unknown as QTurnReading,
    });
    const said = await c.say("Yeah, I want the pitch deck for Nixo opened.");
    expect(intents(said.blocks)[0]).toMatchObject({
      page: "COMPANY_DECK",
      viewer: "OPEN",
    });
    expect(said.content).toContain("Forty clinics are live");
    expect(c.opened.map((o) => o.page)).toContain("DOCUMENT");
  });

  it("speaks one section only when one was asked for", async () => {
    const c = chat({ canOpenDeck: true, deckRead: READ });
    const said = await c.say("Show me the traction section of Nixo's deck.");
    expect(intents(said.blocks)[0]).toMatchObject({
      tab: "deck",
      subTab: "TRACTION",
    });
    expect(said.content).toContain("Forty clinics");
    expect(said.content).not.toContain("Clinics lose");
  });
});

describe("a page's tabs from the screen", () => {
  it("'open their team tab' with a company on screen carries the tab", async () => {
    const c = chat({ canOpenDeck: true, deckRead: READ });
    const said = await c.say("Open their team tab.", {
      route: "COMPANY",
      companyId: NIXO,
    });
    expect(c.opened).toEqual([{ page: "COMPANY_TEAM", id: NIXO }]);
    expect(intents(said.blocks)[0]).toMatchObject({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY_TEAM",
      id: NIXO,
      tab: "team",
    });
    expect(c.delegated()).toBe(0);
  });

  it("'go to the calls tab' on a relationship page opens that tab", async () => {
    const c = chat({ canOpenDeck: true, deckRead: READ });
    const said = await c.say("Go to the calls tab.", {
      route: "RELATIONSHIP_COMPANY",
      companyId: NIXO,
    });
    expect(intents(said.blocks)[0]).toMatchObject({
      page: "RELATIONSHIP_COMPANY",
      tab: "calls",
    });
  });

  it("'show the deck' on the company page opens and speaks it", async () => {
    const c = chat({ canOpenDeck: true, deckRead: READ });
    const said = await c.say("Show the deck.", {
      route: "COMPANY",
      companyId: NIXO,
    });
    expect(intents(said.blocks)[0]).toMatchObject({
      page: "COMPANY_DECK",
      tab: "deck",
      viewer: "OPEN",
    });
    expect(said.content).toContain("Clinics lose a third");
  });

  it("with nothing relevant on screen it leaves the words to the other readers", async () => {
    const c = chat({ canOpenDeck: true, deckRead: READ });
    await c.say("Open their team tab.", { route: "OTHER" });
    expect(c.opened).toEqual([]);
  });
});
