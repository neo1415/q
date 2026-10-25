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
import { discoverFilterDecision } from "../src/q/discover-filter-rule.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * QA F-99 (24 Oct 2026): "How is my pitch video doing, and how can I make
 * it better?" was answered "your pitch video's performance isn't on
 * record" with no transcript read. A founder's own pitch is now read by
 * code and the review rests on what they say in it.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();

const FILTERS_TOOL: QOfferedTool = {
  toolName: "client.discover_filters.set",
  toolVersion: 1,
  classification: "CLIENT_ACTION",
  definition: {
    name: "set_discover_filters",
    description: "Sets the filters on their Discover feed.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "PREPARING_ANALYSIS",
} as unknown as QOfferedTool;

const analystText = (answer: string) => ({
  kind: "TEXT" as const,
  text: JSON.stringify({
    answer,
    responseShape: "CONCISE",
    insufficientEvidence: false,
  }),
});

/**
 * QA F-114 (25 Oct 2026, savanna-seed): "Only fintech ones in Kenya or
 * Nigeria that are raising now." set Discover's filters with Verified,
 * Has pitch video and Raise shared added, and matched no company.
 */
function build(
  said: string,
  script: Parameters<typeof createFakeModelProvider>[0]["script"] = [
    analystText(
      "Your opening names the kiosks by 0:06; lead with the litre price.",
    ),
  ],
) {
  const alpha = createFakeModelProvider({ code: "alpha", script });
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
  const executed: { name: string; arguments: unknown }[] = [];
  const persisted: string[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([FILTERS_TOOL]),
    execute: (proposal) => {
      executed.push({ name: proposal.name, arguments: proposal.arguments });
      return Promise.resolve({
        callId: proposal.callId,
        toolName: "client.discover_filters.set",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "NETWORK_VISIBLE",
        result: { ok: true, data: { kind: "SET_DISCOVER_FILTERS" } },
        latencyMs: 3,
      } as QToolCallOutcome);
    },
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
  const subject = { kind: "COMPANY" as const, companyId: COMPANY };
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
      scopes: [{ kind: "COMPANY_PROFILE", subject }],
      denied: [],
      maxSensitivity: "NETWORK_VISIBLE",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed, persisted };
}

describe("QA F-114: a Discover filter carries only what they stated", () => {
  it("the tool port drops verified, pitch and shared-raise qualifiers the model added", async () => {
    const { seam, request, executed } = build(
      "Show only fintech companies in Kenya or Nigeria on Discover",
      [
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "filters",
              name: "set_discover_filters",
              arguments: {
                sectors: ["fintech"],
                countries: ["KE", "NG"],
                verifiedOnly: true,
                hasPitch: true,
                raiseDisclosedOnly: true,
              },
            },
          ],
        },
        analystText(
          "Discover now shows fintech companies in Kenya and Nigeria.",
        ),
      ],
    );
    await seam.answer(request);
    const call = executed.find((one) => one.name === "set_discover_filters");
    expect(call?.arguments).toEqual({
      sectors: ["fintech"],
      countries: ["KE", "NG"],
    });
  });
});

describe("discoverFilterDecision", () => {
  const read = {
    sectors: ["fintech"],
    countries: ["ke", "ng"],
    stages: [],
    raising: true,
  };

  it("refuses to change Discover for a narrowing they did not ask to see there", () => {
    const decision = discoverFilterDecision(
      { sectors: ["fintech"], verifiedOnly: true },
      { discover: read, narrowing: true, asked: false },
    );
    expect(decision.kind).toBe("REFUSE");
  });

  it("on Discover, sets the reader's sectors and countries and adds no qualifier", () => {
    const decision = discoverFilterDecision(
      {
        sectors: ["banking"],
        countries: ["GH"],
        verifiedOnly: true,
        hasPitch: true,
        raiseDisclosedOnly: true,
        raiseMin: 100000,
        raiseCurrency: "USD",
      },
      { discover: read, narrowing: true, asked: true },
    );
    expect(decision).toEqual({
      kind: "SET",
      arguments: {
        sectors: ["fintech"],
        countries: ["KE", "NG"],
        raiseMin: 100000,
        raiseCurrency: "USD",
      },
    });
  });

  // Coordinator 2026-10-25: a narrowing they state is theirs, like a
  // sector or a country; only one the model added is dropped.
  it("'only verified fintechs in Kenya' keeps verifiedOnly; the unstated pitch qualifier goes", () => {
    const decision = discoverFilterDecision(
      { sectors: ["fintech"], countries: ["KE"], hasPitch: true },
      {
        discover: {
          sectors: ["fintech"],
          countries: ["ke"],
          stages: [],
          verifiedOnly: true,
        },
        narrowing: false,
        asked: true,
      },
    );
    expect(decision).toEqual({
      kind: "SET",
      arguments: {
        sectors: ["fintech"],
        countries: ["KE"],
        verifiedOnly: true,
      },
    });
  });

  it("keeps a stated pitch-video or shared-raise narrowing too", () => {
    const decision = discoverFilterDecision(
      {},
      {
        discover: {
          sectors: [],
          countries: [],
          stages: [],
          hasPitch: true,
          raiseShared: true,
        },
        narrowing: false,
        asked: true,
      },
    );
    expect(decision).toEqual({
      kind: "SET",
      arguments: { hasPitch: true, raiseDisclosedOnly: true },
    });
  });

  it("with no reading, keeps the model's stated filters and still adds no qualifier", () => {
    expect(
      discoverFilterDecision(
        { sectors: ["fintech"], hasPitch: true },
        undefined,
      ),
    ).toEqual({ kind: "SET", arguments: { sectors: ["fintech"] } });
  });
});
