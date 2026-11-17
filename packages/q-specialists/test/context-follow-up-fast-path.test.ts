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
  type QTurnSkimmer,
} from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * DECISIONS 104 (owner, 2026-11-17): "expand on the second one. Why does
 * it matter?" (conversation 9995dcca, 14:51:48) took 14.5 s: a reading, a
 * record-only recall that missed, a cancelled speculative answer and the
 * full answer (~49k input tokens, with its pre-reads). A follow-up the
 * reading classes CONTEXTUAL_FOLLOW_UP is now answered in one tool-free
 * call from what the previous full answer was given. These tests count the
 * stages with fakes and time the turn before and after, with each fake
 * stage's latency scaled from production (1 ms here is 100 ms live: the
 * reading 2.6 s, the record-only recall 1.6 s, the full answer from its
 * start with its reads 5.3 s, the one context call 3.0 s, the skim 1.3 s).
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ORG = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const MS = {
  reader: 26,
  skim: 13,
  recall: 16,
  fullAnswer: 53,
  context: 30,
};

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
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

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function message(
  conversationId: string,
  role: "USER" | "Q",
  content: string,
  spoken = false,
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
    ...(spoken ? { utteranceRef: `utt_${randomUUID()}` } : {}),
  } as QConversationMessage;
}

/** What the previous full answer was given (its authorised sources). */
const SOURCES = [
  "Pipeline (their own relationships): 26 opportunities are waiting for founder acceptance; 4 are in diligence.",
  "Ajopot: in diligence since 2 November 2026; next step a call with the founder.",
];

const ANSWER =
  "The 26 opportunities waiting for founder acceptance matter because your interest has not yet become a conversation, so there is no diligence or decision path to manage yet.";

function history(conversationId: string): QConversationMessage[] {
  return [
    message(
      conversationId,
      "USER",
      "Which opportunities need a decision from me?",
    ),
    message(
      conversationId,
      "Q",
      "Two things: 4 opportunities are in diligence, and 26 are waiting for founder acceptance.",
    ),
  ];
}

type Calls = {
  reader: number;
  skim: number;
  recall: number;
  /** The full path: tools, pre-readers, wide reads and the answer model. */
  fullAnswer: number;
  /** Model calls made by the context follow-up. */
  context: number;
};

function seam(input: {
  readonly conversationId: string;
  readonly said: string;
  readonly spoken?: boolean;
  readonly fast: boolean;
  readonly evidence: ConversationEvidence;
  readonly contextReply?: unknown;
  readonly kind?: string;
}) {
  const calls: Calls = {
    reader: 0,
    skim: 0,
    recall: 0,
    fullAnswer: 0,
    context: 0,
  };
  const stored: string[] = [];
  // Stage order, not wall-clock time: a timing bound flakes under a loaded
  // machine (release gate 17 Nov: 59 ms against < 56), order never does.
  const events: string[] = [];
  const logged: { message: string; context: Record<string, unknown> }[] = [];
  const logger = {
    debug: () => undefined,
    info: (context: Record<string, unknown>, text: string) => {
      logged.push({ message: text, context });
    },
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  const latest = message(
    input.conversationId,
    "USER",
    input.said,
    input.spoken === true,
  );
  const prior = history(input.conversationId);
  const turns: QTurnReader = {
    read: async () => {
      calls.reader += 1;
      events.push("reader:start");
      await delay(MS.reader);
      events.push("reader:end");
      return {
        kind: input.kind ?? "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "THEIR_OWN_RECORDS", text: input.said },
        answerKind: "FOLLOW_UP",
        fromShown: { turn: 1, reshow: false },
      } as never;
    },
  };
  const turnSkim: QTurnSkimmer = {
    skim: async () => {
      calls.skim += 1;
      await delay(MS.skim);
      return { kind: "OTHER", confidence: "HIGH" } as never;
    },
  };
  const gateway = {
    execute: async () => {
      calls.context += 1;
      events.push("context:start");
      await delay(MS.context);
      events.push("context:end");
      return {
        output: {
          kind: "STRUCTURED",
          value: input.contextReply ?? { answerable: true, say: ANSWER },
        },
      };
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
      answer: async () => {
        calls.fullAnswer += 1;
        await delay(MS.fullAnswer);
        stored.push("FULL PATH");
        return {
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "none",
          promptBundleVersion: "b",
        };
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () =>
          Promise.resolve([...prior, latest]),
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
    logger,
    ...(input.spoken === true ? { turnSkim } : {}),
    conversationRecall: async () => {
      calls.recall += 1;
      await delay(MS.recall);
      // Live: the record-only recall could not answer "why does it matter".
      return null;
    },
    ...(input.fast
      ? {
          contextFollowUp: createContextFollowUp({
            gateway,
            evidence: input.evidence,
          }),
        }
      : {}),
  });
  /** The fast path's own line: its outcome, and whether it began early. */
  const followUp = () =>
    logged.find((line) => line.message === "q context follow-up")?.context;
  return { answer, calls, stored, followUp, events };
}

function keptFor(conversationId: string): ConversationEvidence {
  const evidence = createConversationEvidence();
  const asked = request();
  keepAnswerContext(
    evidence,
    evidenceScopeOf({ actor, plan: asked.plan, conversationId }),
    "previous-full-answer",
    SOURCES,
  );
  return evidence;
}

async function timed<T>(work: () => Promise<T>) {
  const started = performance.now();
  const value = await work();
  return { value, ms: performance.now() - started };
}

describe("contextual follow-up fast path: stage counts (DECISIONS 104)", () => {
  it("answers 'why does it matter?' with no tools, pre-reads or full answer, and faster than before", async () => {
    const conversation = randomUUID();
    const said = "Expand on the second one. Why does it matter?";

    const before = seam({
      conversationId: conversation,
      said,
      fast: false,
      evidence: keptFor(conversation),
    });
    const was = await timed(() => before.answer.answer(request()));
    expect(was.value.kind).toBe("ANSWERED");
    // Before: reading, a record-only recall that missed, the full path.
    expect(before.calls).toMatchObject({
      reader: 1,
      recall: 1,
      fullAnswer: 1,
      context: 0,
    });

    const after = seam({
      conversationId: conversation,
      said,
      fast: true,
      evidence: keptFor(conversation),
    });
    const now = await timed(() => after.answer.answer(request()));
    expect(now.value.kind).toBe("ANSWERED");
    // After: the reading and ONE tool-free call. No recall, no full path
    // (its tools, pre-readers, retrieval, ranking and answer model).
    expect(after.calls).toEqual({
      reader: 1,
      skim: 0,
      recall: 0,
      fullAnswer: 0,
      context: 1,
    });
    expect(after.stored).toEqual([ANSWER]);
    // The saving is structural: the recall and the full path never ran
    // (counts above), and the one call followed the reading.
    expect(after.events).toEqual([
      "reader:start",
      "reader:end",
      "context:start",
      "context:end",
    ]);
  });

  it("a spoken follow-up starts its one call beside the reading, and adopts it once read", async () => {
    const conversation = randomUUID();
    const s = seam({
      conversationId: conversation,
      said: "and why does that matter?",
      spoken: true,
      fast: true,
      evidence: keptFor(conversation),
    });
    const turn = await timed(() => s.answer.answer(request()));
    expect(turn.value.kind).toBe("ANSWERED");
    expect(s.calls).toMatchObject({
      reader: 1,
      skim: 1,
      recall: 0,
      fullAnswer: 0,
      context: 1,
    });
    expect(s.stored).toEqual([ANSWER]);
    // Overlapped: the call began before the reading finished, and was
    // adopted once read.
    expect(s.followUp()).toMatchObject({ outcome: "ANSWERED", early: true });
    expect(s.events.indexOf("context:start")).toBeLessThan(
      s.events.indexOf("reader:end"),
    );
  });

  it("an early call is never used when the reading is not a follow-up", async () => {
    const conversation = randomUUID();
    const s = seam({
      conversationId: conversation,
      said: "thanks",
      spoken: true,
      fast: true,
      kind: "SMALL_TALK",
      evidence: keptFor(conversation),
    });
    await s.answer.answer(request());
    expect(s.stored).not.toContain(ANSWER);
    expect(s.followUp()).toBeUndefined();
  });

  it("falls back to the full path when the sources do not hold the answer", async () => {
    const conversation = randomUUID();
    const s = seam({
      conversationId: conversation,
      said: "and their burn?",
      fast: true,
      evidence: keptFor(conversation),
      contextReply: { answerable: false, say: null },
    });
    await s.answer.answer(request());
    // The recall holds less than the context call: not asked again.
    expect(s.calls).toMatchObject({ context: 1, recall: 0, fullAnswer: 1 });
    expect(s.stored).toEqual(["FULL PATH"]);
  });

  it("falls back when a figure is not in the sources (claim check), never publishing it", async () => {
    const conversation = randomUUID();
    const s = seam({
      conversationId: conversation,
      said: "and their burn?",
      fast: true,
      evidence: keptFor(conversation),
      contextReply: {
        answerable: true,
        say: "Their monthly burn is USD 240,000.",
      },
    });
    await s.answer.answer(request());
    expect(s.calls).toMatchObject({ context: 1, fullAnswer: 1 });
    expect(s.stored).toEqual(["FULL PATH"]);
  });

  it("evidence of another conversation is never reused: no call, the full path answers", async () => {
    const s = seam({
      conversationId: randomUUID(),
      said: "Why does it matter?",
      fast: true,
      evidence: keptFor(randomUUID()),
    });
    await s.answer.answer(request());
    expect(s.calls).toMatchObject({ context: 0, fullAnswer: 1 });
  });
});
