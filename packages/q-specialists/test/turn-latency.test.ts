import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QResultBlock,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";
import type { QTurnReader, QTurnSkimmer } from "@capital-q/model-gateway/q";

import { createSpecialistQAnswer, ordinalRecallLine } from "../src/answer.js";
import { tabAskOf } from "../src/tab-request.js";

/**
 * Turn latency 2026-10-20: model calls per ordinary turn, counted. Each
 * reader, skim, recall and full answer below is a model call in
 * production; a code lane makes none of them.
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

const card = (name: string, companyId: string) => ({
  key: name.toLowerCase().replace(/\s+/gu, ""),
  name,
  hue: 1,
  line: "seed · United Kingdom",
  about: `${name} in a line.`,
  reasons: [],
  said: `${name}.`,
  view: null,
  subject: { kind: "COMPANY", companyId },
  measures: [],
  sourceCount: 0,
});

const TOP_THREE = {
  kind: "ANSWER_CARDS",
  shape: "RANKED",
  title: "Fit against your mandate",
  followUps: [],
  cards: [
    card("Halyard Security", HALYARD),
    card("Clearwater Assurance", CLEARWATER),
    card("Tensorgate", TENSORGATE),
  ],
} as unknown as QResultBlock;

function message(
  conversationId: string,
  role: "USER" | "Q",
  content: string,
  extra: Partial<QConversationMessage> = {},
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
    ...extra,
  } as QConversationMessage;
}

function afterTopThree(conversationId: string): QConversationMessage[] {
  return [
    message(conversationId, "USER", "show me the top three on my mandate"),
    message(
      conversationId,
      "Q",
      "Halyard Security, Clearwater Assurance and Tensorgate are on screen.",
      { blocks: [TOP_THREE] },
    ),
  ];
}

function seam(input: {
  readonly said: string;
  readonly history: readonly QConversationMessage[];
  readonly spoken?: boolean;
  readonly speculation?: boolean;
}) {
  const conversationId = input.history[0]?.conversationId ?? randomUUID();
  const latest = message(
    conversationId,
    "USER",
    input.said,
    input.spoken === true ? { utteranceRef: `utt_${randomUUID()}` } : {},
  );
  const calls = { reader: 0, skim: 0, recall: 0, answer: 0 };
  const stored: string[] = [];
  const turns: QTurnReader = {
    read: () => {
      calls.reader += 1;
      return Promise.resolve({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "FIT", text: input.said },
        fromShown: null,
      } as never);
    },
  };
  const turnSkim: QTurnSkimmer = {
    skim: () => {
      calls.skim += 1;
      return Promise.resolve({ kind: "OTHER", confidence: "HIGH" } as never);
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
      answer: () => {
        calls.answer += 1;
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
    turnSkim,
    conversationRecall: () => {
      calls.recall += 1;
      return Promise.resolve("from the record");
    },
    ...(input.speculation === true
      ? { speculation: { spoken: true, observe: () => undefined } }
      : {}),
  });
  /** The run as the orchestrator drives it: an early read, then the answer. */
  const run = async () => {
    const asked = request();
    answer.preread?.({
      runId: asked.runId,
      tenantId: asked.tenantId,
      actor: asked.actor,
      correlationId: asked.correlationId,
    });
    await answer.answer(asked);
    // Whatever the early read started has had its chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const modelCalls = calls.reader + calls.skim + calls.recall + calls.answer;
    return { calls, modelCalls, stored };
  };
  return { run };
}

describe("'what was the second one?' after Q's list: 0 model calls", () => {
  it.each([
    "What was the second one?",
    "so which was the second company again?",
    "remind me what the second one was",
    "who's the 2nd one",
  ])("%s", async (said) => {
    const s = seam({ said, history: afterTopThree(randomUUID()) });
    const { calls, modelCalls, stored } = await s.run();
    expect(modelCalls).toBe(0);
    expect(calls).toEqual({ reader: 0, skim: 0, recall: 0, answer: 0 });
    expect(stored).toEqual(["The second one was Clearwater Assurance."]);
  });

  it("the last one, by code", async () => {
    const s = seam({
      said: "and what was the last one?",
      history: afterTopThree(randomUUID()),
    });
    const { modelCalls, stored } = await s.run();
    expect(modelCalls).toBe(0);
    expect(stored).toEqual(["The last one was Tensorgate."]);
  });

  it("a question about the second one is still read and answered", async () => {
    const s = seam({
      said: "what was the second one's burn rate?",
      history: afterTopThree(randomUUID()),
    });
    const { calls } = await s.run();
    expect(calls.reader).toBe(1);
    expect(calls.answer).toBe(1);
  });

  it("with no list of Q's in this conversation, nothing is named", async () => {
    const conversation = randomUUID();
    const s = seam({
      said: "what was the second one?",
      history: [message(conversation, "USER", "hello")],
    });
    const { calls, stored } = await s.run();
    expect(stored).not.toContain("The second one was Clearwater Assurance.");
    expect(calls.reader).toBe(1);
  });

  it("only Q's own list binds it, never a page list", () => {
    expect(
      ordinalRecallLine("what was the second one?", {
        kind: "ONE",
        entity: { kind: "COMPANY", id: CLEARWATER, name: "Clearwater" },
        via: "PAGE",
      }),
    ).toBeNull();
  });
});

describe("the early skim is not paid for once it cannot decide", () => {
  it("a typed follow-up after cards: no skim, one reading, one answer", async () => {
    const s = seam({
      said: "why does Halyard fit my mandate so well?",
      history: afterTopThree(randomUUID()),
    });
    const { calls, modelCalls } = await s.run();
    expect(calls.skim).toBe(0);
    expect(calls.reader).toBe(1);
    expect(calls.answer).toBe(1);
    expect(modelCalls).toBe(2);
  });

  it("a first question still races the skim against the reading", async () => {
    const conversation = randomUUID();
    const s = seam({
      said: "why does Halyard fit my mandate so well?",
      history: [message(conversation, "USER", "hello")],
    });
    const { calls } = await s.run();
    expect(calls.skim).toBe(1);
  });

  it("a spoken follow-up keeps the skim that gates the voice speculation", async () => {
    const s = seam({
      said: "why does Halyard fit my mandate so well?",
      history: afterTopThree(randomUUID()),
      spoken: true,
      speculation: true,
    });
    const { calls } = await s.run();
    expect(calls.skim).toBe(1);
  });
});

describe("a tab by its name is read by code", () => {
  it.each([
    ["open the data room", "dataroom"],
    ["now the pitch deck", "deck"],
    ["The pitch deck.", "deck"],
    ["and their data room", "dataroom"],
    ["the team tab", "team"],
  ])("%s -> %s", (said, tab) => {
    expect(tabAskOf(said)).toMatchObject({ tab, name: null });
  });

  it.each([
    "make the pitch deck shorter",
    "draft a deck",
    "a deck",
    "what's in the pitch deck?",
    "the conversation",
    "I liked the team",
  ])("%s is not a tab", (said) => {
    expect(tabAskOf(said)).toBeNull();
  });

  it("'now the pitch deck' makes no skim and no reading early", async () => {
    // No screen in this run: the code lane declines, and only then is the
    // turn read -- once, by the answer path, never also beforehand.
    const s = seam({
      said: "now the pitch deck",
      history: afterTopThree(randomUUID()),
    });
    const { calls } = await s.run();
    expect(calls.skim).toBe(0);
    expect(calls.reader).toBeLessThanOrEqual(1);
  });
});
