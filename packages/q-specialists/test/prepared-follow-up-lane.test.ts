import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnSkimmer } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import { lastShownEntityId } from "../src/fast-lane.js";

/**
 * K fast lane (founder brief 2026-10-09): the short first read races the
 * full turn reading; a HIGH confidence "companies of a kind" or "fit" is
 * handed to the read-only app query before the full reading lands. Fakes
 * only: the reader is slow on purpose, the skim quick.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const CONVERSATION = randomUUID();
/** What the full turn reading takes here (hosted p50 is ~1.2 s). */
const READ_MS = 400;
const SKIM_MS = 20;

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

const later = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";

const cardMessage = (cards: number): QConversationMessage =>
  ({
    id: randomUUID(),
    tenantId: TENANT,
    conversationId: CONVERSATION,
    runId: randomUUID(),
    role: "Q",
    content:
      "Muhannad Taslaq is the Director of Investments at Alchemist Doha.",
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    blocks: [
      {
        kind: "ANSWER_CARDS",
        cards: Array.from({ length: cards }, () => ({
          name: "Muhannad Taslaq",
          external: { externalPersonId: ENTITY_ID },
        })),
      },
    ],
  }) as never;

function seam(said: string, history: readonly QConversationMessage[]) {
  const message: QConversationMessage = {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role: "USER",
    content: said,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  };
  let modelCalls = 0;
  const turns: QTurnReader = {
    read: () => {
      modelCalls += 1;
      return later(READ_MS, {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "ADVICE", text: said },
      } as never);
    },
  };
  const turnSkim: QTurnSkimmer = {
    skim: () => {
      modelCalls += 1;
      return later(SKIM_MS, null);
    },
  };
  const delegated: QAnswerRequest[] = [];
  const stored: string[] = [];
  const seen: { utterance: string; lastShownEntityId: string | null }[] = [];
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
        listRecentForConversationOfRun: () =>
          Promise.resolve([...history, message]),
        mark: () => Promise.resolve(),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          stored.push(input.content);
          return Promise.resolve({
            ...input,
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
    preparedFollowUp: (input) => {
      seen.push(input);
      return /more about (him|this person)|said about founders/iu.test(
        input.utterance,
      )
        ? "From the prepared brief."
        : null;
    },
  });
  return { answer, delegated, stored, seen, modelCalls: () => modelCalls };
}

describe("prepared-entity follow-ups at the answer", () => {
  it.each([
    "Tell me more about this person",
    "tell me more about him",
    "What has Muhannad said about founders?",
  ])(
    "%s: answered by code, no analyst, no model, under a second",
    async (said) => {
      const s = seam(said, [cardMessage(1)]);
      const started = Date.now();
      const outcome = await s.answer.answer(request());
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(outcome.kind).toBe("ANSWERED");
      expect(s.stored).toEqual(["From the prepared brief."]);
      expect(s.delegated).toHaveLength(0);
      expect(s.modelCalls()).toBe(0);
      expect(s.seen[0]?.lastShownEntityId).toBe(ENTITY_ID);
    },
  );

  it("with no card shown, a pronoun is left to the normal path", async () => {
    const s = seam("tell me more about him", []);
    await s.answer.answer(request());
    expect(s.seen[0]?.lastShownEntityId).toBeNull();
    expect(s.stored).toEqual(["From the prepared brief."]);
  });

  it("a turn the port does not own is read the normal way", async () => {
    const s = seam("what is the weather", [cardMessage(1)]);
    await s.answer.answer(request());
    expect(s.stored).toEqual([]);
    expect(s.modelCalls()).toBeGreaterThan(0);
  });

  it("a list of candidates names no entity", async () => {
    const s = seam("tell me more about him", [cardMessage(3)]);
    await s.answer.answer(request());
    expect(s.seen[0]?.lastShownEntityId).toBeNull();
  });

  it("a later card of something else ends 'this person'", () => {
    const history = [
      cardMessage(1),
      {
        role: "Q",
        blocks: [{ kind: "ANSWER_CARDS", cards: [{ external: undefined }] }],
      },
    ] as never;
    expect(lastShownEntityId(history)).toBeNull();
  });
});
