import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import {
  RECOMMENDATION_UNAVAILABLE_MESSAGE,
  type CompanyAnalystResult,
} from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type FakeBehaviour,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * "Why am I seeing this company?" through the conversational seam
 * (CQ-REC-007R B; doc 19 §56, §59).
 *
 * The recommendation guard used to delete every sentence claiming a
 * recommendation had happened, because none had. Now one can have. The
 * property under test is where the licence comes from: the ranker's own
 * factors, arriving as a tool result, and never the model's confidence.
 * The same sentence from the same model is published or removed purely on
 * whether the ranking engine actually produced anything.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();

const EXPLANATION_TOOL: QOfferedTool = {
  toolName: "recommendation.explanation",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "recommendation_explanation",
    description: "Explains why a company is in this person's recommendations.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "COMPARING_OPPORTUNITIES",
};

function analystResult(answer: string): CompanyAnalystResult {
  return {
    answer,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
  };
}

function plan(): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

const EXPLAINED = {
  status: "EXPLAINED",
  summary: "It matches on stage.",
  matched: [
    { dimension: "STAGE", outcome: "MATCH", label: "Seed, inside the range" },
  ],
  notMatched: [
    {
      dimension: "GEOGRAPHY",
      outcome: "MISMATCH",
      label: "outside the declared markets",
    },
  ],
  unknown: [
    {
      dimension: "TAXONOMY",
      outcome: "UNKNOWN",
      label: "sector not established",
    },
  ],
  rankingVersion: "ranking-config.v1",
};

function explanationPort(data: unknown): QToolPort {
  return {
    offer: () => Promise.resolve([EXPLANATION_TOOL]),
    execute: (proposal: QToolProposal) =>
      Promise.resolve({
        callId: proposal.callId,
        toolName: "recommendation.explanation",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "NETWORK_VISIBLE",
        result: { ok: true, data },
        latencyMs: 2,
      } satisfies QToolCallOutcome),
  };
}

function build(options: {
  readonly script: readonly FakeBehaviour[];
  readonly tools?: QToolPort | undefined;
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: options.script,
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const messages: QConversationMessage[] = [
    {
      id: randomUUID() as QConversationMessage["id"],
      tenantId: TENANT as QConversationMessage["tenantId"],
      conversationId: CONVERSATION as QConversationMessage["conversationId"],
      runId: RUN as QConversationMessage["runId"],
      role: "USER",
      content: "Why am I seeing this company?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        input: { role: "USER" | "Q"; content: string },
      ) => {
        const message = {
          ...messages[0],
          id: randomUUID(),
          role: input.role,
          content: input.content,
        } as QConversationMessage;
        messages.push(message);
        return Promise.resolve(message);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(1) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: options.tools,
  });
  const request: QAnswerRequest = {
    runId: RUN as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: plan(),
  };
  return { seam, messages, request };
}

const toolCall = (): FakeBehaviour => ({
  kind: "TOOL_CALLS",
  calls: [
    {
      callId: "c1",
      name: "recommendation_explanation",
      arguments: { companyId: randomUUID() },
    },
  ],
});

const stored = (messages: readonly QConversationMessage[]): string =>
  messages.filter((m) => m.role === "Q").at(-1)?.content ?? "";

const WHY =
  "This company was surfaced to you because your mandate declares Seed and this company is Seed.";

describe("explaining a recommendation in conversation", () => {
  it("publishes the explanation when the ranker produced the factors", async () => {
    const { seam, messages, request } = build({
      script: [toolCall(), { kind: "JSON", value: analystResult(WHY) }],
      tools: explanationPort(EXPLAINED),
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(stored(messages)).toBe(WHY);
  });

  it("removes the same sentence when no tool established anything", async () => {
    // Same model, same words. Without the ranker's factors nobody decided
    // this, so the claim is invented and Capital Q says so.
    const { seam, messages, request } = build({
      script: [{ kind: "JSON", value: analystResult(WHY) }],
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(stored(messages)).toBe(RECOMMENDATION_UNAVAILABLE_MESSAGE);
  });

  it("removes it when the company was in no slate, however fluent the model is", async () => {
    const { seam, messages, request } = build({
      script: [toolCall(), { kind: "JSON", value: analystResult(WHY) }],
      tools: explanationPort({
        status: "NOT_RECOMMENDED",
        summary: null,
        matched: [],
        notMatched: [],
        unknown: [],
        rankingVersion: null,
      }),
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(stored(messages)).toBe(RECOMMENDATION_UNAVAILABLE_MESSAGE);
  });

  it("still refuses arithmetic even with the factors in hand", async () => {
    // Being able to explain a recommendation is not permission to
    // quantify it: REC-005 produces no percentage for anyone to quote.
    const { seam, messages, request } = build({
      script: [
        toolCall(),
        {
          kind: "JSON",
          value: analystResult(`${WHY} Overall it is a 91% match.`),
        },
      ],
      tools: explanationPort(EXPLAINED),
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(stored(messages)).toBe(WHY);
    expect(stored(messages)).not.toContain("91%");
  });

  it("leaves ordinary conversation alone either way", async () => {
    const chat = "Morning. What would you like to look at today?";
    for (const tools of [undefined, explanationPort(EXPLAINED)]) {
      const { seam, messages, request } = build({
        script: tools
          ? [toolCall(), { kind: "JSON", value: analystResult(chat) }]
          : [{ kind: "JSON", value: analystResult(chat) }],
        tools,
      });
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      expect(stored(messages)).toBe(chat);
    }
  });
});
