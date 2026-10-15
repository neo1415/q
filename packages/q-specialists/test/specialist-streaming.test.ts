import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QLiveDeltaBus,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * S3 (lane S, live 2026-10-15 run 0b763858: a selected-record answer
 * reached the person only at 31.6 s): the company specialist's sentences
 * go out on the live bus under the stored message's own id, after the
 * answer's guards. Fakes only.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const COMPANY = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
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
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER, organisationId: actor.organisationId },
      purpose: {
        capability: "ANSWER",
        taskClass: "COUNTERPARTY_COMPANY_QUESTION",
      },
      subjects: [{ kind: "COMPANY", companyId: COMPANY }],
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

function seam(withBus: boolean, said = "What are the main risks here?") {
  const message: QConversationMessage = {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: randomUUID() as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role: "USER",
    content: said,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  };
  const published: { messageId: string; text: string }[] = [];
  const stored: { id?: string; content: string }[] = [];
  const investigated: { publicResearch?: boolean | undefined }[] = [];
  const bus = {
    publish: (delta: { messageId: string; text: string }) => {
      published.push(delta);
    },
    subscribe: () => () => undefined,
  } as unknown as QLiveDeltaBus;
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => true,
      investigate: (input, context) => {
        investigated.push(input);
        context.onAnswerSentence?.("Credit performance is the first risk.");
        context.onAnswerSentence?.("It is a 91% fit with your mandate.");
        context.onAnswerSentence?.("I've prepared a draft for your approval.");
        context.onAnswerSentence?.("Funding is concentrated in one lender.");
        return Promise.resolve({
          blocked: null,
          findings: [],
          synthesis:
            "Credit performance is the first risk. Funding is concentrated in one lender. Evidence is thin.",
          recordedStatements: [],
          contradictions: [],
          gaps: [],
          uncertainties: [],
          telemetry: {
            specialistId: "company-intelligence",
            specialistVersion: "v1",
            promptBundleVersion: "b",
            providerCode: null,
            modelCode: null,
            routingPolicyCode: "evidence_synthesis.test",
            modelCalls: 1,
            retrievalCalls: 0,
            knowledgeReads: 0,
            toolCalls: 0,
            factCount: 0,
            promptCharacters: 0,
            latencyMs: 0,
            costUsd: 0,
            findingCountsByType: {},
            evidenceRefCount: 0,
          },
          artifactRequest: null,
        } as never);
      },
    },
    delegate: {
      warm: () => undefined,
      answer: () => Promise.reject(new Error("not the specialist path")),
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([message]),
        mark: () => Promise.resolve(),
        insert: (_tx: unknown, input: { id?: string; content: string }) => {
          stored.push(input);
          return Promise.resolve({
            ...message,
            ...input,
            role: "Q",
            id: input.id ?? randomUUID(),
          });
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    ...(withBus ? { deltas: bus } : {}),
  });
  return { answer, published, stored, investigated };
}

describe("the company specialist's answer on the live bus (S3)", () => {
  it("streams guarded sentences under the stored message's id", async () => {
    const s = seam(true);
    await s.answer.answer(request());
    expect(s.published.map((d) => d.text.trim())).toEqual([
      "Credit performance is the first risk.",
      "Funding is concentrated in one lender.",
    ]);
    const id = s.stored.at(-1)?.id;
    expect(id).toBeDefined();
    expect(new Set(s.published.map((d) => d.messageId))).toEqual(new Set([id]));
  });

  it("without a bus nothing is streamed and the answer is stored as before", async () => {
    const s = seam(false);
    await s.answer.answer(request());
    expect(s.published).toEqual([]);
    expect(s.stored.at(-1)?.content).toContain("Credit performance");
  });
});

/**
 * S7 (live 2026-10-15 d3fdbd12, f72d9994): advice about a company Capital Q
 * holds is answered from its records; the web is read only when the turn
 * asks for public information.
 */
describe("the specialist reads the public web only when asked (S7)", () => {
  const explicit = {
    research: Promise.resolve({
      mode: "EXPLICIT" as const,
      announceSourceChange: false,
    }),
  };
  it.each([
    ["What are the main risks here?", "QUESTION_TO_Q", "ADVICE", false],
    [
      "Search the web for risks with this company.",
      "QUESTION_TO_Q",
      "ADVICE",
      true,
    ],
    ["What does the press say about them?", "QUESTION_TO_Q", "ADVICE", true],
    ["What has been reported publicly?", "QUESTION_TO_Q", "PUBLIC_FACTS", true],
    ["Research their competitors.", "RESEARCH_REQUEST", "ADVICE", true],
  ] as const)(
    "%s -> publicResearch=%s",
    async (said, turnKind, questionKind, web) => {
      const s = seam(true, said);
      await s.answer.answer({
        ...request(),
        ...explicit,
        turnKind,
        questionKind,
      } as QAnswerRequest);
      expect(s.investigated.at(-1)?.publicResearch).toBe(web);
    },
  );
});
