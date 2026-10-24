import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QResultBlock,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationFetch,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer, RESHOWN_LINE } from "../src/answer.js";
import {
  conversationContextOf,
  reshownBlocks,
  type QTurnReader,
} from "@capital-q/model-gateway/q";

/**
 * Owner live 2026-10-17 (conversation 971c5a53, investor account): Q named
 * Halyard Security, Clearwater Assurance and Tensorgate with their cards.
 * "Show me the cards again" then opened the saved companies (Ledgerfold,
 * Ajopot) while Q's words named the three; "what was the second highest
 * among the top three?" re-ran the fit ranking (23 fit.profile calls) and
 * answered with one card. Both are now answered from the conversation's
 * own record of what Q showed: the same cards, or a tool-free recall.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const HALYARD = "1ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const CLEARWATER = "6ed1da85-cddc-4015-b5c2-86a95a48cfc8";
const TENSORGATE = "bf55d6e1-567a-470b-954d-054ae05990e2";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(): QAnswerRequest {
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
      purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date().toISOString(),
      revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
      revalidateOnResume: true,
    }),
  };
}

const card = (name: string, companyId: string, score: number) => ({
  fit: { of: 7, score, measured: score === 10 ? 4 : 5 },
  hue: 1,
  key: name.toLowerCase().replace(/\s+/gu, ""),
  name,
  line: "seed · United Kingdom",
  about: `${name} in a line.`,
  raise: "£3 million (from their pitch)",
  reasons: ["In one of your sectors.", "Cheque compatibility not known yet."],
  said: `${name}: Capital Q mandate fit ${String(score)} out of 10; not a quality score.`,
  view: null,
  subject: { kind: "COMPANY", companyId },
  measures: [
    { label: "Stage", level: "STRONG", value: null },
    { label: "Cheque compatibility", level: "UNKNOWN", value: null },
  ],
  sourceCount: 0,
});

/** The live answer's own block, as stored on the message. */
const TOP_THREE = {
  kind: "ANSWER_CARDS",
  shape: "RANKED",
  title: "Fit against your mandate",
  followUps: [],
  cards: [
    card("Halyard Security", HALYARD, 10),
    card("Clearwater Assurance", CLEARWATER, 8.8),
    card("Tensorgate", TENSORGATE, 8.8),
  ],
} as unknown as QResultBlock;

function message(
  conversationId: string,
  role: "USER" | "Q",
  content: string,
  blocks?: readonly QResultBlock[],
): QConversationMessage {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    conversationId,
    runId: randomUUID(),
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    ...(blocks === undefined ? {} : { blocks }),
  } as QConversationMessage;
}

function liveHistory(conversationId: string): QConversationMessage[] {
  return [
    message(conversationId, "USER", "show me the top three on my mandate"),
    message(
      conversationId,
      "Q",
      "So, the top three: Halyard Security at 10; then Clearwater Assurance and Tensorgate, level at 8.8. I've put them on screen.",
      [TOP_THREE],
    ),
    message(conversationId, "USER", "show me Halyard"),
    message(conversationId, "Q", "Opening Halyard Security…", [
      {
        kind: "UI_INTENT",
        intent: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: HALYARD },
      } as unknown as QResultBlock,
    ]),
  ];
}

type Seam = {
  readonly answer: ReturnType<typeof createSpecialistQAnswer>;
  readonly delegated: QAnswerRequest[];
  readonly stored: { content: string; blocks?: readonly QResultBlock[] }[];
  readonly readerShown: string[];
  readonly recalled: { shown: string; turn: number }[];
};

function seam(input: {
  readonly said: string;
  readonly conversationId: string;
  readonly history: readonly QConversationMessage[];
  readonly fromShown: { turn: number; reshow: boolean } | null;
  readonly recall?: string | null;
  readonly fetched?: readonly QConversationFetch[];
}): Seam {
  const latest = message(input.conversationId, "USER", input.said);
  const delegated: QAnswerRequest[] = [];
  const stored: Seam["stored"] = [];
  const readerShown: string[] = [];
  const recalled: Seam["recalled"] = [];
  const turns: QTurnReader = {
    read: (reading) => {
      readerShown.push(reading.shown ?? "");
      return Promise.resolve({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "FIT", text: input.said },
        fromShown: input.fromShown,
      } as never);
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
      warm: () => undefined,
      answer: (req) => {
        // The full path: ranking, lookups and the tool-calling analyst.
        delegated.push(req);
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "none",
          promptBundleVersion: "b",
        });
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () =>
          Promise.resolve([...input.history, latest]),
        mark: () => Promise.resolve(),
        insert: (
          _tx: unknown,
          row: Omit<QConversationMessage, "id" | "createdAt">,
        ) => {
          stored.push({
            content: row.content,
            ...(row.blocks === undefined ? {} : { blocks: row.blocks }),
          });
          return Promise.resolve({
            ...row,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          });
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    ...(input.fetched === undefined
      ? {}
      : { conversationFetched: () => Promise.resolve(input.fetched ?? []) }),
    conversationRecall: (_req, recall) => {
      recalled.push({ shown: recall.shown, turn: recall.turn });
      return Promise.resolve(input.recall ?? null);
    },
  });
  return { answer, delegated, stored, readerShown, recalled };
}

describe("conversation context: what Q already said and showed", () => {
  it("keeps every turn's records with their ids, names, order and figures", () => {
    const context = conversationContextOf(liveHistory(randomUUID()));
    expect(context.turns.map((turn) => turn.turn)).toEqual([1, 2]);
    const first = context.text.split("\n")[0] ?? "";
    expect(first.startsWith("T1: said")).toBe(true);
    // Order is explicit, as the person counts.
    expect(first).toContain(
      `{"#":2,"fit":{"of":7,"score":8.8,"measured":5},"hue":1,"key":"clearwaterassurance","name":"Clearwater Assurance"`,
    );
    expect(first.indexOf("Halyard Security")).toBeLessThan(
      first.indexOf("Clearwater Assurance"),
    );
    expect(first).toContain(CLEARWATER);
    // Nulls and empties are dropped, not invented.
    expect(first).not.toContain("null");
    expect(context.text.split("\n")[1]).toContain("OPEN_RECORD_PAGE");
  });

  it("shows again only what displays; a page opened is not reopened", () => {
    const context = conversationContextOf(liveHistory(randomUUID()));
    const [answerTurn, openTurn] = context.turns;
    expect(answerTurn && reshownBlocks(answerTurn)).toEqual([TOP_THREE]);
    expect(openTurn && reshownBlocks(openTurn)).toEqual([]);
  });

  it("an empty conversation has an empty record", () => {
    expect(conversationContextOf([]).text).toBe("");
  });
});

describe("follow-ups answered from the conversation (owner live 2026-10-17)", () => {
  it("'show me the cards again': the same three cards, in order; not the saved list, no tools", async () => {
    const conversation = randomUUID();
    const s = seam({
      said: "Yes, please. Show m-show me the cards again",
      conversationId: conversation,
      history: liveHistory(conversation),
      fromShown: { turn: 1, reshow: true },
    });
    const outcome = await s.answer.answer(request());
    expect(outcome.kind).toBe("ANSWERED");
    // The reader read the turn against what Q had shown.
    expect(s.readerShown[0]).toContain("Clearwater Assurance");
    // No ranking, lookup or analyst: the full path was never taken.
    expect(s.delegated).toHaveLength(0);
    expect(s.stored).toHaveLength(1);
    expect(s.stored[0]?.content).toBe(RESHOWN_LINE);
    expect(s.stored[0]?.blocks).toEqual([TOP_THREE]);
    const shown = s.stored[0]?.blocks?.[0] as unknown as {
      cards: { subject: { companyId: string } }[];
    };
    expect(shown.cards.map((c) => c.subject.companyId)).toEqual([
      HALYARD,
      CLEARWATER,
      TENSORGATE,
    ]);
    // Never a show of their saved companies.
    expect(JSON.stringify(s.stored)).not.toContain("SAVED_COMPARISON");
  });

  // Replay 2026-10-24: "Can I see that" after a list of waiting approvals
  // (a turn of findings only) got "Here's what I showed you, back on
  // screen." and nothing appeared. Only what can be looked at is re-shown.
  it("never 're-shows' a turn that had nothing to look at; the turn is answered instead", async () => {
    const conversation = randomUUID();
    const s = seam({
      said: "Can I see that",
      conversationId: conversation,
      history: [
        message(conversation, "USER", "What do I have waiting for approval?"),
        message(
          conversation,
          "Q",
          "You have two items waiting for your approval.",
          [
            {
              kind: "FINDING",
              finding: { statement: "Two approvals are waiting." },
            } as unknown as QResultBlock,
          ],
        ),
      ],
      fromShown: { turn: 1, reshow: true },
    });
    await s.answer.answer(request());
    expect(s.stored.map((m) => m.content)).not.toContain(RESHOWN_LINE);
    expect(s.delegated).toHaveLength(1);
  });

  it("'so what was the second one?': answered from what Q said, zero tool calls, no ranking", async () => {
    const conversation = randomUUID();
    const s = seam({
      said: "No, you mentioned three, right? What was the second one",
      conversationId: conversation,
      history: liveHistory(conversation),
      fromShown: { turn: 1, reshow: false },
      recall: "The second was Clearwater Assurance, at 8.8 on your mandate.",
    });
    await s.answer.answer(request());
    expect(s.delegated).toHaveLength(0);
    expect(s.recalled).toHaveLength(1);
    expect(s.recalled[0]?.turn).toBe(1);
    expect(s.recalled[0]?.shown).toContain(`"#":2`);
    expect(s.recalled[0]?.shown).toContain("Clearwater Assurance");
    expect(s.stored.map((m) => m.content)).toEqual([
      "The second was Clearwater Assurance, at 8.8 on your mandate.",
    ]);
  });

  it("a recall the record cannot answer is looked up the normal way", async () => {
    const conversation = randomUUID();
    const s = seam({
      said: "what is Clearwater's burn rate?",
      conversationId: conversation,
      history: liveHistory(conversation),
      fromShown: { turn: 1, reshow: false },
      recall: null,
    });
    await s.answer.answer(request());
    expect(s.recalled).toHaveLength(1);
    expect(s.delegated).toHaveLength(1);
  });

  it("another conversation's record never reaches this one", async () => {
    // Conversation A showed the three; this run is on conversation B
    // (another person's, or their own new one), whose history holds none
    // of it. A reading that points at a T1 there finds nothing.
    const s = seam({
      said: "what was the second one?",
      conversationId: randomUUID(),
      history: [message(randomUUID(), "USER", "hello")],
      fromShown: { turn: 1, reshow: true },
      recall: "should never be said",
    });
    await s.answer.answer(request());
    expect(s.readerShown[0]).toBe("");
    expect(s.readerShown[0]).not.toContain("Clearwater");
    expect(s.recalled).toHaveLength(0);
    expect(s.stored.map((m) => m.content)).not.toContain(
      "should never be said",
    );
    expect(s.delegated).toHaveLength(1);
  });
});

describe("what earlier turns fetched (owner live 2026-10-17)", () => {
  it("is in the recall's record for that turn; the reader decides from what was shown; above the ceiling is left out", async () => {
    const conversation = randomUUID();
    const history = liveHistory(conversation);
    const answerRun = history[1]?.runId ?? "";
    const s = seam({
      said: "what did you say about Clearwater's team?",
      conversationId: conversation,
      history,
      fromShown: { turn: 1, reshow: false },
      recall: "Their team was not known yet.",
      fetched: [
        {
          runId: answerRun,
          toolName: "company.get",
          arguments: { companyId: CLEARWATER },
          result: { team: "two founders, ex-bank model risk" },
          sensitivity: "NETWORK_VISIBLE",
          fetchedAt: "2026-10-17T09:14:18.000Z",
        },
        {
          runId: answerRun,
          toolName: "private.read",
          arguments: {},
          result: { secret: "founder-private runway" },
          // Above this run's CONFIDENTIAL ceiling: never in its context.
          sensitivity: "RESTRICTED",
          fetchedAt: "2026-10-17T09:14:18.500Z",
        },
      ],
    });
    await s.answer.answer(request());
    expect(s.delegated).toHaveLength(0);
    expect(s.readerShown[0]).not.toContain("ex-bank model risk");
    const shown = s.recalled[0]?.shown ?? "";
    const first = shown.split("\n")[0] ?? "";
    expect(first.startsWith("T1:")).toBe(true);
    expect(first).toContain(`| fetched [{"#":1,"tool":"company.get"`);
    expect(first).toContain("ex-bank model risk");
    expect(shown).not.toContain("founder-private runway");
  });

  it("another conversation's fetch (a run not in this history) attaches to nothing", async () => {
    const conversation = randomUUID();
    const s = seam({
      // Not a bare "what was the second one?": that name is said by code
      // (turn-latency.test.ts) and never reaches the recall.
      said: "what did you say about the second one's team?",
      conversationId: conversation,
      history: liveHistory(conversation),
      fromShown: { turn: 1, reshow: false },
      recall: "From the record.",
      fetched: [
        {
          runId: randomUUID(),
          toolName: "company.get",
          arguments: {},
          result: { team: "someone else's read" },
          sensitivity: "PUBLIC",
          fetchedAt: "2026-10-17T09:00:00.000Z",
        },
      ],
    });
    await s.answer.answer(request());
    expect(s.recalled[0]?.shown).not.toContain("someone else's read");
  });
});
