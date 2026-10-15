import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnSkimmer } from "@capital-q/model-gateway/q";
import type { TurnSkimResult } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import { fastLaneOf } from "../src/fast-lane.js";

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

const DISCOVER: NonNullable<TurnSkimResult["discover"]> = {
  sectors: ["fintech"],
  countries: ["ng"],
  stages: [],
  ranking: "NONE",
  mandateRelevant: false,
  previous: false,
};

const SKIM_DISCOVER: TurnSkimResult = {
  kind: "DISCOVER_COMPANIES",
  confidence: "HIGH",
  count: 3,
  discover: DISCOVER,
  person: null,
};

function seam(said: string, skim: TurnSkimResult | null) {
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
  let reads = 0;
  let skims = 0;
  const turns: QTurnReader = {
    read: () => {
      reads += 1;
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
      skims += 1;
      return later(SKIM_MS, skim);
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
  });
  return {
    answer,
    delegated,
    reads: () => reads,
    skims: () => skims,
  };
}

describe("the fast lane (K)", () => {
  it("answers companies of a kind from the skim, without waiting for the full reading", async () => {
    const s = seam("show me three fintech companies in Nigeria", SKIM_DISCOVER);
    const started = Date.now();
    const outcome = await s.answer.answer(request());
    const took = Date.now() - started;
    expect(outcome.kind).toBe("ANSWERED");
    expect(s.skims()).toBe(1);
    expect(s.delegated).toHaveLength(1);
    expect(s.delegated[0]?.questionKind).toBe("DISCOVER_COMPANIES");
    expect(s.delegated[0]?.discoverCompanies).toMatchObject({
      sectors: ["fintech"],
      countries: ["NG"],
      count: 3,
    });
    expect(await s.delegated[0]?.research).toEqual({
      mode: "NEVER",
      announceSourceChange: false,
    });
    // The answer is handed over in the skim's time, not the reading's.
    expect(took).toBeLessThan(READ_MS - 100);
  });

  it("a skim that names anything else waits for the full reading", async () => {
    const s = seam("what should I ask Kora's founder?", {
      kind: "OTHER",
      confidence: "HIGH",
      count: null,
      discover: null,
      person: null,
    });
    const started = Date.now();
    await s.answer.answer(request());
    expect(Date.now() - started).toBeGreaterThanOrEqual(READ_MS - 20);
    expect(s.delegated[0]?.discoverCompanies).toBeUndefined();
    expect(s.delegated[0]?.questionKind).toBe("ADVICE");
  });

  it("a skim that is not sure waits for the full reading", async () => {
    const s = seam("fintech?", { ...SKIM_DISCOVER, confidence: "MEDIUM" });
    await s.answer.answer(request());
    expect(s.delegated[0]?.discoverCompanies).toBeUndefined();
  });
});

describe("fastLaneOf (K)", () => {
  it("takes only a HIGH confidence read-only ask, never one about companies shown", () => {
    expect(fastLaneOf(SKIM_DISCOVER, "three fintech")?.questionKind).toBe(
      "DISCOVER_COMPANIES",
    );
    expect(
      fastLaneOf(
        {
          kind: "FIT",
          confidence: "HIGH",
          count: 3,
          discover: null,
          person: null,
        },
        "best companies for me",
      ),
    ).toEqual({
      questionKind: "FIT",
      fitQuestion: { text: "best companies for me", count: 3, previous: false },
    });
    expect(
      fastLaneOf(
        {
          ...SKIM_DISCOVER,
          discover: { ...DISCOVER, previous: true },
        },
        "which of those are fintech",
      ),
    ).toBeNull();
    expect(
      fastLaneOf(
        {
          ...SKIM_DISCOVER,
          discover: {
            ...DISCOVER,
            sectors: [],
            countries: [],
          },
        },
        "show me companies",
      ),
    ).toBeNull();
    expect(fastLaneOf(null, "anything")).toBeNull();
  });
});
