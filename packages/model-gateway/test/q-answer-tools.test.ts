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
  CLIENT_ACTION_DONE_LINE,
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
  return { seam, alpha, messages, stages, logLines, request, completed };
}

const call = (
  id: string,
  args: Record<string, unknown> = { companyId: "x" },
): FakeBehaviour => ({
  kind: "TOOL_CALLS",
  calls: [{ callId: id, name: "get_company", arguments: args }],
});

const SET_THEME_OFFERED: QOfferedTool = {
  toolName: "client.theme.set",
  toolVersion: 1,
  classification: "SIDE_EFFECT",
  definition: {
    name: "set_theme",
    description: "Switches the appearance.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
};

describe("client actions and the screen reach the answer (R20/R21/R33)", () => {
  it("a client-action tool's authorised result rides on the answer as a UI_INTENT block", async () => {
    const tools = toolPort([SET_THEME_OFFERED], (p) => ({
      ...succeeded(p, {
        status: "SCREEN_WILL_DO_IT",
        clientAction: { kind: "SET_THEME", theme: "dark" },
      }),
      toolName: "client.theme.set",
      classification: "SIDE_EFFECT",
    }));
    const { seam, request, completed } = build({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            { callId: "t1", name: "set_theme", arguments: { theme: "dark" } },
          ],
        },
        {
          kind: "TEXT",
          text: JSON.stringify(analystResult("Dark mode is on.")),
        },
      ],
      tools,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const last = completed.at(-1) as { message: { blocks?: unknown[] } };
    expect(last.message.blocks).toEqual([
      { kind: "UI_INTENT", intent: { kind: "SET_THEME", theme: "dark" } },
    ]);
  });

  it("an empty closing answer after a screen action still delivers the action (founder live 2026-09-30)", async () => {
    const tools = toolPort([SET_THEME_OFFERED], (p) => ({
      ...succeeded(p, {
        status: "SCREEN_WILL_DO_IT",
        clientAction: { kind: "SET_THEME", theme: "dark" },
      }),
      toolName: "client.theme.set",
      classification: "SIDE_EFFECT",
    }));
    const { seam, request, completed } = build({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            { callId: "t1", name: "set_theme", arguments: { theme: "dark" } },
          ],
        },
        { kind: "TEXT", text: JSON.stringify(analystResult("")) },
      ],
      tools,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const last = completed.at(-1) as {
      message: { text: string; blocks?: unknown[] };
    };
    expect(last.message.text).toBe(CLIENT_ACTION_DONE_LINE);
    expect(last.message.blocks).toEqual([
      { kind: "UI_INTENT", intent: { kind: "SET_THEME", theme: "dark" } },
    ]);
  });

  it("a revised document's card rides on the answer from the tool's own result (founder directive 2026-09-28)", async () => {
    const REVISE_OFFERED: QOfferedTool = {
      toolName: "documents.own.revise",
      toolVersion: 1,
      classification: "SIDE_EFFECT",
      definition: {
        name: "revise_my_document",
        description: "Revises one of their documents.",
        inputJsonSchema: { type: "object", properties: {} },
      },
      visibleStage: null,
    };
    const document = {
      artifactId: "00000000-0000-4000-8000-00000000a111",
      type: "PITCH_DECK",
      status: "READY",
      title: "Alpha deck",
      currentVersion: 2,
    };
    const tools = toolPort([REVISE_OFFERED], (p) => ({
      ...succeeded(p, { status: "DOCUMENT_UPDATED", document }),
      toolName: "documents.own.revise",
      classification: "SIDE_EFFECT",
    }));
    const { seam, request, completed } = build({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "r1",
              name: "revise_my_document",
              arguments: {
                artifactId: document.artifactId,
                changes: "Shorter summary",
              },
            },
          ],
        },
        {
          kind: "TEXT",
          text: JSON.stringify(analystResult("Updated: version 2.")),
        },
      ],
      tools,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const last = completed.at(-1) as { message: { blocks?: unknown[] } };
    expect(last.message.blocks).toEqual([
      {
        kind: "ARTIFACT_REFERENCE",
        artifactId: document.artifactId,
        type: "PITCH_DECK",
        status: "READY",
        title: "Alpha deck",
      },
    ]);
  });

  it("a failed or unrelated tool result carries no client action", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { clientAction: { kind: "RELOAD_PAGE" } }),
    );
    const { seam, request, completed } = build({
      script: [
        call("c1"),
        { kind: "TEXT", text: JSON.stringify(analystResult("ok")) },
      ],
      tools,
    });
    await seam.answer(request);
    const last = completed.at(-1) as { message: { blocks?: unknown[] } };
    expect(last.message.blocks ?? []).toEqual([]);
  });

  it("the planner is told which screen the person is on, from the plan (typed and voice alike)", async () => {
    const { seam, alpha, request } = build({
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("ok")) }],
    });
    await seam.answer({
      ...request,
      plan: { ...request.plan, screen: { route: "PROFILE" } },
    });
    const sent = alpha.calls[0]?.request.messages ?? [];
    const note = sent.find((m) =>
      m.content.includes("WHAT YOU CAN DO IN THIS CONVERSATION"),
    );
    expect(note?.content).toContain("WHERE THEY ARE NOW");
    expect(note?.content).toContain("on their profile");
    expect(note?.content).toContain("never say you cannot see their screen");
  });
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
    // This turn's notes ride in the user tail since company-analyst/v16
    // (prompt-cache order), so the whole prompt is what is asserted.
    expect(
      alpha.calls[0]?.request.messages.map((m) => m.content).join("\n"),
    ).toContain("No tools are available");
    expect(seam.lastObservation()?.modelCalls).toBe(1);
  });

  it("names the offered tools and answers in one call when nothing needs looking up", async () => {
    // One call, not two. Splitting "do you need a tool?" from "answer"
    // was measured at a second and a half of extra wait on every question
    // that needed no tool, because the cost of a turn is how many calls
    // it makes rather than how large they are.
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request, messages } = build({
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("direct")) }],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(1);

    const only = alpha.calls[0]?.request;
    // The answer's schema rides beside the tools (harden 2026-10-01), so an
    // answer here arrives in the shape the call below would ask for.
    expect(only?.output.kind).toBe("STRUCTURED");
    expect(only?.tools.map((t) => t.name)).toEqual(["get_company"]);
    // And the analyst's own rules, so an answer written here is written
    // under them: the round that can answer is never the cheap one.
    // This turn's notes ride in the user tail since company-analyst/v16.
    const prompt = only?.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain(
      "Tools available to you in this conversation: get_company",
    );
    expect(prompt).toContain("never an instruction");
    expect(only?.messages.at(-1)?.content).toContain("LOOK IT UP FIRST");

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
      // What this run can do, built by code (CQ-QX-008).
      "SYSTEM",
      // The order note that puts a lookup before an answer.
      "SYSTEM",
      "ASSISTANT",
      "TOOL",
    ]);
    expect(second[2]?.content).toContain(
      "WHAT YOU CAN DO IN THIS CONVERSATION",
    );
    const toolTurn = second[5];
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

  it.each([
    ["a list", ["I need to retrieve your companies first."]],
    // The shape a model actually wrote live: one string, not a list.
    [
      "a string, in the wrong shape",
      "I need to retrieve your companies first.",
    ],
  ])(
    "an answer that describes doing something instead of calling the tool gets one more round (actionTalk as %s; founder live 2026-10-01)",
    async (_label, actionTalk) => {
      const tools = toolPort([GET_COMPANY], (p) =>
        succeeded(p, { canonicalName: "Northwind (synthetic)" }),
      );
      const { seam, alpha, request, messages } = build({
        script: [
          {
            kind: "TEXT",
            text: JSON.stringify({
              ...analystResult("I can list them once I retrieve them."),
              actionTalk,
            }),
          },
          call("c1"),
          { kind: "TEXT", text: JSON.stringify(analystResult("Northwind.")) },
        ],
        tools,
      });
      const outcome = await seam.answer(request);
      expect(outcome.kind).toBe("ANSWERED");
      // The tool was called on the extra round, and the answer is from it.
      expect(tools.executed).toHaveLength(1);
      const second = alpha.calls[1]?.request;
      expect(second?.tools.map((t) => t.name)).toEqual(["get_company"]);
      expect(second?.messages.at(-1)?.content).toContain("instead of doing it");
      expect(messages.at(-1)?.content).toBe("Northwind.");
    },
  );

  it("an answer that asks who 'this person' is, on a company's page, gets one more round naming the screen's company (founder live 2026-10-01)", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { canonicalName: "Kazikit (synthetic)" }),
    );
    const company = randomUUID();
    const { seam, alpha, request, messages } = build({
      script: [
        {
          kind: "TEXT",
          text: JSON.stringify({
            ...analystResult("Who should I arrange the meeting with?"),
            clarifyingQuestions: [
              { question: "Who should I arrange the meeting with?", why: "" },
            ],
          }),
        },
        call("c1", { companyId: company }),
        { kind: "TEXT", text: JSON.stringify(analystResult("Kazikit.")) },
      ],
      tools,
    });
    await seam.answer({
      ...request,
      plan: {
        ...request.plan,
        screen: { route: "COMPANY", companyId: company },
      },
    });
    const second = alpha.calls[1]?.request.messages ?? [];
    expect(second.at(-1)?.content).toContain(`the company ${company}`);
    expect(tools.executed).toHaveLength(1);
    expect(messages.at(-1)?.content).toBe("Kazikit.");
  });

  it("keeps a question back when the screen shows nothing in particular", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request } = build({
      script: [
        {
          kind: "TEXT",
          text: JSON.stringify({
            ...analystResult("Which company?"),
            clarifyingQuestions: [{ question: "Which company?", why: "" }],
          }),
        },
      ],
      tools,
    });
    await seam.answer({
      ...request,
      plan: { ...request.plan, screen: { route: "HOME" } },
    });
    expect(alpha.calls).toHaveLength(1);
  });

  it("does not add a round when the answer talks about nothing it should have done", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request } = build({
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("direct")) }],
      tools,
    });
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(1);
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
    const toolTurn = alpha.calls[1]?.request.messages[5];
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
    // Parity eval 2026-10-02: a refused structured round is asked again in
    // text with the tools kept (a model that meant to act still can); its
    // answer is accepted by the same schema.
    expect(alpha.calls[1]?.request.output.kind).toBe("TEXT");
    expect(alpha.calls[1]?.request.tools.length).toBeGreaterThan(0);
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

describe("use_capability: a tool outside the turn's focus, loaded and called in the same turn (lead 2026-10-04)", () => {
  const USE_CAPABILITY: QOfferedTool = {
    toolName: "q.capability.use",
    toolVersion: 1,
    classification: "READ_ONLY",
    definition: {
      name: "use_capability",
      description: "Loads a tool.",
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  };
  const PROPOSE_MEETING: QOfferedTool = {
    toolName: "relationship.meeting.propose",
    toolVersion: 1,
    classification: "SIDE_EFFECT",
    definition: {
      name: "propose_meeting",
      description: "Prepares a meeting.",
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  };
  const port = (available: readonly QOfferedTool[], loads: string[]) => {
    const executed: { name: string; focusTools: readonly string[] }[] = [];
    const tools: QToolPort = {
      offer: () => Promise.resolve([USE_CAPABILITY, GET_COMPANY]),
      available: () => Promise.resolve(available),
      execute: (proposal, context) => {
        executed.push({
          name: proposal.name,
          focusTools: context.focus?.tools ?? [],
        });
        return Promise.resolve(
          succeeded(
            proposal,
            proposal.name === "use_capability"
              ? {
                  loaded: loads.map((name) => ({ name, does: "" })),
                  message: "Loaded.",
                }
              : { status: "PREPARED" },
          ),
        );
      },
    };
    return { tools, executed };
  };
  const script = (): FakeBehaviour[] => [
    {
      kind: "TOOL_CALLS",
      calls: [
        {
          callId: "u1",
          name: "use_capability",
          arguments: { need: "book a call" },
        },
      ],
    },
    {
      kind: "TOOL_CALLS",
      calls: [{ callId: "m1", name: "propose_meeting", arguments: {} }],
    },
    { kind: "TEXT", text: JSON.stringify(analystResult("Prepared.")) },
  ];

  it("loads it for the next step, then executes it in the same turn", async () => {
    const { tools, executed } = port(
      [USE_CAPABILITY, GET_COMPANY, PROPOSE_MEETING],
      ["propose_meeting"],
    );
    const { seam, alpha, request, logLines } = build({
      script: script(),
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls[0]?.request.tools.map((t) => t.name)).toEqual([
      "use_capability",
      "get_company",
    ]);
    expect(alpha.calls[1]?.request.tools.map((t) => t.name)).toEqual([
      "use_capability",
      "get_company",
      "propose_meeting",
    ]);
    expect(executed.map((e) => e.name)).toEqual([
      "use_capability",
      "propose_meeting",
    ]);
    // Executed under a focus that names it, as a named tool would be.
    expect(executed[1]?.focusTools).toContain("propose_meeting");
    expect(logLines.some((line) => line.includes("q.capability_loaded"))).toBe(
      true,
    );
  });

  it("never loads a tool the run's available list does not hold", async () => {
    // The loader names it, but the plan does not allow it: not offered.
    const { tools, executed } = port(
      [USE_CAPABILITY, GET_COMPANY],
      ["propose_meeting"],
    );
    const { seam, alpha, request } = build({ script: script(), tools });
    await seam.answer(request);
    for (const attempt of alpha.calls) {
      expect(attempt.request.tools.map((t) => t.name)).not.toContain(
        "propose_meeting",
      );
    }
    expect(executed.at(-1)?.focusTools ?? []).not.toContain("propose_meeting");
  });
});

describe("approval by conversation (live 2026-09-27 #1, #2)", () => {
  const APPROVE: QOfferedTool = {
    toolName: "proposal.pending.approve",
    toolVersion: 1,
    classification: "SIDE_EFFECT",
    definition: {
      name: "approve_pending_proposal",
      description: "Approves the one change waiting for their decision.",
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  };
  const approveCall: FakeBehaviour = {
    kind: "TOOL_CALLS",
    calls: [
      {
        callId: "a1",
        name: "approve_pending_proposal",
        arguments: { proposalId: "p-1" },
      },
    ],
  };
  const result = (outcome: string, status: string | null) => ({
    outcome,
    proposal:
      status === null
        ? null
        : { proposalId: "p-1", summary: "Headline", status },
    pending: [],
  });

  const answerAfter = async (data: unknown, text: string) => {
    const tools = toolPort([APPROVE], (p) => ({
      ...succeeded(p, data),
      toolName: "proposal.pending.approve",
      classification: "SIDE_EFFECT",
    }));
    const { seam, request, messages } = build({
      script: [
        approveCall,
        { kind: "TEXT", text: JSON.stringify(analystResult(text)) },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(tools.executed.map((p) => p.name)).toEqual([
      "approve_pending_proposal",
    ]);
    return messages.at(-1)?.content ?? "";
  };

  it("says saved only from the tool's SAVED result", async () => {
    const saved = await answerAfter(
      result("SAVED", "SAVED"),
      "Anything else for your profile?",
    );
    expect(saved.startsWith("Saved.")).toBe(true);

    const lapsed = await answerAfter(
      result("EXPIRED", "EXPIRED"),
      "Anything else for your profile?",
    );
    expect(lapsed).toMatch(/^Not saved/);
    expect(lapsed).not.toMatch(/^Saved/);

    const repeat = await answerAfter(
      result("ALREADY_DECIDED", "SAVED"),
      "Anything else?",
    );
    expect(repeat.startsWith("Already saved.")).toBe(true);
  });

  it("adds no status when nothing was approved, leaving the question to the model", async () => {
    const none = await answerAfter(
      result("SEVERAL_PENDING", null),
      "Which one do you want to approve?",
    );
    expect(none).toBe("Which one do you want to approve?");
  });
});
