import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import type {
  QAnswerOutcome,
  QAnswerRequest,
  QConversationMessage,
  QQuestionSequenceStep,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * R35: "ask me three questions about my mandate" used to get one question
 * and then nothing. The series is held by the conversation core and each
 * answer is told which question it is on, until done or stopped. The
 * reader is a double: the words vary, the reading decides.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const CONVERSATION = randomUUID();

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
      purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
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

type Reading = Awaited<ReturnType<QTurnReader["read"]>>;

const base = {
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
  moreDocuments: [],
} as const;

const START = (count: number): Reading => ({
  ...base,
  kind: "TOOL_REQUEST",
  sequence: { action: "START", count, topic: "my mandate" },
});
const ANSWER: Reading = { ...base, kind: "ANSWER", sequence: null };
const STOP: Reading = {
  ...base,
  kind: "CONTROL",
  sequence: { action: "STOP", count: null, topic: null },
};

/** A conversation whose turns are said one by one, each with its reading. */
function conversation() {
  const history: QConversationMessage[] = [];
  let reading: Reading = null;
  const steps: (QQuestionSequenceStep | null)[] = [];
  const failNext: boolean[] = [];
  const turns: QTurnReader = { read: () => Promise.resolve(reading) };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      answer: (req) => {
        steps.push(req.questionSequence ?? null);
        const outcome: QAnswerOutcome =
          failNext.shift() === true
            ? { kind: "FAILED", diagnosticCode: "MODEL_PROVIDER_TIMEOUT" }
            : {
                kind: "ANSWERED",
                messageId: "m",
                modelPolicyVersion: "p",
                promptBundleVersion: "b",
              };
        return Promise.resolve(outcome);
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([...history]),
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
  });
  return {
    steps,
    failNext,
    say: async (said: string, read: Reading) => {
      reading = read;
      history.push({
        id: randomUUID() as QConversationMessage["id"],
        tenantId: TENANT as QConversationMessage["tenantId"],
        conversationId: CONVERSATION as QConversationMessage["conversationId"],
        runId: randomUUID() as QConversationMessage["runId"],
        role: "USER",
        content: said,
        contentType: "TEXT",
        createdAt: new Date().toISOString(),
      });
      await answer.answer(request());
      return steps.at(-1) ?? null;
    },
  };
}

describe("a requested series of questions (R35)", () => {
  it("continues after each answer until N questions are asked, then closes", async () => {
    const c = conversation();
    await c.say("Ask me three questions about my mandate.", START(3));
    await c.say("Seed and Series A.", ANSWER);
    await c.say("Fintech and climate.", ANSWER);
    await c.say("Europe only.", ANSWER);
    await c.say("Thanks.", { ...base, kind: "SMALL_TALK", sequence: null });
    expect(
      c.steps.map((s) =>
        s === null ? null : [s.kind, "number" in s ? s.number : null],
      ),
    ).toEqual([["ASK", 1], ["ASK", 2], ["ASK", 3], ["FINISHED", null], null]);
  });

  it("stops when the person asks it to", async () => {
    const c = conversation();
    await c.say("Quiz me on my mandate, five questions.", START(5));
    await c.say("Seed.", ANSWER);
    expect(await c.say("That's enough for now.", STOP)).toMatchObject({
      kind: "STOPPED",
    });
    expect(await c.say("Europe.", ANSWER)).toBeNull();
  });

  it("depends on the reading, never the words: paraphrases with one reading behave alike", async () => {
    const paraphrases = [
      "Ask me three questions about my mandate.",
      "can u quiz me w/ 3 qs on my mandate",
      "Three questions on my mandate please, one at a time.",
      "Interview me about my investment mandate — 3 questions.",
    ];
    const runs: (QQuestionSequenceStep | null)[][] = [];
    for (const words of paraphrases) {
      const c = conversation();
      await c.say(words, START(3));
      await c.say("Seed.", ANSWER);
      await c.say("Stop, please.", STOP);
      runs.push(c.steps);
    }
    for (const steps of runs) expect(steps).toEqual(runs[0]);
    // And words that sound like a request, read as none, start nothing.
    const c = conversation();
    expect(
      await c.say("Ask me three questions about my mandate.", {
        ...base,
        kind: "QUESTION_TO_Q",
        sequence: null,
      }),
    ).toBeNull();
  });

  it("does not move the series when the answer failed", async () => {
    const c = conversation();
    await c.say("Ask me two questions about my mandate.", START(2));
    c.failNext.push(true);
    await c.say("Seed.", ANSWER);
    // The failed turn was to ask question 2; the retry asks it again.
    expect(await c.say("Seed.", ANSWER)).toMatchObject({
      kind: "ASK",
      number: 2,
    });
  });
});
