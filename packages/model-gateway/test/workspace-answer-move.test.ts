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
import { createQPageMoves } from "../src/q/navigation-decision.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * The Q Workspace (owner, 7 Nov 2026: one authority for the page pane):
 * when the model composes the answer, the page-move decision started
 * beside the turn joins the stored message. Built on the F-114 harness.
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
  before: readonly QConversationMessage[] = [],
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
    ...before,
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
  const stored: unknown[] = [];
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
      insert: (_tx: unknown, input: { content: string; blocks?: unknown }) => {
        persisted.push(input.content);
        stored.push(input.blocks ?? null);
        return Promise.resolve({
          ...messages[messages.length - 1],
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
  const pageMoves = createQPageMoves({
    decider: {
      decide: () =>
        Promise.resolve({
          decision: "MOVE",
          place: {
            route: "/work",
            record: null,
            tab: "team",
            document: null,
            slide: null,
            sectionId: null,
            position: null,
          },
          back: false,
          askedForPage: true,
          reason: "",
        }),
    },
    config: { movesAllowed: true },
  });
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    pageMoves,
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
      screen: {
        route: "HOME",
        workspace: { qPane: "open", pagePane: "open", at: "/home" },
      },
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed, persisted, stored, pageMoves };
}

describe("the Q Workspace: a model-composed answer carries the decision's move", () => {
  it("the page-move decision started beside the turn joins the stored answer", async () => {
    const { seam, request, stored, pageMoves } = build(
      "who is on Q's team for my work?",
    );
    pageMoves.start(request, {
      utterance: "who is on Q's team for my work?",
      recentTurns: [],
      pageText: null,
    });
    await seam.answer(request);
    expect(stored.flat()).toContainEqual({
      kind: "UI_INTENT",
      intent: { kind: "NAVIGATE", destination: "WORK_TEAM" },
    });
  });
});
