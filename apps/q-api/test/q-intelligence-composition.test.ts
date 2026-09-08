import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type ModelGatewayRequestInput,
  type ModelGatewayResult,
  type PermittedContextPlan,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { noAuthorisedContext } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { composeQIntelligence } from "../src/composition/q-intelligence.js";

/**
 * The C5 finding, as an executable regression (CQ-C5-R1 §6-§10, §57).
 *
 * C5 failed because every Wave-5 capability was real and composed nowhere:
 * `apps/q-api` wired `createUnconfiguredQRetrieval()` and gave the answer
 * seam no context port, so a production question reached the model with
 * zero authorised facts and a prompt that said retrieval was not
 * implemented. Nothing in the repository could notice — every layer's own
 * tests passed, because every layer was correct.
 *
 * These tests hold the composition itself, which is the thing that was
 * missing. They use fakes for the model gateway, the tool registry and the
 * run repositories, and a plan whose scope set is empty, so no database is
 * touched: what is under test is which implementations the composition root
 * hands to the orchestrator, not what those implementations do with a row.
 *
 * The tell for each wiring is chosen so it cannot pass by accident:
 *
 *   retrieval   an unconfigured port answers NOT_CONFIGURED and can answer
 *               nothing else; the real one answers AUTHORISED_REFERENCES.
 *   context     `noAuthorisedContext` describes the subject as "retrieval
 *               is not implemented yet"; the evidence context describes it
 *               as source documents. The words reach the prompt.
 *   specialist  the specialist reads canonical state by EXECUTING
 *               get_company deterministically. The conversational path only
 *               ever OFFERS tools to a model. Execution without a model
 *               proposal is the specialist's signature.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const COMPANY = "e0000000-0000-4000-8000-000000000009";

function plan(subjects: readonly QSubjectRef[] = []): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects,
    // Empty on purpose: a plan that authorises no chunk-backed scope is a
    // real production case (canonical state only) and needs no database.
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

const RUN = randomUUID();
const CONVERSATION = randomUUID();

const COMPANY_SUBJECT = {
  kind: "COMPANY",
  companyId: COMPANY,
} as unknown as QSubjectRef;

const INVESTOR_SUBJECT = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: "e0000000-0000-4000-8000-00000000000a",
} as unknown as QSubjectRef;

/** The analyst result both seams validate against. */
function analystResult(answer: string) {
  return {
    answer,
    responseShape: "ANALYTICAL",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
    companyFindings: [],
    coverage: [],
    materialChanges: [],
  };
}

function fakeGateway(answer = "Here is what the recorded evidence supports.") {
  const requests: ModelGatewayRequestInput[] = [];
  const gateway: ModelGateway = {
    execute: <T>(request: ModelGatewayRequestInput) => {
      requests.push(request);
      return Promise.resolve({
        providerCode: "fake",
        modelCode: "fake/deterministic",
        taskClass: "NORMAL_DIALOGUE",
        routingPolicyCode: "normal_dialogue",
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 40 },
        latencyMs: 1,
        finish: "STOP",
        cost: { currency: "USD", amount: 0 },
        attempts: [
          {
            providerCode: "fake",
            modelCode: "fake/deterministic",
            attempt: 1,
            outcome: "SUCCESS",
            latencyMs: 1,
          },
        ],
        fallbackUsed: false,
        route: {
          routingPolicyCode: "normal_dialogue",
          routingPolicyVersion: 1,
          candidates: [],
          selectedCandidateIndex: 0,
          fallbackUsed: false,
        },
        completedAt: new Date().toISOString(),
        output: { kind: "STRUCTURED", value: analystResult(answer) as T },
      } as unknown as ModelGatewayResult<T>);
    },
  };
  /** Every word sent to a provider for the last call, flattened. */
  const promptText = (): string =>
    requests
      .flatMap((request) =>
        (request.messages as readonly { content?: unknown }[]).map((message) =>
          typeof message.content === "string" ? message.content : "",
        ),
      )
      .join("\n");
  return { gateway, requests, promptText };
}

function fakeTools() {
  const executed: QToolProposal[] = [];
  let offers = 0;
  const port: QToolPort = {
    offer: () => {
      offers += 1;
      return Promise.resolve([
        {
          toolName: "get_company",
          toolVersion: 1,
          classification: "SAFE_READ",
          definition: {
            name: "get_company",
            description: "Read canonical company state.",
            parameters: { type: "object", properties: {} },
          },
          visibleStage: null,
        },
      ] as never);
    },
    execute: (proposal: QToolProposal): Promise<QToolCallOutcome> => {
      executed.push(proposal);
      return Promise.resolve({
        callId: proposal.callId,
        toolName: "get_company",
        toolVersion: 1,
        classification: "SAFE_READ",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "PUBLIC",
        result: {
          ok: true,
          data: {
            canonicalName: "Northstar",
            shortDescription: null,
            primaryDescription: "B2B infrastructure software.",
            currentStageCode: "SEED",
            headquartersCountry: "NG",
            headquartersCity: null,
            foundedDate: null,
            websiteUrl: null,
          },
        },
        latencyMs: 1,
      } as unknown as QToolCallOutcome);
    },
  };
  return { port, executed, offerCount: () => offers };
}

function fakeRepositories(userMessage: string) {
  const stored: QConversationMessage[] = [];
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: userMessage,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ] as unknown as QConversationMessage[];
  return {
    stored,
    repositories: {
      messages: {
        listForRun: () => Promise.resolve([...messages]),
        insert: (_tx: unknown, input: { role: string; content: string }) => {
          const message = {
            ...messages[0],
            id: randomUUID(),
            role: input.role,
            content: input.content,
          } as QConversationMessage;
          stored.push(message);
          return Promise.resolve(message);
        },
        findById: () => Promise.resolve(null),
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
  };
}

function build(options: {
  readonly userMessage: string;
  readonly subjects?: readonly QSubjectRef[];
  readonly withEmbeddings?: boolean;
}) {
  const gateway = fakeGateway();
  const tools = fakeTools();
  const repositories = fakeRepositories(options.userMessage);
  const subjects = options.subjects ?? [];
  const composition = composeQIntelligence({
    // No query reaches these: the plan authorises no chunk-backed scope.
    sql: {} as never,
    transactions: {
      run: (work: (tx: never) => unknown) => work({} as never),
    } as never,
    repositories: repositories.repositories,
    tools: tools.port,
    gateway: gateway.gateway,
    ...(options.withEmbeddings === true
      ? {
          embeddings: {
            embed: () => Promise.reject(new Error("unused")),
          } as never,
        }
      : {}),
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
    subjects,
    retrieval: { kind: "AUTHORISED_REFERENCES", referenceCount: 0 },
    plan: plan(subjects),
  };
  return { composition, gateway, tools, repositories, request };
}

describe("C5R1-001 · production Q retrieval is composed, not unconfigured", () => {
  it("answers with an authorised reference count where the old wiring answered NOT_CONFIGURED", async () => {
    const { composition, request } = build({
      userMessage: "Analyse Northstar.",
    });
    const outcome = await composition.retrieval.retrieve(request, request.plan);
    // The exact regression C5 found. `createUnconfiguredQRetrieval` has one
    // branch and it returns NOT_CONFIGURED; reaching this line means the
    // real RAG-004 seam is behind the port.
    expect(outcome.kind).toBe("AUTHORISED_REFERENCES");
    if (outcome.kind !== "AUTHORISED_REFERENCES") {
      return;
    }
    // A plan authorising no chunk-backed scope reaches no document, and the
    // seam establishes that honestly without querying anything.
    expect(outcome.referenceCount).toBe(0);
  });

  it("reports what the composition can do", () => {
    const without = build({ userMessage: "hello" }).composition.capabilities;
    expect(without).toMatchObject({
      authorisedRetrieval: true,
      knowledgeQuery: true,
      companyIntelligence: true,
      semanticRetrieval: false,
    });
    const withEmbeddings = build({
      userMessage: "hello",
      withEmbeddings: true,
    }).composition.capabilities;
    expect(withEmbeddings.semanticRetrieval).toBe(true);
  });
});

describe("C5R1-002 · the answer seam holds the real authorised context port", () => {
  it("does not tell the model that retrieval is unimplemented", async () => {
    const { composition, gateway, request } = build({
      userMessage: "What did we agree with the investor?",
      subjects: [INVESTOR_SUBJECT],
    });
    const outcome = await composition.answer.answer(request);
    expect(outcome.kind).toBe("ANSWERED");

    const prompt = gateway.promptText();
    // `noAuthorisedContext` is the wiring C5 found, and this sentence is
    // its own. Its presence would mean the context port was never supplied.
    expect(prompt).not.toContain("retrieval is not implemented yet");
    // The evidence context's own wording for a plan that reaches no
    // documents: honest about having none, and not about being unbuilt.
    expect(prompt).toContain("no authorised source documents are available");
  });

  it("keeps the two descriptions distinguishable, so this test cannot rot", async () => {
    // If the fallback's wording ever changed to match the real seam's, the
    // assertion above would pass on a broken composition. Pin both.
    const fallback = await noAuthorisedContext.assemble({} as never);
    expect(fallback.subjectDescription).toContain(
      "retrieval is not implemented yet",
    );
    expect(fallback.subjectDescription).not.toContain(
      "no authorised source documents are available",
    );
  });
});

describe("C5R1-003 · Company Intelligence is composed behind the same seam", () => {
  it("reads canonical state deterministically for a company question", async () => {
    const { composition, tools, repositories, request } = build({
      userMessage: "Analyse Northstar.",
      subjects: [COMPANY_SUBJECT],
    });
    const outcome = await composition.answer.answer(request);
    expect(outcome.kind).toBe("ANSWERED");

    // The specialist calls get_company itself, before the model is asked
    // anything. The conversational path never executes a tool the model did
    // not propose — and this fake model proposes none.
    expect(tools.executed.map((call) => call.name)).toContain("get_company");
    expect(repositories.stored).toHaveLength(1);
    expect(repositories.stored[0]?.role).toBe("Q");
  });

  it("leaves a request it does not support to the conversational path", async () => {
    const { composition, tools, request } = build({
      userMessage: "What did we agree with the investor?",
      subjects: [INVESTOR_SUBJECT],
    });
    const outcome = await composition.answer.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    // Tools were offered to the model, and none was executed: the
    // specialist declined this subject and never ran.
    expect(tools.offerCount()).toBeGreaterThan(0);
    expect(tools.executed).toHaveLength(0);
  });
});
