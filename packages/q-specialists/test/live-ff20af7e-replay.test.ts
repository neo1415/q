import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import {
  createContextFollowUp,
  createConversationEvidence,
  evidenceScopeOf,
  keepAnswerContext,
  type ConversationEvidence,
  type QTurnReader,
} from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import {
  asksNoActionOf,
  executionClassOfTurn,
  followsUpAnswer,
} from "../src/execution-reading.js";

/**
 * Replay of the live check of 17 Nov 2026, 23:41-23:43 UTC (fictional
 * investor Savanna / Amara, conversation ff20af7e), from the stored
 * messages and each run's stored routing. No live calls: the reader, the
 * fast path's one model call and the full answer are fakes.
 *
 * Run 0f483277 "What does Halyard Security do and how is it doing
 *   commercially?" (QUESTION_TO_Q, THEIR_OWN_RECORDS, tool null): answered
 *   only with an Express Interest card.
 * Run 1966ace4 "Why does that matter for an investor like me?" and run
 *   3f86a949 "And what is the biggest risk in that?" (QUESTION_TO_Q,
 *   ADVICE, research EXPLICIT): COMPLEX_ANALYSIS, never the fast path, and
 *   each paid for a public web search.
 *
 * answerKind is not in the stored routing; ANALYSIS is what the v78 rules
 * give "why does it matter" and "the biggest risk" (judgement, risks).
 */

const TENANT = "dd0c703a-9b0d-41be-b9c7-b9de60d46a81";
const USER = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const ORG = "db84dbc3-5dab-4496-b151-3b2e488e55bf";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
  actorType: "HUMAN",
});

function request(): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_replay",
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
      actor: { userId: USER, organisationId: ORG },
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

function message(
  conversationId: string,
  role: "USER" | "Q",
  content: string,
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
  } as QConversationMessage;
}

// The stored messages, in order.
const WELCOME =
  "Welcome back, Amara. Worth a look. 8 pitches that match your mandate. There are companies in your feed, ranked against your mandate. Where would you like to start?";
const TURN_1 =
  "What does Halyard Security do and how is it doing commercially?";
const TURN_1_Q = [
  "It would tell the founders you’d like to explore the company; it is not an investment commitment.",
  "Express interest in Halyard Security. Ready to send: approve on the card, or tell me what to change.",
];
const TURN_2 = "Why does that matter for an investor like me?";
const TURN_3 = "And what is the biggest risk in that?";
const TURN_2_Q =
  "It matters because Halyard Security appears to sit close to your declared seed mandate: it is a seed-stage B2B software company serving public-sector organisations, with recurring revenue and enterprise customers.";

/** What run 0f483277 read (claim-check sources of the full answer). */
const SOURCES = [
  "Halyard Security reports GBP 852,000 in annual recurring revenue, 11 NHS trusts, health boards and councils, and 71,000 licensed seats as of September 2026. (Demonstration data, self-reported.)",
  "Halyard Security's pitch deck states GBP 480,000 cash, approximately GBP 70,000 current monthly net burn and 6.9 months of runway as of September 30, 2026.",
];
const FAST_ANSWER =
  "It matters because Halyard Security reports 11 NHS trusts, health boards and councils as customers, so its traction is in a regulated public-sector market.";

type Reading = Record<string, unknown>;

/** Turn 1's reading, from run 0f483277's stored routing. */
const READ_1: Reading = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind: "THEIR_OWN_RECORDS", text: TURN_1 },
  aboutNamedOther: true,
  namedOther: { kind: "COMPANY", name: "Halyard Security" },
  addressedToQ: true,
  answerKind: "LOOKUP",
  tool: null,
};

/** Turns 2 and 3, from runs 1966ace4 and 3f86a949's stored routing. */
function followUpReading(said: string, named: boolean): Reading {
  return {
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: { kind: "ADVICE", text: said },
    aboutNamedOther: true,
    namedOther: named ? { kind: "COMPANY", name: "Halyard Security" } : null,
    addressedToQ: true,
    answerKind: "ANALYSIS",
    tool: null,
    // "that": bound by the reader to the company Q just spoke about (the
    // run logged one phrase, one entity).
    references: [{ phrase: "that", entityIds: ["E1"], confidence: "HIGH" }],
  };
}

function seam(input: {
  readonly conversationId: string;
  readonly prior: readonly QConversationMessage[];
  readonly said: string;
  readonly reading: Reading;
  readonly evidence?: ConversationEvidence;
  readonly contextReply?: unknown;
}) {
  const calls = { fullAnswer: 0, context: 0 };
  const delegated: QAnswerRequest[] = [];
  const stored: string[] = [];
  const latest = message(input.conversationId, "USER", input.said);
  const turns: QTurnReader = {
    read: () => Promise.resolve(input.reading as never),
  };
  const gateway = {
    execute: () => {
      calls.context += 1;
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: input.contextReply ?? { answerable: true, say: FAST_ANSWER },
        },
      });
    },
  } as unknown as ModelGateway;
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      warm: () => undefined,
      answer: (asked) => {
        calls.fullAnswer += 1;
        delegated.push(asked);
        stored.push("FULL PATH");
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
          Promise.resolve([...input.prior, latest]),
        mark: () => Promise.resolve(),
        insert: (
          _tx: unknown,
          row: Omit<QConversationMessage, "id" | "createdAt">,
        ) => {
          stored.push(row.content);
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
    conversationRecall: () => Promise.resolve(null),
    ...(input.evidence === undefined
      ? {}
      : {
          contextFollowUp: createContextFollowUp({
            gateway,
            evidence: input.evidence,
          }),
        }),
  });
  return { answer, calls, delegated, stored, latest };
}

function keptFor(conversationId: string): ConversationEvidence {
  const evidence = createConversationEvidence();
  keepAnswerContext(
    evidence,
    evidenceScopeOf({ actor, plan: request().plan, conversationId }),
    "0f483277-776b-45bd-a10f-7df4f3e28abb",
    SOURCES,
  );
  return evidence;
}

function conversationUpTo(turn: 1 | 2 | 3, conversationId: string) {
  const prior = [message(conversationId, "Q", WELCOME)];
  if (turn === 1) return prior;
  prior.push(message(conversationId, "USER", TURN_1));
  for (const line of TURN_1_Q) prior.push(message(conversationId, "Q", line));
  if (turn === 2) return prior;
  prior.push(message(conversationId, "USER", TURN_2));
  prior.push(message(conversationId, "Q", TURN_2_Q));
  return prior;
}

describe("defect 1 (run 0f483277): a question is answered, never met with an unasked card", () => {
  it("the reading asks for no action, so the answer's request holds approval cards back", async () => {
    const conversation = randomUUID();
    const s = seam({
      conversationId: conversation,
      prior: conversationUpTo(1, conversation),
      said: TURN_1,
      reading: READ_1,
    });
    const outcome = await s.answer.answer(request());
    expect(outcome.kind).toBe("ANSWERED");
    // The question still goes to the full answer; only cards are held.
    expect(s.calls.fullAnswer).toBe(1);
    expect(s.delegated[0]?.asksNoAction).toBe(true);
  });

  it("asking for the action, or taking up Q's offer, keeps it in reach", () => {
    expect(asksNoActionOf(READ_1 as never)).toBe(true);
    for (const asking of [
      { kind: "TOOL_REQUEST", askedAction: "propose_express_interest" },
      { askedAction: "propose_express_interest" },
      { appAction: { name: "express_interest" } },
      { acceptsOffer: true },
      { workFromEarlier: true },
      { replyTo: { kind: "WAITING_CARD" } },
      { handOver: { kind: "INTRODUCTION" } },
      { confidence: "LOW" },
    ]) {
      expect(
        asksNoActionOf({ ...READ_1, ...asking } as never),
        JSON.stringify(asking),
      ).toBe(false);
    }
    expect(asksNoActionOf(null)).toBe(false);
  });
});

describe("defects 2 and 3 (runs 1966ace4, 3f86a949): follow-ups on Q's own answer", () => {
  for (const [turn, said, named] of [
    [2, TURN_2, false],
    [3, TURN_3, true],
  ] as const) {
    it(`turn ${String(turn)}: still COMPLEX_ANALYSIS by class, but a follow-up on the last answer`, () => {
      const conversation = randomUUID();
      const prior = conversationUpTo(turn, conversation);
      const latest = message(conversation, "USER", said);
      const input = {
        read: followUpReading(said, named) as never,
        history: [...prior, latest],
        latestId: latest.id,
        carriesDocuments: false,
      };
      expect(executionClassOfTurn(input)).toBe("COMPLEX_ANALYSIS");
      expect(followsUpAnswer(input)).toBe(true);
    });

    it(`turn ${String(turn)}: answered on the fast path from run 0f483277's evidence, no full answer`, async () => {
      const conversation = randomUUID();
      const s = seam({
        conversationId: conversation,
        prior: conversationUpTo(turn, conversation),
        said,
        reading: followUpReading(said, named),
        evidence: keptFor(conversation),
      });
      await s.answer.answer(request());
      expect(s.calls).toEqual({ fullAnswer: 0, context: 1 });
      expect(s.stored).toEqual([FAST_ANSWER]);
    });

    it(`turn ${String(turn)}: on a fast-path miss the full path answers, with no outside research`, async () => {
      const conversation = randomUUID();
      const s = seam({
        conversationId: conversation,
        prior: conversationUpTo(turn, conversation),
        said,
        reading: followUpReading(said, named),
        evidence: keptFor(conversation),
        contextReply: { answerable: false, say: null },
      });
      await s.answer.answer(request());
      expect(s.calls).toEqual({ fullAnswer: 1, context: 1 });
      const asked = s.delegated[0];
      expect(asked?.executionClass).toBe("COMPLEX_ANALYSIS");
      // Live: EXPLICIT, so the early web search ran with their raw words.
      expect((await asked?.research)?.mode).toBe("NEVER");
    });
  }

  it("asking for the web on a follow-up still researches", async () => {
    const conversation = randomUUID();
    const s = seam({
      conversationId: conversation,
      prior: conversationUpTo(3, conversation),
      said: "And what does the press say about that risk?",
      reading: { ...followUpReading(TURN_3, true), asksForWeb: true },
    });
    await s.answer.answer(request());
    expect((await s.delegated[0]?.research)?.mode).not.toBe("NEVER");
  });

  it("a new company, or no pointing back, keeps the full path and its research", () => {
    const conversation = randomUUID();
    const prior = conversationUpTo(3, conversation);
    const latest = message(conversation, "USER", "What about Ledgerfold?");
    const base = {
      history: [...prior, latest],
      latestId: latest.id,
      carriesDocuments: false,
    };
    expect(
      followsUpAnswer({
        ...base,
        read: {
          ...followUpReading(TURN_3, false),
          namedOther: { kind: "COMPANY", name: "Ledgerfold" },
        } as never,
      }),
    ).toBe(false);
    expect(
      followsUpAnswer({
        ...base,
        read: { ...followUpReading(TURN_3, false), references: [] } as never,
      }),
    ).toBe(false);
    expect(
      followsUpAnswer({
        ...base,
        read: {
          ...followUpReading(TURN_3, false),
          answerKind: "DOCUMENT",
        } as never,
      }),
    ).toBe(false);
  });
});
