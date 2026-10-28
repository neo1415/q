import { randomUUID } from "node:crypto";

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
  type ModelCatalogSnapshot,
} from "@capital-q/model-gateway";
import { createModelGatewayQAnswer } from "@capital-q/model-gateway/q";

/**
 * One Q turn end to end through the answer seam with fake models and a
 * fake tool port (no network, no database): what the model says is
 * scripted; what the tools return is the world. The test asserts on the
 * stored Q message and its blocks, as the browser would read them.
 */

export const TENANT = "33333333-3333-4333-8333-333333333333";
export const USER = "44444444-4444-4444-8444-444444444444";
export const COMPANY = "61000000-0000-4000-8000-000000000001";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const MODEL = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const EPOCH = "2026-01-01T00:00:00.000Z";

function catalog(): ModelCatalogSnapshot {
  const taskClasses = [
    "NORMAL_DIALOGUE",
    "FAST_CLASSIFICATION",
    "DEEP_INVESTIGATION",
    "STRUCTURED_EXTRACTION",
  ] as const;
  return {
    providers: [
      {
        id: ALPHA,
        code: "alpha",
        name: "Alpha (reviewed)",
        status: "ACTIVE",
        privacyPolicyClass: "NO_TRAINING_ZERO_RETENTION",
        supportsZeroRetention: true,
        regionSupport: ["global"],
      },
    ],
    models: [
      {
        id: MODEL,
        providerId: ALPHA,
        modelCode: "alpha-standard",
        modelFamily: "test",
        modelType: "TEXT_GENERATION",
        status: "ACTIVE",
        contextWindow: 200_000,
        maxOutputTokens: 16_384,
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsVision: false,
        supportsAudio: false,
        supportsRealtime: false,
        supportsPromptCache: false,
        supportsReasoning: false,
        sensitivityCeiling: "CONFIDENTIAL",
        qualityClass: "HIGH",
        latencyClass: "FAST",
        effectiveFrom: EPOCH,
        effectiveTo: null,
      },
    ],
    prices: [
      {
        id: randomUUID(),
        modelId: MODEL,
        pricingRegion: "global",
        currency: "USD",
        inputPerMillion: 1,
        cachedInputPerMillion: null,
        outputPerMillion: 4,
        effectiveFrom: EPOCH,
        effectiveTo: null,
      },
    ],
    routingPolicies: taskClasses.map((taskClass, index) => ({
      id: `d${String(index + 1)}d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1`,
      code: `${taskClass.toLowerCase()}.v1`,
      taskClass,
      sensitivityClass: "RESTRICTED",
      qualityFloor: "BASIC",
      latencyTargetMs: null,
      costCeilingUsd: null,
      preferredModels: [MODEL],
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 1,
    })),
    loadedAt: EPOCH,
  };
}

export const offered = (
  name: string,
  toolName: string,
  classification: QOfferedTool["classification"] = "READ_ONLY",
): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification,
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_COMPANY",
});

export const answer = (text: string) => ({
  kind: "JSON" as const,
  value: {
    answer: text,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
  },
});

export const toolCalls = (
  calls: readonly {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }[],
) => ({
  kind: "TOOL_CALLS" as const,
  calls: calls.map((call, index) => ({
    callId: `c${String(index)}`,
    name: call.name,
    arguments: call.arguments,
  })),
});

export const ok = (
  proposal: QToolProposal,
  toolName: string,
  data: unknown,
): QToolCallOutcome => ({
  callId: proposal.callId,
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "CONFIDENTIAL",
  result: { ok: true, data },
  latencyMs: 1,
});

export const refused = (
  proposal: QToolProposal,
  toolName: string,
): QToolCallOutcome =>
  ({
    callId: proposal.callId,
    toolName,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "DENIED",
    failureCode: "NOT_AVAILABLE",
    sensitivity: "CONFIDENTIAL",
    result: { ok: false, failureCode: "NOT_AVAILABLE" },
    latencyMs: 1,
  }) as unknown as QToolCallOutcome;

export type Stored = {
  readonly content: string;
  readonly blocks?: readonly { readonly kind: string }[] | undefined;
};

export function buildTurn(input: {
  readonly said: string;
  readonly script: readonly (
    ReturnType<typeof answer> | ReturnType<typeof toolCalls>
  )[];
  readonly offered: readonly QOfferedTool[];
  readonly world: (proposal: QToolProposal) => QToolCallOutcome | null;
  /** A founder's own company (default); null for no company. */
  readonly ownCompany?: boolean | undefined;
  readonly reading?: Partial<QAnswerRequest> | undefined;
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [...input.script, answer("Nothing further.")],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog()),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const run = randomUUID();
  const conversation = randomUUID();
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: run,
      role: "USER",
      content: input.said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as never,
  ];
  const executed: QToolProposal[] = [];
  const stored: Stored[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([...input.offered]),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve(
        input.world(proposal) ?? refused(proposal, proposal.name),
      );
    },
  };
  const repositories: QRuntimeRepositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, row: Stored) => {
        stored.push(row);
        return Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: row.content,
        } as QConversationMessage);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as never;
  const ownCompany = input.ownCompany !== false;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    parallelExtras: true,
    ...(ownCompany
      ? {
          ownCompanySnapshot: () =>
            Promise.resolve({
              companyId: COMPANY,
              name: "Ajopot",
              shortDescription: "Digital savings circles for gig workers.",
              stageCode: "seed",
              countryCode: "NG",
            }),
        }
      : {}),
  });
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  const request: QAnswerRequest = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor,
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: run,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      screen: { route: "HOME" },
      scopes: [
        { kind: "OWN_Q_CONVERSATION" },
        ...(ownCompany
          ? [{ kind: "COMPANY_PROFILE", companyId: COMPANY }]
          : []),
      ],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
    },
    ...(input.reading ?? {}),
  } as never;
  return { seam, request, alpha, executed, stored };
}

/** The Q message the turn stored last, with its blocks by kind. */
export function last(stored: readonly Stored[]): {
  readonly content: string;
  readonly kinds: readonly string[];
  readonly blocks: readonly { readonly kind: string }[];
} {
  const final = stored.at(-1);
  if (final === undefined) throw new Error("no Q message stored");
  const blocks = final.blocks ?? [];
  return { content: final.content, kinds: blocks.map((b) => b.kind), blocks };
}
