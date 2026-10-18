import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { CompanyAnalystResult } from "@capital-q/q-core";
import {
  QSpeculationCancelledError,
  type QAnswerRequest,
  type QConversationMessage,
  type QOfferedTool,
  type QRuntimeRepositories,
  type QToolCallOutcome,
  type QToolPort,
  type QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type FakeBehaviour,
  type ModelGateway,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Voice speculation in the answer seam (latency2): an answer started
 * before its turn was read is held. Nothing of it is heard, stored or done
 * until it is adopted; cancelled, nothing of it ever is. Only READ_ONLY
 * tools run while it waits.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();

function analyst(answer: string): CompanyAnalystResult {
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

function offered(
  name: string,
  classification: QOfferedTool["classification"],
): QOfferedTool {
  return {
    toolName: `test.${name}`,
    toolVersion: 1,
    classification,
    definition: {
      name,
      description: `${name}.`,
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  };
}

const READ = offered("get_company", "READ_ONLY");
const CHANGE = offered("set_theme", "SIDE_EFFECT");

function tools(): QToolPort & { readonly executed: string[] } {
  const executed: string[] = [];
  return {
    executed,
    offer: () => Promise.resolve([READ, CHANGE]),
    execute: (proposal: QToolProposal): Promise<QToolCallOutcome> => {
      executed.push(proposal.name);
      return Promise.resolve({
        callId: proposal.callId,
        toolName: null,
        toolVersion: 1,
        classification:
          proposal.name === "set_theme" ? "SIDE_EFFECT" : "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "PUBLIC",
        result: { ok: true, data: {} },
        latencyMs: 1,
      });
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function build(script: readonly FakeBehaviour[], port?: QToolPort) {
  const alpha = createFakeModelProvider({ code: "alpha", script });
  const inner = createModelGateway({
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
  // Calls the model has finished, so a test can wait for the model rather
  // than for time.
  const finished: number[] = [];
  const waiters: (() => void)[] = [];
  const gateway: ModelGateway = {
    execute: async (request, options) => {
      const result = await inner.execute(request, options);
      finished.push(1);
      for (const wake of waiters.splice(0)) wake();
      return result;
    },
  };
  const modelCalls = async (count: number) => {
    while (finished.length < count) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    // Let the answer reach whatever it waits on next.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  const message: QConversationMessage = {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: RUN as QConversationMessage["runId"],
    role: "USER",
    content: "How should I think about my seed round?",
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  };
  const inserted: string[] = [];
  const events: string[] = [];
  const published: string[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([message]),
      listRecentForConversationOfRun: () => Promise.resolve([message]),
      insert: (_tx: unknown, input: { content: string }) => {
        inserted.push(input.content);
        return Promise.resolve({
          ...message,
          id: randomUUID(),
          role: "Q",
          content: input.content,
        });
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(events.length + 1) },
    runEvents: {
      append: (_tx: unknown, input: { eventType: string }) => {
        events.push(input.eventType);
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    deltas: {
      publish: (delta) => {
        published.push(delta.text);
      },
      subscribe: () => () => undefined,
      subscriberCount: () => 1,
    },
    ...(port === undefined ? {} : { tools: port }),
  });
  const decision = deferred<boolean>();
  const runId = RUN as QAnswerRequest["runId"];
  const request: QAnswerRequest = {
    runId,
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
    plan: PermittedContextPlanSchema.parse({
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
    }),
    speculation: { decided: decision.promise },
  };
  return {
    seam,
    request,
    decision,
    modelCalls,
    inserted,
    events,
    published,
  };
}

const ANSWER = analyst(
  "Raise for eighteen months of runway. Price it on milestones you can show.",
);

describe("a speculative answer in the answer seam (latency2)", () => {
  it("is held while the turn is read: nothing heard, nothing stored", async () => {
    const run = build([{ kind: "JSON", value: ANSWER }]);
    const answering = run.seam.answer(run.request);
    await run.modelCalls(1);
    expect(run.published).toEqual([]);
    expect(run.inserted).toEqual([]);
    expect(run.events).toEqual([]);
    run.decision.resolve(true);
    expect((await answering).kind).toBe("ANSWERED");
  });

  it("adopted: its held sentences go out in order, then it is stored", async () => {
    const run = build([{ kind: "JSON", value: ANSWER }]);
    const answering = run.seam.answer(run.request);
    await run.modelCalls(1);
    run.decision.resolve(true);
    expect((await answering).kind).toBe("ANSWERED");
    expect(run.published.join("")).toContain(
      "Raise for eighteen months of runway.",
    );
    expect(run.inserted).toHaveLength(1);
    expect(run.events).toContain("q.message.completed");
  });

  it("cancelled: nothing of it is ever heard or stored", async () => {
    const run = build([{ kind: "JSON", value: ANSWER }]);
    const answering = run.seam.answer(run.request);
    await run.modelCalls(1);
    run.decision.resolve(false);
    await expect(answering).rejects.toBeInstanceOf(QSpeculationCancelledError);
    expect(run.published).toEqual([]);
    expect(run.inserted).toEqual([]);
    expect(run.events).toEqual([]);
  });

  it("runs a READ_ONLY tool at once and holds a side-effect tool until adoption", async () => {
    const port = tools();
    const run = build(
      [
        {
          kind: "TOOL_CALLS",
          calls: [
            { callId: "r1", name: "get_company", arguments: {} },
            { callId: "w1", name: "set_theme", arguments: {} },
          ],
        },
        { kind: "TEXT", text: JSON.stringify(analyst("Dark mode is on.")) },
      ],
      port,
    );
    const answering = run.seam.answer(run.request);
    await run.modelCalls(1);
    expect(port.executed).toEqual(["get_company"]);
    run.decision.resolve(true);
    expect((await answering).kind).toBe("ANSWERED");
    expect(port.executed).toEqual(["get_company", "set_theme"]);
  });

  it("cancelled while a side-effect tool waits: the tool never runs", async () => {
    const port = tools();
    const run = build(
      [
        {
          kind: "TOOL_CALLS",
          calls: [{ callId: "w1", name: "set_theme", arguments: {} }],
        },
        { kind: "TEXT", text: JSON.stringify(analyst("Dark mode is on.")) },
      ],
      port,
    );
    const answering = run.seam.answer(run.request);
    await run.modelCalls(1);
    run.decision.resolve(false);
    await expect(answering).rejects.toBeInstanceOf(QSpeculationCancelledError);
    expect(port.executed).toEqual([]);
    expect(run.inserted).toEqual([]);
    expect(run.published).toEqual([]);
  });
});
