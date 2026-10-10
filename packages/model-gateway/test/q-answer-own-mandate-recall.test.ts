import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import {
  asksForOwnMandate,
  ownMandateAnswer,
} from "../src/q/own-mandate-answer.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * K6: "what is my mandate?" is a read of a prepared record, composed by
 * code. No dialogue call; fields not declared stay "not stated yet".
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const OWN = randomUUID();

const MANDATE_TOOL: QOfferedTool = {
  toolName: "investor_mandate.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "get_investor_mandate",
    description: "Returns the investor's declared mandate.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_INVESTOR_CRITERIA",
};

const FULL = {
  investorOrganisationId: OWN,
  displayName: "Zino Aviation",
  investorType: "ANGEL",
  deploymentState: "ACTIVELY_INVESTING",
  mandates: [
    {
      status: "ACTIVE",
      stage: { minStageCode: "pre_seed", maxStageCode: "seed" },
      cheque: {
        currency: "USD",
        min: "50000",
        typical: "100000",
        max: "250000",
      },
      constraints: [
        {
          dimension: "geography.country",
          operator: "IN",
          value: { kind: "codes", values: ["NG", "GH"] },
          importance: "REQUIRED",
          isHardExclusion: false,
          automatedUse: "ELIGIBLE",
        },
        {
          dimension: "investment_role",
          operator: "IN",
          value: { kind: "codes", values: ["lead"] },
          importance: "PREFERRED",
          isHardExclusion: false,
          automatedUse: "ELIGIBLE",
        },
      ],
      taxonomyPreferences: [
        {
          vocabularyCode: "industry",
          canonicalCode: "fintech",
          isExclusion: false,
        },
        {
          vocabularyCode: "industry",
          canonicalCode: "gambling",
          isExclusion: true,
        },
      ],
    },
  ],
};

function build(said: string, data: unknown) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer: "model answer",
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
        }),
      },
    ],
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
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const persisted: string[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([MANDATE_TOOL]),
    execute: (proposal) =>
      Promise.resolve({
        callId: proposal.callId,
        toolName: "investor_mandate.get",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: { ok: true, data },
        latencyMs: 3,
      } as QToolCallOutcome),
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) => {
        persisted.push(input.content);
        return Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
  });
  const subject = {
    kind: "INVESTOR_ORGANISATION" as const,
    investorOrganisationId: OWN,
  };
  const request = {
    runId: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [subject],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
      subjects: [subject],
      scopes: [{ kind: "INVESTOR_MANDATE", subject }],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, persisted };
}

describe("a mandate recall is answered by code", () => {
  it("makes no dialogue call and states every declared field", async () => {
    const { seam, request, alpha, persisted } = build(
      "What is my mandate?",
      FULL,
    );
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(0);
    const text = persisted.join("\n");
    expect(text).toContain("Sectors: fintech");
    expect(text).toContain("Stages: pre seed to seed");
    expect(text).toContain("Geography: ng, gh");
    expect(text).toContain("USD 50000 to 250000, typically USD 100000");
    expect(text).toContain("Role: lead");
    expect(text).toContain("Exclusions: gambling");
  });

  it("keeps an undeclared field unknown and invents nothing", async () => {
    const { seam, request, alpha, persisted } = build("what's my mandate", {
      ...FULL,
      mandates: [
        {
          status: "DRAFT",
          stage: { minStageCode: "seed", maxStageCode: null },
          cheque: null,
          constraints: [],
          taxonomyPreferences: [],
        },
      ],
    });
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    const text = persisted.join("\n");
    expect(text).toContain("Stages: seed to not stated");
    expect(text).toContain("Sectors: not stated yet");
    expect(text).toContain("Geography: not stated yet");
    expect(text).toContain("Cheque size: not stated yet");
    expect(text).toContain("Role: not stated yet");
    expect(text).toContain("Exclusions: not stated yet");
    expect(text).toContain("still a draft");
    expect(text).not.toMatch(/\b0\b/u);
  });

  it("leaves a judgement question about the mandate to the analyst", async () => {
    const { seam, request, alpha } = build(
      "Does Yamfield Agro fit my mandate?",
      FULL,
    );
    await seam.answer(request);
    expect(alpha.calls.length).toBeGreaterThan(0);
  });
});

describe("asksForOwnMandate / ownMandateAnswer", () => {
  it("recognises plain recalls only", () => {
    expect(asksForOwnMandate("What is my mandate?")).toBe(true);
    expect(asksForOwnMandate("show me my sectors")).toBe(true);
    expect(asksForOwnMandate("should I change my mandate")).toBe(false);
    expect(asksForOwnMandate("which companies match my mandate")).toBe(false);
  });
  it("is null when nothing is declared", () => {
    expect(ownMandateAnswer({ mandates: [] })).toBeNull();
    expect(
      ownMandateAnswer({
        mandates: [{ status: "DRAFT", cheque: null, constraints: [] }],
      }),
    ).toBeNull();
  });
});

describe("a one-stage mandate (live 2026-10-10: 'seed to seed')", () => {
  it("names the stage once", () => {
    const [first] = FULL.mandates;
    const text = ownMandateAnswer({
      ...FULL,
      mandates: [
        { ...first, stage: { minStageCode: "seed", maxStageCode: "seed" } },
      ],
    });
    expect(text).toContain("Stages: seed");
    expect(text).not.toContain("seed to seed");
  });
});
