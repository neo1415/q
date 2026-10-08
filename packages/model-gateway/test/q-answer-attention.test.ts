import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  PermittedContextPlan,
  QAttentionReport,
} from "@capital-q/contracts";
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
import { createModelGatewayQAnswer } from "../src/q/index.js";
import {
  asksWhatNeedsThem,
  attentionAnswerText,
} from "../src/q/attention-answer.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * RECOVERY-2026-10 B1 (founder Scenario F; live T3 2026-10-08: "nothing is
 * waiting" while an investor's message had waited 21 hours). "Find
 * anything that needs my attention" is answered from the attention report
 * by code: every item, and every unread source named as unread.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const NOW = "2026-10-08T12:00:00.000Z";

const ATTENTION_TOOL: QOfferedTool = {
  toolName: "attention.read",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "what_needs_me",
    description: "Everything waiting on the person.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
};

const REPORT: QAttentionReport = {
  items: [
    {
      key: "msg:1",
      source: "UNANSWERED_MESSAGE",
      title: "Zino Aviation Capital is waiting for your reply",
      detail: 'They wrote: "Could you share the updated model?"',
      since: "2026-10-07T15:43:00.000Z",
      decidable: true,
    },
    {
      key: "approval:1",
      source: "APPROVAL",
      title: "Send the drafted reply to Halyard Ventures",
      since: "2026-10-08T08:00:00.000Z",
      decidable: true,
    },
  ],
  activity: null,
  unread: ["NOTICE"],
  readAt: NOW,
};

function build(scene: {
  readonly said: string;
  readonly turnKind?: string;
  readonly report?: QAttentionReport | "DENIED";
  /** C's receipt facts for the person's recent screen acts. */
  readonly receipts?: readonly string[];
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer: "Nothing is waiting for you.",
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
      content: scene.said,
      contentType: "TEXT",
      createdAt: NOW,
    } as unknown as QConversationMessage,
  ];
  const persisted: string[] = [];
  const executed: QToolProposal[] = [];
  const report = scene.report ?? REPORT;
  const tools: QToolPort = {
    offer: () => Promise.resolve([ATTENTION_TOOL]),
    execute: (proposal) => {
      executed.push(proposal);
      const denied = report === "DENIED";
      return Promise.resolve({
        callId: proposal.callId,
        toolName: "attention.read",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: denied ? "DENIED" : "SUCCEEDED",
        failureCode: denied ? "NOT_AVAILABLE" : null,
        sensitivity: denied ? null : "CONFIDENTIAL",
        result: denied
          ? {
              ok: false,
              error: { code: "NOT_AVAILABLE", message: "Not available." },
            }
          : { ok: true, data: report },
        latencyMs: 2,
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
    ...(scene.receipts === undefined
      ? {}
      : { uiActReceipts: () => scene.receipts ?? [] }),
  });
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
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    ...(scene.turnKind === undefined ? {} : { turnKind: scene.turnKind }),
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed, persisted };
}

describe("what needs them, answered from the attention report", () => {
  it("lists every item and the unread source, with no model round", async () => {
    const { seam, request, alpha, executed, persisted } = build({
      said: "find anything that needs my attention",
      turnKind: "QUESTION_TO_Q",
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => call.name)).toEqual(["what_needs_me"]);
    expect(alpha.calls).toHaveLength(0);
    const said = persisted.join("\n");
    expect(said).toContain("Zino Aviation Capital is waiting for your reply");
    expect(said).toContain("Send the drafted reply to Halyard Ventures");
    expect(said).toContain("I couldn't check your notices just now");
    expect(said).not.toMatch(/nothing is waiting/iu);
  });

  it("is not read for a request to act", async () => {
    const { seam, request, executed, alpha } = build({
      said: "find anything that needs my attention",
      turnKind: "TOOL_REQUEST",
    });
    await seam.answer(request);
    expect(executed.some((call) => call.name === "what_needs_me")).toBe(false);
    expect(alpha.calls.length).toBeGreaterThan(0);
  });

  it("leaves the turn to the analyst when the read is refused", async () => {
    const { seam, request, alpha } = build({
      said: "what's waiting for me?",
      turnKind: "QUESTION_TO_Q",
      report: "DENIED",
    });
    await seam.answer(request);
    expect(alpha.calls.length).toBeGreaterThan(0);
  });
});

describe("receipts of Q's last screen acts reach the next turn (C's request)", () => {
  it("puts the receipt facts in front of the answer model", async () => {
    const { seam, request, alpha } = build({
      said: "did the readiness tab open?",
      turnKind: "QUESTION_TO_Q",
      receipts: [
        "SELECT_TAB tab.readiness: NOT done: that control is not on their screen (TARGET_MISSING).",
      ],
    });
    await seam.answer(request);
    const sent = alpha.calls
      .flatMap((call) => call.request.messages)
      .filter((message) => message.role === "SYSTEM")
      .map((message) => message.content)
      .join("\n");
    expect(sent).toContain("WHAT YOUR RECENT SCREEN ACTS DID");
    expect(sent).toContain("tab.readiness: NOT done");
  });

  it("adds nothing when there are no receipts", async () => {
    const { seam, request, alpha } = build({
      said: "did the readiness tab open?",
      turnKind: "QUESTION_TO_Q",
      receipts: [],
    });
    await seam.answer(request);
    const sent = alpha.calls
      .flatMap((call) => call.request.messages)
      .map((message) => message.content)
      .join("\n");
    expect(sent).not.toContain("WHAT YOUR RECENT SCREEN ACTS DID");
  });
});

describe("what Q says from the report", () => {
  it("numbers every item", () => {
    const text = attentionAnswerText(REPORT);
    expect(text).toMatch(/^2 things need you:/u);
    for (const item of REPORT.items) expect(text).toContain(item.title);
  });

  it("never says nothing is waiting while a source is unread", () => {
    const text = attentionAnswerText({
      items: [],
      activity: null,
      unread: ["UNANSWERED_MESSAGE", "APPROVAL"],
      readAt: NOW,
    });
    expect(text).not.toMatch(/nothing is waiting/iu);
    expect(text).toContain(
      "I couldn't check your messages and your approvals just now",
    );
  });

  it("says nothing is waiting only when every source was read", () => {
    expect(
      attentionAnswerText({
        items: [],
        activity: null,
        unread: [],
        readAt: NOW,
      }),
    ).toMatch(/^Nothing is waiting on you right now/u);
  });

  it("says what Q did meanwhile", () => {
    expect(
      attentionAnswerText({
        ...REPORT,
        activity: {
          since: NOW,
          repliesSent: 2,
          messagesSent: 0,
          callsBooked: 1,
          interestExpressed: 0,
          draftsHeld: 1,
          jobsCompleted: 0,
          names: [],
        },
      }),
    ).toContain(
      "Meanwhile, Q and its agents: 2 replies sent, 1 call booked and 1 draft held for you.",
    );
  });
});

describe("asking what needs them", () => {
  it.each([
    "find anything that needs my attention",
    "Find anything that needs my attention",
    "what's waiting for me?",
    "Is anything waiting on me today?",
    "what did I miss",
    "anything I need to deal with?",
    "who is waiting on me",
    "catch me up",
    "what needs me",
  ])("reads %j as asking", (text) => {
    expect(asksWhatNeedsThem(text)).toBe(true);
  });

  it.each([
    "what needs to happen for the round to close?",
    "hi Q",
    "compare those two",
    "take me to the work page",
  ])("does not read %j as asking", (text) => {
    expect(asksWhatNeedsThem(text)).toBe(false);
  });
});
