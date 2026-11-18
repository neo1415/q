import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * Audit 2026-11-13 item 1 (pre-reader code lanes): the Daily lane answered
 * before any reading, so a misread was never corrected. Production, 14
 * days: 3 of its 4 fires were misreads. Here, by stage counts only (reader
 * calls and the question kind handed on), never by wall clock: the exact
 * forms after Q's own Daily line still skip the reading; the same words
 * after any other line of Q's, and the misread phrasings, are read.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

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

function seam(qSaid: string | null, said: string) {
  const conversationId = randomUUID();
  const line = (
    role: "USER" | "Q",
    content: string,
    at: number,
  ): QConversationMessage => ({
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: conversationId as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date(Date.now() - at).toISOString(),
  });
  const history: QConversationMessage[] =
    qSaid === null
      ? [line("USER", said, 0)]
      : [
          line("USER", "hello", 3_000),
          line("Q", qSaid, 2_000),
          line("USER", said, 0),
        ];
  let reads = 0;
  const turns: QTurnReader = {
    read: () => {
      reads += 1;
      return Promise.resolve({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "ADVICE", text: said },
      } as never);
    },
  };
  const delegated: QAnswerRequest[] = [];
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
        listRecentForConversationOfRun: () => Promise.resolve(history),
        mark: () => Promise.resolve(),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) =>
          Promise.resolve({ ...input, id: randomUUID() }),
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
  });
  return { answer, delegated, reads: () => reads };
}

const DAILY_GIST =
  "Lagos fintech raises a seed round. The round was led by a local fund. The other story was Nairobi logistics expands. Want that one, or shall I open this one?";
const COMPANY_ANSWER =
  "Ledgerline is a Series A payments company; its burn is not disclosed.";

describe("the Daily lane is correctable by the reading (audit item 1)", () => {
  it("an exact form after Q's own Daily line stays instant: no reading", async () => {
    const s = seam(DAILY_GIST, "the other one");
    await s.answer.answer(request());
    expect(s.reads()).toBe(0);
    expect(s.delegated).toHaveLength(1);
    expect(s.delegated[0]?.questionKind).toBe("DAILY_FOLLOW_UP");
  });

  it("a Daily verb before Q has spoken (the welcome named the stories) stays instant", async () => {
    const s = seam(null, "give me the gist");
    await s.answer.answer(request());
    expect(s.reads()).toBe(0);
    expect(s.delegated[0]?.questionKind).toBe("DAILY_FOLLOW_UP");
  });

  for (const [qSaid, said] of [
    // Production misreads, word for word.
    [COMPANY_ANSWER, "first"],
    [null, "i want to read the news"],
    [COMPANY_ANSWER, "So before this section where there is listening"],
    // Paraphrase: the same exact words, but Q last spoke about a company.
    [COMPANY_ANSWER, "give me the gist"],
  ] as const) {
    it(`"${said}" after ${qSaid === null ? "no line of Q's" : "a company answer"} is read, never sent down the Daily lane`, async () => {
      const s = seam(qSaid, said);
      await s.answer.answer(request());
      expect(s.reads()).toBe(1);
      expect(s.delegated).toHaveLength(1);
      expect(s.delegated[0]?.questionKind).not.toBe("DAILY_FOLLOW_UP");
    });
  }
});
