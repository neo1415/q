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
import { knownEntityLaneOf, type KnownEntityMatch } from "../src/fast-lane.js";

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

const ENTITIES: readonly (KnownEntityMatch & {
  readonly keys: readonly string[];
})[] = [
  {
    keys: ["shadi qishta", "shady kishta", "shadi qishta doha"],
    displayName: "Shadi Qishta",
    entityKind: "PERSON",
    nameWords: ["shadi", "qishta", "doha", "midmac"],
    contextWords: ["doha", "qatar"],
  },
  {
    keys: ["qinvest", "q invest", "qinvest llc"],
    displayName: "QInvest LLC",
    entityKind: "ORGANIZATION",
    nameWords: ["qinvest", "llc", "q", "invest"],
    contextWords: ["qatar"],
  },
  {
    keys: ["alrayan", "alrayan investment", "al rayan investment"],
    displayName: "AlRayan Investment LLC",
    entityKind: "ORGANIZATION",
    nameWords: ["alrayan", "investment", "llc", "al", "rayan"],
    contextWords: ["qatar"],
  },
];

/** Stands in for the warm index: exact keys only; generic words find nothing. */
const matcher = (candidate: string): KnownEntityMatch | null =>
  ENTITIES.find((e) => e.keys.includes(candidate)) ?? null;

function seam(said: string) {
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
        listRecentForConversationOfRun: () => Promise.resolve([message]),
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
    knownEntities: matcher,
  });
  return { answer, delegated, modelCalls: () => modelCalls };
}

describe("the known-entity instant lane", () => {
  it.each([
    ["Who is Shadi Qishta?", "Shadi Qishta", "PERSON"],
    ["Tell me about QInvest", "QInvest LLC", "ORGANIZATION"],
    ["Find Shady Kishta in Doha", "Shadi Qishta", "PERSON"],
  ])(
    "%s: the card is handed over with zero model calls",
    async (said, name, kind) => {
      const s = seam(said);
      const outcome = await s.answer.answer(request());
      expect(outcome.kind).toBe("ANSWERED");
      expect(s.modelCalls()).toBe(0);
      expect(s.delegated).toHaveLength(1);
      expect(s.delegated[0]?.questionKind).toBe("PERSON_SEARCH");
      expect(s.delegated[0]?.personSearch).toMatchObject({
        name,
        entityKind: kind,
        freshSearch: false,
      });
    },
  );

  it.each([
    "compare QInvest and AlRayan",
    "rehearse with Shadi Qishta",
    "Invest",
    "Who is Zorblax Quendrick?",
    "Find Shadi Qishta in Paris",
    "who is the CEO of QInvest",
    "Shadi Qishta news",
  ])("%s: not an instant lookup; the lane stays out of it", (said) => {
    expect(knownEntityLaneOf(said, matcher)).toBeNull();
  });

  it("a non-lookup turn is read the normal way", async () => {
    const s = seam("compare QInvest and AlRayan");
    await s.answer.answer(request());
    expect(s.modelCalls()).toBeGreaterThan(0);
    expect(s.delegated[0]?.questionKind).not.toBe("PERSON_SEARCH");
  });
});
