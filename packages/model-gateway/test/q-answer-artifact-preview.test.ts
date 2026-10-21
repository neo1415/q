import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { CompanyAnalystResult } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationMessage,
  QLiveDelta,
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
import {
  createModelGatewayQAnswer,
  type QAuthorisedContextPort,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Artifacts live (owner 2026-10-20): the card for what Q is saying comes up
 * with the sentence that names it. Through the real answer seam, over the
 * fake provider and a scripted tool port: the subject preview rides in the
 * same live frame as the first sentence naming a company this run read,
 * never later, never for a name no tool returned, and never again for a
 * name already announced.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();

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

const GET_COMPANY: QOfferedTool = {
  toolName: "company.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "get_company",
    description: "Returns a company profile.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_COMPANY",
};

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

type ToolScript = (proposal: QToolProposal) => QToolCallOutcome;

function toolPort(
  offered: readonly QOfferedTool[],
  script: ToolScript,
): QToolPort & { readonly executed: QToolProposal[] } {
  const executed: QToolProposal[] = [];
  return {
    executed,
    offer: () => Promise.resolve(offered),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve(script(proposal));
    },
  };
}

function succeeded(proposal: QToolProposal, data: unknown): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName: "company.get",
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "PUBLIC",
    result: { ok: true, data },
    latencyMs: 3,
  };
}

function build(options: {
  readonly script: readonly FakeBehaviour[];
  readonly tools?: QToolPort | undefined;
  readonly context?: QAuthorisedContextPort | undefined;
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
      content: "Tell me about my company.",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ];
  const stages: string[] = [];
  const published: QLiveDelta[] = [];
  const completed: unknown[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      // The seam reads the conversation, not the run; the fake has one
      // conversation, so both return the same thing.
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
    runs: { allocateEventSequence: () => Promise.resolve(stages.length + 1) },
    runEvents: {
      // Stages only: the durable q.message.completed the seam now appends
      // (CQ-Q-009) carries no visible stage.
      append: (
        _tx: unknown,
        input: {
          visibleStage: string | null;
          eventType?: string;
          payload?: unknown;
        },
      ) => {
        if (input.eventType === "q.message.completed") {
          completed.push(input.payload);
        }
        if (input.visibleStage !== null) {
          stages.push(input.visibleStage);
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const logLines: string[] = [];
  const logger = {
    debug: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    info: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    warn: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    error: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    child: () => logger,
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: options.tools,
    deltas: {
      publish: (delta) => {
        published.push(delta);
      },
      subscribe: () => () => undefined,
      subscriberCount: () => 1,
    },
    ...(options.context === undefined ? {} : { context: options.context }),
    logger,
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
  return {
    seam,
    alpha,
    messages,
    stages,
    logLines,
    request,
    completed,
    published,
  };
}

const BARIDI = randomUUID();
const MEDTRAIL = randomUUID();

function profile(companyId: string, canonicalName: string) {
  return {
    companyId,
    canonicalName,
    legalName: null,
    websiteUrl: null,
    foundedDate: null,
    headquartersCountry: "KE",
    headquartersCity: null,
    currentStageCode: "SEED",
    shortDescription: "Declared company profile",
    primaryDescription: null,
    companyStatus: "active",
    relationToYou: "SHARED",
    truthClass: "USER_CLAIM",
  };
}

function reads() {
  return toolPort([GET_COMPANY], (p) =>
    succeeded(
      p,
      p.callId === "baridi"
        ? profile(BARIDI, "Baridi Health Ltd")
        : profile(MEDTRAIL, "MedTrail"),
    ),
  );
}

async function answered(text: string, question: string) {
  const built = build({
    tools: reads(),
    script: [
      {
        kind: "TOOL_CALLS",
        calls: [
          {
            callId: "baridi",
            name: "get_company",
            arguments: { companyId: BARIDI },
          },
          {
            callId: "medtrail",
            name: "get_company",
            arguments: { companyId: MEDTRAIL },
          },
        ],
      },
      { kind: "TEXT", text: JSON.stringify(analystResult(text)) },
    ],
  });
  if (built.messages[0]) {
    built.messages.splice(0, 1, { ...built.messages[0], content: question });
  }
  await built.seam.answer(built.request);
  return built.published;
}

describe("artifacts live: the card comes up with the sentence that names it", () => {
  it("sends the subject in the same frame as the first sentence naming it", async () => {
    const published = await answered(
      "Here is what stands out today. Baridi Health is the stronger of the two on traction. MedTrail is earlier. That is the short version.",
      "What do you make of them?",
    );
    const sentences = published.filter((d) => d.text.trim().length > 0);
    const naming = sentences.find((d) => d.text.includes("Baridi Health"));
    expect(naming?.preview?.subjects.map((one) => one.name)).toEqual([
      "Baridi Health Ltd",
    ]);
    expect(naming?.preview?.subjects[0]?.subject).toEqual({
      kind: "COMPANY",
      companyId: BARIDI,
    });
    // The sentence before named nobody: no preview rode with it.
    expect(sentences[0]?.preview).toBeUndefined();
    // The next named subject is added, in the order named.
    const second = sentences.find((d) => d.text.includes("MedTrail is"));
    expect(second?.preview?.subjects.map((one) => one.name)).toEqual([
      "Baridi Health Ltd",
      "MedTrail",
    ]);
    expect(second?.preview?.layout).toBe("CARDS");
    // Never announced twice: no later frame carries a preview.
    const after = published.slice(published.indexOf(second as QLiveDelta) + 1);
    expect(after.every((d) => d.preview === undefined)).toBe(true);
  });

  it("puts both columns of a comparison the person asked for up with Q's first words", async () => {
    const published = await answered(
      "Both are seed stage. The difference is traction. One more thing to check.",
      "Compare Baridi Health and MedTrail",
    );
    const first = published.find((d) => d.text.trim().length > 0);
    expect(first?.preview?.layout).toBe("TABLE");
    expect(first?.preview?.subjects.map((one) => one.name)).toEqual([
      "Baridi Health Ltd",
      "MedTrail",
    ]);
  });

  it("never announces a name no tool of this run returned", async () => {
    const published = await answered(
      "Paystack is not one of them. Flutterwave neither. That is all.",
      "What about Paystack?",
    );
    expect(published.every((d) => d.preview === undefined)).toBe(true);
  });
});
