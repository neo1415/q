import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

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
  createModelGatewayQAnswer,
  meetingIntentOf,
  meetingVehicleDecision,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live 15 Nov 2026 (production 84ac9afa7; audit
 * docs/ai-handoff/audits/2026-11-15-meetings-through-q-live.md, D-Q3).
 * Watchly x Savanna Seed, CONNECTED, no calendar on either side.
 *
 * - Turn 1 "Set up a call with Savanna Seed next week": a chat-message
 *   card "Would Mon 16 Nov, 10:00 (Africa/Lagos) work… I'll send an
 *   invite." -- never a proposal.
 * - Turn 5 "Move the call with Savanna to Thursday afternoon": an "Update
 *   your profile: Time zone" card instead of the move.
 *
 * Replayed through the Q answer seam q-api composes: the reader's
 * askedAction decides the vehicle, never the words. Fixtures only.
 */

const LIVE_BODY =
  "Would Mon 16 Nov, 10:00 (Africa/Lagos) work for a 30-minute call about Watchly first meeting? If another time suits you better, suggest one here and I'll send an invite.";

const offered = (name: string, toolName: string): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "SIDE_EFFECT",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "WAITING_FOR_APPROVAL",
});

const OFFERED = [
  offered("propose_chat_message", "relationship.chat.propose"),
  offered("propose_meeting", "relationship.meeting.propose"),
  offered("propose_meeting_change", "relationship.meeting.change"),
  offered("find_meeting_times", "relationship.meeting.find_times"),
  offered("update_my_profile", "app.me.profile.update"),
];

const answer = (text: string) => ({
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

function build(options: {
  readonly said: string;
  readonly asked: string;
  readonly call: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TOOL_CALLS",
        calls: [{ callId: "c1", ...options.call }],
      },
      answer("Done."),
      answer("Nothing further."),
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
  const conversation = randomUUID();
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: run,
      role: "USER",
      content: options.said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as never,
  ];
  const executed: QToolProposal[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve(OFFERED),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve({
        callId: proposal.callId,
        toolName: "any",
        toolVersion: 1,
        classification: "SIDE_EFFECT",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "PUBLIC",
        result: {
          ok: true,
          data: { status: "PREPARED", awaitingApprovalOf: "A card" },
        },
        latencyMs: 1,
      } as QToolCallOutcome);
    },
  };
  const repositories: QRuntimeRepositories = {
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
  } as never;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
  });
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  const request: QAnswerRequest = {
    runId: run,
    conversationId: conversation,
    tenantId: TENANT,
    actorUserId: USER,
    actor,
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    askedAction: options.asked,
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
    },
  } as never;
  return { seam, request, executed };
}

describe("D-Q3: the meeting vehicle is chosen from the reader's askedAction", () => {
  it("turn 1's chat message on a set-up-a-call turn never reaches the tools", async () => {
    const { seam, request, executed } = build({
      said: "Set up a call with Savanna Seed next week",
      asked: "propose_meeting",
      call: {
        name: "propose_chat_message",
        arguments: { counterpartName: "Savanna Seed", body: LIVE_BODY },
      },
    });
    await seam.answer(request);
    expect(executed.map((call) => call.name)).not.toContain(
      "propose_chat_message",
    );
  });

  it("turn 5's profile time-zone card on a move-the-call turn never reaches the tools", async () => {
    const { seam, request, executed } = build({
      said: "Move the call with Savanna to Thursday afternoon",
      asked: "propose_meeting_change",
      call: {
        name: "update_my_profile",
        arguments: { timeZone: "Africa/Accra" },
      },
    });
    await seam.answer(request);
    expect(executed.map((call) => call.name)).not.toContain(
      "update_my_profile",
    );
  });

  it("the meeting vehicle itself goes through, and a message asked for stays a message", async () => {
    const move = build({
      said: "Move the call with Savanna to Thursday afternoon",
      asked: "propose_meeting_change",
      call: {
        name: "propose_meeting_change",
        arguments: { counterpartName: "Savanna Seed", change: "RESCHEDULE" },
      },
    });
    await move.seam.answer(move.request);
    expect(move.executed.map((call) => call.name)).toContain(
      "propose_meeting_change",
    );
    const message = build({
      said: "Message Savanna that we're looking forward to the call",
      asked: "propose_chat_message",
      call: {
        name: "propose_chat_message",
        arguments: {
          counterpartName: "Savanna Seed",
          body: "Looking forward to it.",
        },
      },
    });
    await message.seam.answer(message.request);
    expect(message.executed.map((call) => call.name)).toContain(
      "propose_chat_message",
    );
  });

  it("names the vehicle in the refusal: a move is never a new call", () => {
    const move = meetingIntentOf("propose_meeting_change");
    expect(move).toEqual({ kind: "MOVE", vehicle: "propose_meeting_change" });
    expect(
      meetingVehicleDecision({ name: "propose_meeting", callId: "c" }, move),
    ).toMatchObject({
      kind: "REFUSE",
      said: expect.stringContaining("Call propose_meeting_change") as unknown,
    });
    expect(meetingIntentOf("propose_chat_message")).toBeNull();
    expect(meetingIntentOf(undefined)).toBeNull();
    // Code's own follow-on calls are never refused.
    expect(
      meetingVehicleDecision(
        { name: "propose_chat_message", callId: "q-follow-on" },
        meetingIntentOf("propose_meeting"),
      ),
    ).toEqual({ kind: "CALL" });
  });
});
