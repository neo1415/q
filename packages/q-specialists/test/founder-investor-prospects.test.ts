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
import { readsAsAboutSubjectCompany } from "../src/company/about-company.js";

/**
 * Founder investor matching (owner 2026-10-23, run a057fc00): "Which
 * investors should I talk to first, and why?" was read as ADVICE, went to
 * the company specialist (company.get, capital_objective.get, no tools)
 * and Q said no fit evidence was available. TURN_READER v58 reads it as
 * INVESTOR_PROSPECTS; the answer path hands it to the code answer and the
 * company specialist never takes it. Fakes only.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const COMPANY = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const CONVERSATION = randomUUID();

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

/** A founder asking about their own company (its subject added by the run). */
function founderRequest(): QAnswerRequest {
  const runId = randomUUID();
  const subject = { kind: "COMPANY" as const, companyId: COMPANY };
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects: [subject],
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
      subjects: [subject],
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
  role: "USER" | "Q",
  content: string,
  blocks?: QConversationMessage["blocks"],
): QConversationMessage {
  return {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    ...(blocks === undefined ? {} : { blocks }),
  };
}

function seam(
  said: string,
  reading: Record<string, unknown>,
  earlier: readonly QConversationMessage[],
) {
  let reads = 0;
  const turns: QTurnReader = {
    read: () => {
      reads += 1;
      return Promise.resolve(reading as never);
    },
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
          Promise.resolve([...earlier, message("USER", said)]),
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
  return { answer, delegated, reads: () => reads };
}

const prospectsReading = (text: string, kind: string) => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind, text, count: null },
});

describe("v58 INVESTOR_PROSPECTS on the answer path", () => {
  it("hands a founder's 'which investors first?' to the code answer, under the same plan", async () => {
    const said = "Which investors should I talk to first, and why?";
    const s = seam(said, prospectsReading(said, "INVESTOR_PROSPECTS"), []);
    const req = founderRequest();
    await s.answer.answer(req);
    expect(s.reads()).toBe(1);
    const delegated = s.delegated[0];
    expect(delegated?.questionKind).toBe("INVESTOR_PROSPECTS");
    expect(delegated?.investorProspects).toEqual({ text: said, count: null });
    // Nothing about authorization changes: the same plan and actor.
    expect(delegated?.plan).toBe(req.plan);
    expect(delegated?.actor).toBe(req.actor);
  });

  it("is never the company specialist's (the record-only analysis that answered 'no fit evidence')", () => {
    expect(
      readsAsAboutSubjectCompany({
        kind: "QUESTION_TO_Q",
        questionKind: "INVESTOR_PROSPECTS",
        aboutNamedOther: false,
      }),
    ).toBe(false);
    // ADVICE about their own company still is.
    expect(
      readsAsAboutSubjectCompany({
        kind: "QUESTION_TO_Q",
        questionKind: "ADVICE",
        aboutNamedOther: false,
      }),
    ).toBe(true);
  });

  it("any other question carries no investor ask", async () => {
    const said = "How do I prepare for an investor call?";
    const s = seam(said, prospectsReading(said, "ADVICE"), []);
    await s.answer.answer(founderRequest());
    expect(s.delegated[0]?.investorProspects).toBeUndefined();
  });
});
