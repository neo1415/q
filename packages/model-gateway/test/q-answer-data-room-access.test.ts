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
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import {
  asksWhoCanSeeDataRoom,
  dataRoomAccessStatement,
} from "../src/q/data-room-access.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * QA F-28 (23 Oct 2026, run b89976d0): "Who can see my data room right
 * now?" came back as "access settings aren't available": the model never
 * read them. Read by code, as the asker, through read_my (access and
 * requests), and answered from it. Fake model; no provider.
 */

const ACCESS = {
  kind: "access",
  available: true,
  items: [
    {
      id: "d1",
      title: "Pitch deck",
      status: "Public: investors who can find your company can open it",
      at: null,
      facts: { folder: "Company", sharedWith: null, openedBy: 3 },
    },
    {
      id: "d2",
      title: "Financial model",
      status: "On request",
      at: null,
      facts: {
        folder: "Financials",
        sharedWith: "Savanna Seed Partners (view, until 2026-11-22)",
        openedBy: 1,
      },
    },
  ],
};
const REQUESTS = {
  kind: "requests",
  available: true,
  items: [
    {
      id: "r1",
      title: "Customer contracts",
      status: "waiting for your answer",
      at: null,
      facts: { kind: "document request", from: "Zino Aviation" },
    },
  ],
};

describe("who can see their data room", () => {
  it("knows the question, and leaves a change to its own path", () => {
    for (const asked of [
      "Who can see my data room right now?",
      "Which investors have access to my documents?",
      "who has my financial model?",
      "What are the access settings on my data room?",
    ]) {
      expect(asksWhoCanSeeDataRoom(asked)).toBe(true);
    }
    expect(asksWhoCanSeeDataRoom("Make my deck private")).toBe(false);
    expect(asksWhoCanSeeDataRoom("Who can see Ledgerfold's data room?")).toBe(
      false,
    );
  });

  it("states each document's level, who has it and who asked", () => {
    const statement = dataRoomAccessStatement(ACCESS, REQUESTS) ?? "";
    expect(statement).toContain("2 documents");
    expect(statement).toContain("- Pitch deck: Public");
    expect(statement).toContain("not shared with any investor");
    expect(statement).toContain(
      "shared with Savanna Seed Partners (view, until 2026-11-22)",
    );
    expect(statement).toContain(
      "Zino Aviation asked for Customer contracts: waiting for your answer",
    );
    expect(statement).toContain("offer to change a document's level");
  });

  it("an empty room is said as empty; an unavailable read adds nothing", () => {
    expect(
      dataRoomAccessStatement({ available: true, items: [] }, null),
    ).toContain("holds no documents yet");
    expect(dataRoomAccessStatement({ available: false, items: [] }, null)).toBe(
      null,
    );
  });

  it("is read before the model is asked, and the answer is spoken from it", async () => {
    const alpha = createFakeModelProvider({
      code: "alpha",
      script: [
        {
          kind: "JSON",
          value: {
            answer:
              "Your pitch deck is public; Savanna Seed Partners can view your financial model until 22 November.",
            responseShape: "CONCISE",
            findings: [],
            missingEvidence: [],
            contradictions: [],
            insufficientEvidence: false,
            recommendation: null,
            clarifyingQuestions: [],
            declined: false,
          },
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
    const run = randomUUID();
    const messages = [
      {
        id: randomUUID(),
        tenantId: TENANT,
        conversationId: randomUUID(),
        runId: run,
        role: "USER",
        content: "Who can see my data room right now?",
        contentType: "TEXT",
        createdAt: new Date().toISOString(),
      },
    ] as unknown as QConversationMessage[];
    const actor = ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    });
    const executed: QToolProposal[] = [];
    const offered = {
      toolName: "app.own.read",
      toolVersion: 1,
      classification: "READ_ONLY",
      definition: {
        name: "read_my",
        description: "read_my",
        inputJsonSchema: { type: "object", properties: {} },
      },
      visibleStage: null,
    } as unknown as QOfferedTool;
    const tools: QToolPort = {
      offer: () => Promise.resolve([offered]),
      execute: (proposal) => {
        executed.push(proposal);
        const kind: unknown = Reflect.get(proposal.arguments as object, "kind");
        return Promise.resolve({
          callId: proposal.callId,
          toolName: "app.own.read",
          toolVersion: 1,
          classification: "READ_ONLY",
          status: "SUCCEEDED",
          failureCode: null,
          sensitivity: "CONFIDENTIAL",
          result: { ok: true, data: kind === "access" ? ACCESS : REQUESTS },
          latencyMs: 1,
        } as QToolCallOutcome);
      },
    };
    const repositories = {
      messages: {
        listForRun: () => Promise.resolve([...messages]),
        listRecentForConversationOfRun: () => Promise.resolve([...messages]),
        insert: (_tx: unknown, input: { content: string }) =>
          Promise.resolve({
            ...messages[0],
            id: randomUUID(),
            role: "Q",
            content: input.content,
          } as QConversationMessage),
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
    const outcome = await seam.answer({
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
        scopes: [{ kind: "OWN_Q_CONVERSATION" }],
        denied: [],
        maxSensitivity: "PUBLIC",
      } as unknown as PermittedContextPlan,
    } as unknown as QAnswerRequest);
    expect(outcome.kind).toBe("ANSWERED");
    expect(
      executed
        .filter((call) => call.callId.startsWith("q-data-room-"))
        .map((call) => call.arguments),
    ).toEqual(
      expect.arrayContaining([{ kind: "access" }, { kind: "requests" }]),
    );
    const sent = alpha.calls
      .flatMap((call) => call.request.messages.map((m) => m.content))
      .join("\n");
    expect(sent).toContain("WHO CAN SEE THEIR DATA ROOM");
    expect(sent).toContain("Savanna Seed Partners (view, until 2026-11-22)");
  });
});
