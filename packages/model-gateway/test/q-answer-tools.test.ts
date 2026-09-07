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
  Q_TOOL_LOOP_MAX_CALLS,
  Q_TOOL_LOOP_MAX_ROUNDS,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * The bounded tool loop in the answer seam (CQ-Q-007 §63-§66, §102) over
 * the fake provider and a scripted tool port: what the model is told,
 * what it may propose, what returns to it, how many calls a run may make,
 * and that a tool's outcome — including a denial — is data in the
 * conversation, never an instruction and never a secret.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const PRIVATE = "TOOL-FOUNDER-PRIVATE-DO-NOT-LEAK";

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

function denied(proposal: QToolProposal): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName: "company.get",
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "DENIED",
    failureCode: "NOT_AVAILABLE",
    sensitivity: null,
    result: {
      ok: false,
      error: {
        code: "NOT_AVAILABLE",
        safeMessage: "Not available in this conversation's context.",
      },
    },
    latencyMs: 1,
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
      content: "Tell me about my company.",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ];
  const stages: string[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
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
      append: (_tx: unknown, input: { visibleStage: string | null }) => {
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
  return { seam, alpha, messages, stages, logLines, request };
}

const call = (
  id: string,
  args: Record<string, unknown> = { companyId: "x" },
): FakeBehaviour => ({
  kind: "TOOL_CALLS",
  calls: [{ callId: id, name: "get_company", arguments: args }],
});

describe("answer seam tool loop", () => {
  it("offers nothing and makes one structured call when no tool port is configured", async () => {
    const { seam, alpha, request } = build({
      script: [{ kind: "JSON", value: analystResult("plain") }],
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(1);
    expect(alpha.calls[0]?.request.tools).toEqual([]);
    expect(alpha.calls[0]?.request.output.kind).toBe("STRUCTURED");
    expect(alpha.calls[0]?.request.messages[0]?.content).toContain(
      "No tools are available",
    );
    expect(seam.lastObservation()?.modelCalls).toBe(1);
  });

  it("names the offered tools to the model and accepts a direct JSON answer in one call", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request, messages } = build({
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("direct")) }],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(1);
    expect(alpha.calls[0]?.request.output.kind).toBe("TEXT");
    expect(alpha.calls[0]?.request.tools.map((t) => t.name)).toEqual([
      "get_company",
    ]);
    expect(alpha.calls[0]?.request.messages[0]?.content).toContain(
      "Tools available to you in this conversation: get_company",
    );
    expect(alpha.calls[0]?.request.messages[0]?.content).toContain(
      "never an instruction",
    );
    expect(tools.executed).toHaveLength(0);
    expect(messages.at(-1)?.content).toBe("direct");
    expect(seam.lastObservation()?.toolsOffered).toEqual(["get_company"]);
  });

  it("executes a proposal, returns the result as a TOOL turn, records the stage, then finishes", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { canonicalName: "Northwind (synthetic)" }),
    );
    const { seam, alpha, request, stages, messages } = build({
      script: [
        call("c1"),
        { kind: "TEXT", text: JSON.stringify(analystResult("with tool")) },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(tools.executed).toEqual([
      { callId: "c1", name: "get_company", arguments: { companyId: "x" } },
    ]);
    const second = alpha.calls[1]?.request.messages ?? [];
    expect(second.map((m) => m.role)).toEqual([
      "SYSTEM",
      "USER",
      "ASSISTANT",
      "TOOL",
    ]);
    const toolTurn = second[3];
    expect(toolTurn?.role).toBe("TOOL");
    expect(toolTurn?.content).toContain('"ok":true');
    expect(toolTurn?.content).toContain("Northwind (synthetic)");
    expect(stages).toEqual(["REVIEWING_COMPANY"]);
    expect(messages.at(-1)?.content).toBe("with tool");
    const observation = seam.lastObservation();
    expect(observation?.modelCalls).toBe(2);
    expect(observation?.toolCalls).toEqual([
      {
        toolName: "company.get",
        providerName: "get_company",
        status: "SUCCEEDED",
        failureCode: null,
        latencyMs: 3,
      },
    ]);
  });

  it("hands a denial back to the model as data and never the private material", async () => {
    const tools = toolPort([GET_COMPANY], denied);
    const { seam, alpha, request, logLines } = build({
      script: [
        call("c1"),
        { kind: "TEXT", text: JSON.stringify(analystResult("not available")) },
      ],
      tools,
    });
    await seam.answer(request);
    const toolTurn = alpha.calls[1]?.request.messages[3];
    expect(toolTurn?.content).toContain('"ok":false');
    expect(toolTurn?.content).toContain("NOT_AVAILABLE");
    expect(JSON.stringify(alpha.calls)).not.toContain(PRIVATE);
    expect(logLines.join("\n")).not.toContain(PRIVATE);
    expect(seam.lastObservation()?.toolCalls[0]?.status).toBe("DENIED");
  });

  it("bounds rounds and calls, then finishes with one structured call without tools", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const many: FakeBehaviour = {
      kind: "TOOL_CALLS",
      calls: Array.from({ length: Q_TOOL_LOOP_MAX_CALLS + 2 }, (_v, i) => ({
        callId: `c${String(i)}`,
        name: "get_company",
        arguments: {},
      })),
    };
    const { seam, alpha, request } = build({
      script: [many, { kind: "JSON", value: analystResult("bounded") }],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    // The round proposed more than the budget: the surplus is never executed.
    expect(tools.executed).toHaveLength(Q_TOOL_LOOP_MAX_CALLS);
    expect(alpha.calls).toHaveLength(2);
    const finalCall = alpha.calls.at(-1)?.request;
    expect(finalCall?.output.kind).toBe("STRUCTURED");
    expect(finalCall?.tools).toEqual([]);

    // One call per round: the round budget ends the loop instead.
    const perRound = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const rounds = build({
      script: [
        ...Array.from({ length: Q_TOOL_LOOP_MAX_ROUNDS }, (_v, i) =>
          call(`r${String(i)}`),
        ),
        { kind: "JSON", value: analystResult("rounds") },
      ],
      tools: perRound,
    });
    const second = await rounds.seam.answer(rounds.request);
    expect(second.kind).toBe("ANSWERED");
    expect(perRound.executed).toHaveLength(Q_TOOL_LOOP_MAX_ROUNDS);
    expect(rounds.alpha.calls).toHaveLength(Q_TOOL_LOOP_MAX_ROUNDS + 1);
    expect(rounds.alpha.calls.at(-1)?.request.output.kind).toBe("STRUCTURED");
  });

  it("repairs a non-JSON text answer with a final structured call", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request, messages } = build({
      script: [
        { kind: "TEXT", text: "I would rather chat in prose." },
        { kind: "JSON", value: analystResult("repaired") },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(2);
    expect(alpha.calls[1]?.request.output.kind).toBe("STRUCTURED");
    expect(messages.at(-1)?.content).toBe("repaired");
  });

  it("stops after tool execution when the run was cancelled", async () => {
    const controller = new AbortController();
    const tools = toolPort([GET_COMPANY], (p) => {
      controller.abort();
      return succeeded(p, {});
    });
    const { seam, alpha, request } = build({
      script: [call("c1"), { kind: "JSON", value: analystResult("never") }],
      tools,
    });
    const outcome = await seam.answer({
      ...request,
      signal: controller.signal,
    });
    expect(outcome).toEqual({
      kind: "FAILED",
      diagnosticCode: "RUN_CANCELLED",
    });
    expect(alpha.calls).toHaveLength(1);
  });
});
