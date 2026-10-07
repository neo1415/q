import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QResultBlock,
} from "@capital-q/contracts";
import { naturalRegisterIssues, SPOKEN_WORDS_MAX } from "@capital-q/q-core";
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
import { fitFixture } from "./fit-fixture.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Natural-conversation eval (docs/research/2026-10-07/natural-conversation.md
 * §3.5): the founder's three questions from conversation d54a7441 (Zino,
 * 2026-10-07), replayed through the real answer seam with the model's live
 * answers scripted, and checked by code -- first person, names present,
 * cards present where the question is a list, no banned phrases, no
 * question-back card beside an answer. A deterministic check of what code
 * does to an answer; how well a model talks is for the probabilistic evals.
 */

const FIT_PROFILE: QOfferedTool = {
  toolName: "fit.profile",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "fit_profile",
    description: "Fit with the mandate.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "COMPARING_OPPORTUNITIES",
};

const COMPANIES = {
  Portside: "7b62eab6-39b9-4cb6-884a-878301f6928f",
  Souqsheet: "601a1923-fc40-4fe2-a775-d01af89f60ea",
  Baridi: "7e5a7a76-857a-4528-9641-08c7bab9cc22",
} as const;

const FITS: Record<string, QToolCallOutcome["result"]> = {
  [COMPANIES.Portside]: fitFixture(COMPANIES.Portside, "Portside", {
    STAGE: "STRONG",
    SECTOR: "STRONG",
    BUSINESS_MODEL: "STRONG",
    GEOGRAPHY: "PARTIAL",
  }).result,
  [COMPANIES.Souqsheet]: fitFixture(COMPANIES.Souqsheet, "Souqsheet", {
    STAGE: "STRONG",
    SECTOR: "STRONG",
    GEOGRAPHY: "STRONG",
  }).result,
  [COMPANIES.Baridi]: fitFixture(COMPANIES.Baridi, "Baridi", {
    STAGE: "STRONG",
    SECTOR: "STRONG",
    GEOGRAPHY: "STRONG",
    BUSINESS_MODEL: "MISMATCH",
  }).result,
};

function tools(): QToolPort {
  return {
    offer: () => Promise.resolve([FIT_PROFILE]),
    execute: (proposal: QToolProposal) => {
      const id = (proposal.arguments as { companyId?: string }).companyId ?? "";
      return Promise.resolve({
        callId: proposal.callId,
        toolName: "fit.profile",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "NETWORK_VISIBLE",
        result: FITS[id] ?? { ok: true, data: { status: "NOT_FOUND" } },
        latencyMs: 2,
      });
    },
  };
}

function plan() {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: randomUUID(),
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
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

async function replay(input: {
  readonly question: string;
  readonly script: readonly FakeBehaviour[];
}): Promise<{ text: string; blocks: readonly QResultBlock[] }> {
  const run = randomUUID();
  const conversation = randomUUID();
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([
      createFakeModelProvider({ code: "alpha", script: input.script }),
    ]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const messages: QConversationMessage[] = [
    {
      id: randomUUID() as QConversationMessage["id"],
      tenantId: TENANT as QConversationMessage["tenantId"],
      conversationId: conversation as QConversationMessage["conversationId"],
      runId: run as QConversationMessage["runId"],
      role: "USER",
      content: input.question,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ];
  const completed: { message?: { blocks?: QResultBlock[] } }[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, row: { role: "USER" | "Q"; content: string }) => {
        const message = {
          ...messages[0],
          id: randomUUID(),
          role: row.role,
          content: row.content,
        } as QConversationMessage;
        messages.push(message);
        return Promise.resolve(message);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(1) },
    runEvents: {
      append: (
        _tx: unknown,
        row: { eventType?: string; payload?: unknown },
      ) => {
        if (row.eventType === "q.message.completed") {
          completed.push(row.payload as never);
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: tools(),
  });
  const request: QAnswerRequest = {
    runId: run as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: plan(),
    spoken: true,
  };
  const outcome = await seam.answer(request);
  expect(outcome.kind).toBe("ANSWERED");
  return {
    text: messages.at(-1)?.content ?? "",
    blocks: completed.at(-1)?.message?.blocks ?? [],
  };
}

const answer = (
  text: string,
  extra: Record<string, unknown> = {},
): FakeBehaviour => ({
  kind: "TEXT",
  text: JSON.stringify({
    answer: text,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    clarifyingQuestions: [],
    declined: false,
    ...extra,
  }),
});

const fitCalls: FakeBehaviour = {
  kind: "TOOL_CALLS",
  calls: Object.values(COMPANIES).map((companyId, index) => ({
    callId: `fit_${String(index)}`,
    name: "fit_profile",
    arguments: { companyId },
  })),
};

describe("natural conversation: Zino's three questions (2026-10-07)", () => {
  it("1. 'What are the companies that you've reached out to?' -- first person, names, no records-speak", async () => {
    const { text } = await replay({
      question: "What are the companies that you've reached out to?",
      script: [
        answer(
          "Capital Q records that you have expressed interest in Baridi, Portside and Souqsheet. Their responses are still pending.",
        ),
      ],
    });
    expect(text).toMatch(/^You've expressed interest in Baridi/u);
    for (const name of ["Baridi", "Portside", "Souqsheet"]) {
      expect(text).toContain(name);
    }
    expect(naturalRegisterIssues(text, { spoken: true })).toEqual([]);
  });

  it("2. 'List the companies… their scores against the mandate, pros and cons' -- cards with scores, names in the words", async () => {
    // The live answer: a score sentence per company (removed by the guard
    // before this fix, names and all), then orphan pros and cons.
    const { text, blocks } = await replay({
      question:
        "List the companies that have been reached out to so far and their scores against the mandate, including pros and cons of investing in them.",
      script: [
        fitCalls,
        answer(
          "Capital Q records interest in three companies. Portside: 8.5/10 · Good fit. Pros: seed stage, sector match. Cons: round size unknown. Baridi: 7.5/10 · Good fit. Pros: Kenya. Cons: model mismatch.",
          {
            clarifyingQuestions: [
              { question: "Want me to fetch Termly's profile next?" },
            ],
          },
        ),
      ],
    });
    const cards = blocks.find((block) => block.kind === "ANSWER_CARDS");
    expect(cards?.kind).toBe("ANSWER_CARDS");
    const names =
      cards?.kind === "ANSWER_CARDS" ? cards.cards.map((c) => c.name) : [];
    // The companies the answer names, ranked by the computed fit.
    expect(names).toEqual(["Portside", "Baridi"]);
    for (const card of cards?.kind === "ANSWER_CARDS" ? cards.cards : []) {
      expect(card.fit?.score).toBeGreaterThan(0);
      expect(card.reasons.length).toBeGreaterThan(0);
    }
    // The computed scores stay with their names; nothing reads "Pros:"
    // without one.
    expect(text).toContain("Portside");
    expect(blocks.some((block) => block.kind === "CLARIFICATION_REQUEST")).toBe(
      false,
    );
    expect(naturalRegisterIssues(text)).not.toContain("THIRD_PERSON_RECORDS");
  });

  it("2b. when the words lost every name, the spoken answer is a short named gist pointing at the cards", async () => {
    const { text, blocks } = await replay({
      question: "List them with their scores, pros and cons.",
      script: [
        fitCalls,
        answer(
          "Pros: seed stage, sector match. Cons: round size unknown. Pros: Kenya. Cons: model mismatch.",
        ),
      ],
    });
    expect(blocks.some((block) => block.kind === "ANSWER_CARDS")).toBe(true);
    expect(text).toMatch(/^I've scored 3 companies/u);
    expect(text).toContain("Souqsheet and Portside");
    expect(text.split(/\s+/u).length).toBeLessThanOrEqual(SPOKEN_WORDS_MAX);
    expect(naturalRegisterIssues(text, { spoken: true })).toEqual([]);
  });

  it("3. 'Which specific companies in Kenya closely match the criteria?' -- answer first, no question-back card", async () => {
    const { text, blocks } = await replay({
      question: "Which specific companies in Kenya closely match the criteria?",
      script: [
        answer(
          "Baridi and Maji Loop are the two in Kenya. Baridi is the closer fit on stage and sector; its business model is outside your mandate.",
          {
            clarifyingQuestions: [{ question: "Should I compare them?" }],
          },
        ),
      ],
    });
    expect(text).toMatch(/^Baridi and Maji Loop/u);
    expect(blocks.some((block) => block.kind === "CLARIFICATION_REQUEST")).toBe(
      false,
    );
    expect(naturalRegisterIssues(text, { spoken: true })).toEqual([]);
  });
});
