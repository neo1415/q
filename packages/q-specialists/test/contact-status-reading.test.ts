import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QTurnReader, QTurnSkimmer } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import { speculationMisfit } from "../src/speculation.js";

/**
 * Live 18 Nov 2026 (fictional Savanna, run cce59657): the reader's
 * `contactStatus` (TURN_READER v94) reaches the answer as
 * `contactStatusAsked`, under the same plan and actor, so code answers
 * their contact with the companies meant from the in-contact rule. A
 * speculative answer is never adopted for it. Fakes only.
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
    plan: {
      runId,
      scopes: [],
      denied: [],
    } as unknown as QAnswerRequest["plan"],
  };
}

function message(role: "USER" | "Q", content: string): QConversationMessage {
  return {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  };
}

function seam(said: string, reading: Record<string, unknown>) {
  const turns: QTurnReader = {
    read: () => Promise.resolve(reading as never),
  };
  const turnSkim: QTurnSkimmer = { skim: () => Promise.resolve(null) };
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
        listRecentForConversationOfRun: () =>
          Promise.resolve([
            message("USER", "Which three match my mandate the most?"),
            message("Q", "Ledgerline, Brancheon Works and Baridi."),
            message("USER", said),
          ]),
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
    turnSkim,
  });
  return { answer, delegated };
}

const reading = (text: string, contactStatus?: boolean) => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind: "THEIR_OWN_RECORDS", text },
  aboutNamedOther: false,
  ...(contactStatus === undefined ? {} : { contactStatus }),
});

describe("v94 contactStatus on the answer path", () => {
  it.each([
    "Am I in contact with any of those?",
    "Have I spoken to any of them?",
    "Are any of these already in my pipeline?",
    "¿Ya estoy en contacto con alguna de ellas?",
  ])("%s, read so, reaches the answer under the same plan", async (said) => {
    const s = seam(said, reading(said, true));
    const req = request();
    await s.answer.answer(req);
    const delegated = s.delegated[0];
    expect(delegated?.contactStatusAsked).toBe(true);
    expect(delegated?.plan).toBe(req.plan);
    expect(delegated?.actor).toBe(req.actor);
  });

  it("a reading without it, or false, adds nothing", async () => {
    for (const read of [
      reading("How do those compare?"),
      reading("How do those compare?", false),
    ]) {
      const s = seam("How do those compare?", read);
      await s.answer.answer(request());
      expect(s.delegated[0]).toBeDefined();
      expect(s.delegated[0]?.contactStatusAsked).toBeUndefined();
    }
  });

  it("a speculative answer is never adopted for it", () => {
    const base = request();
    const research = { allowed: false } as never;
    expect(
      speculationMisfit({
        final: { ...base, contactStatusAsked: true },
        finalResearch: research,
        ownRecords: false,
        speculative: base,
        speculativeResearch: research,
      }),
    ).toBe("NOTE");
  });
});
