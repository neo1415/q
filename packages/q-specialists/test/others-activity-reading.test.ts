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
 * Audit 2026-11-13 item 17 (privacy): the reader's `othersActivity`
 * (TURN_READER v93) reaches the answer as `othersActivityAsked`, under the
 * same plan and actor, so the answer withholds other parties' interest
 * whatever words asked for it. A speculative answer written without that
 * note is never adopted. Fakes only.
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
            message("USER", "Is anybody else circling Kazikit?"),
            message("Q", "I can't share other investors' interest."),
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

const reading = (text: string, othersActivity?: boolean) => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind: "GENERAL", text },
  aboutNamedOther: false,
  ...(othersActivity === undefined ? {} : { othersActivity }),
});

describe("v93 othersActivity on the answer path", () => {
  it.each([
    "and how many of them?",
    "¿Alguien más está mirando Kazikit?",
    "Est-ce que d'autres fonds regardent Kazikit ?",
    "Has Kazikit got other suitors?",
  ])("%s, read so, reaches the answer under the same plan", async (said) => {
    const s = seam(said, reading(said, true));
    const req = request();
    await s.answer.answer(req);
    const delegated = s.delegated[0];
    expect(delegated?.othersActivityAsked).toBe(true);
    // Nothing about authorization changes: the same plan and actor.
    expect(delegated?.plan).toBe(req.plan);
    expect(delegated?.actor).toBe(req.actor);
  });

  it("a reading without it, or false, adds nothing", async () => {
    for (const read of [
      reading("What's my interest in Kazikit?"),
      reading("What's my interest in Kazikit?", false),
    ]) {
      const s = seam("What's my interest in Kazikit?", read);
      await s.answer.answer(request());
      expect(s.delegated[0]).toBeDefined();
      expect(s.delegated[0]?.othersActivityAsked).toBeUndefined();
    }
  });

  it("a speculative answer written without the note is never adopted", () => {
    const base = request();
    const research = { allowed: false } as never;
    expect(
      speculationMisfit({
        final: { ...base, othersActivityAsked: true },
        finalResearch: research,
        ownRecords: false,
        speculative: base,
        speculativeResearch: research,
      }),
    ).toBe("NOTE");
    expect(
      speculationMisfit({
        final: base,
        finalResearch: research,
        ownRecords: false,
        speculative: base,
        speculativeResearch: research,
      }),
    ).toBeNull();
  });
});
