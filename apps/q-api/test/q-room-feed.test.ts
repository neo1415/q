import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  Q_ROOM_PATH,
  QRoomReadSchema,
  type QStreamEvent,
} from "@capital-q/contracts";
import { createInMemoryModelUsageRepository } from "@capital-q/model-gateway";
import { createRealtimeVoiceGateway } from "@capital-q/model-gateway/realtime";
import { OPENAI_REALTIME_MINI_PRICES } from "@capital-q/model-gateway/realtime/openai";
import { createLogger } from "@capital-q/observability";
import type {
  ContextFirewallPort,
  QRunRecord,
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createQRoomFeed } from "../src/room/feed.js";
import { registerQRoomRoutes } from "../src/room/routes.js";
import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import { createDuplexBroker } from "../src/voice/duplex/broker.js";
import { DUPLEX_DEFAULTS } from "../src/voice/duplex/config.js";
import { createVoiceTurnHandler } from "../src/voice/turn.js";

/**
 * voice-cards (Zino live 2026-10-08, conversation c10b845f): a duplex
 * ask_q run stored ten answer cards and none reached the screen. The
 * server is now the single source: the run's answer is published to the
 * person's Q room the moment the run completes it, whichever path ran it.
 *
 * Here the real duplex broker runs ask_q through the real voice turn
 * handler, against a faked Q runtime and run stream (no provider, no DB);
 * the room route is read over HTTP as the person, and as a stranger.
 */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const STRANGER: ActorContext = {
  ...ACTOR,
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
};
const RUN_ID = "f0000000-0000-4000-8000-000000000020";
const CONVERSATION_ID = "f0000000-0000-4000-8000-000000000021";
const MESSAGE_ID = "f0000000-0000-4000-8000-000000000022";
const NOW = "2026-10-08T03:22:25.000Z";
const RUN = {
  id: RUN_ID,
  conversationId: CONVERSATION_ID,
  status: "RECEIVED",
} as unknown as QRunRecord;

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const card = (name: string, at: number) => ({
  key: name.toLowerCase(),
  name,
  line: null,
  hue: at + 1,
  reasons: ["Fits the stage."],
  measures: [],
  fit: { score: 8 - at, measured: 3, of: 4 },
  view: null,
  said: null,
  sourceCount: 0,
  subject: {
    kind: "COMPANY",
    companyId: `a0000000-0000-4000-8000-00000000000${String(at + 1)}`,
  },
});

const CARDS = {
  kind: "ANSWER_CARDS",
  shape: "RANKED",
  title: "Fit against your mandate",
  cards: [card("Haly", 0), card("Portside", 1), card("Tensorgate", 2)],
  followUps: [],
};

const event = (
  type: string,
  sequence: number,
  data: Record<string, unknown>,
): QStreamEvent =>
  ({
    type,
    runId: RUN_ID,
    sequence,
    occurredAt: NOW,
    data,
  }) as unknown as QStreamEvent;

const EVENTS: readonly QStreamEvent[] = [
  event("q.message.completed", 1, {
    message: {
      messageId: MESSAGE_ID,
      runId: RUN_ID,
      role: "Q",
      text: "I've scored your top 3 companies against your mandate.",
      blocks: [CARDS],
      createdAt: NOW,
    },
  }),
  event("q.run.completed", 2, { status: "COMPLETED", completedAt: NOW }),
];

function runtime(): QRuntimeService {
  return {
    createRun: () =>
      Promise.resolve({
        run: RUN,
        conversation: {} as never,
        message: {} as never,
        created: true,
      }),
    cancelRun: () =>
      Promise.resolve({ run: RUN, changed: true, summary: {} as never }),
  } as unknown as QRuntimeService;
}

function stream(): QRunStreamService {
  return {
    authorize: () => Promise.resolve(RUN),
    open: async function* (input) {
      for (const item of EVENTS) {
        if (input.signal.aborted) return;
        yield { kind: "durable" as const, event: item };
        await Promise.resolve();
      }
      yield { kind: "end" as const, reason: "TERMINAL" as const };
    },
    stats: () => ({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
      deltasDropped: 0,
    }),
  };
}

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: "5f000000-0000-4000-8000-000000000001",
    providerConversationId: "rt_5f000000-0000-4000-8000-000000000001",
    actor: ACTOR,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: 1,
    connectedAt: 0,
  };
}

function duplexLine(room: ReturnType<typeof createQRoomFeed>) {
  const firewall: ContextFirewallPort = {
    plan: (request) =>
      Promise.resolve({
        outcome: "AUTHORISED",
        plan: PermittedContextPlanSchema.parse({
          contractVersion: 1,
          policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
          planId: randomUUID(),
          fingerprint: "0".repeat(64),
          runId: request.runId,
          tenantId: ACTOR.tenantId,
          actor: { userId: ACTOR.userId, organisationId: ACTOR.organisationId },
          purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
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
      }),
  };
  const gateway = createRealtimeVoiceGateway({
    provider: {
      code: "fake",
      modelCode: "fake-realtime",
      providerId: "a1000000-0000-4000-8000-000000000003",
      modelId: "a2000000-0000-4000-8000-000000000022",
      prices: OPENAI_REALTIME_MINI_PRICES,
      mint: () =>
        Promise.resolve({
          clientSecret: "ek_fake_secret",
          expiresAt: new Date(Date.now() + 60_000),
          callsUrl: "https://realtime.invalid/v1/realtime/calls",
        }),
    },
    enabled: true,
    providerCeiling: "PUBLIC",
    usage: createInMemoryModelUsageRepository(),
  });
  // The real voice turn handler: ask_q is one spoken turn on it.
  const turn = createVoiceTurnHandler({
    qRuntime: runtime(),
    qStream: stream(),
    room,
    logger,
  });
  return createDuplexBroker({
    config: { ...DUPLEX_DEFAULTS, enabled: true, backchannel: false },
    gateway,
    firewall,
    tools: {
      offer: () => Promise.resolve([]),
      execute: () => Promise.reject(new Error("unused")),
    },
    turn,
    spend: { spentTodayUsd: () => Promise.resolve(0) },
    logger,
  });
}

async function server(
  room: ReturnType<typeof createQRoomFeed>,
  as: ActorContext,
) {
  const app = Fastify();
  registerQRoomRoutes(app, {
    authenticator: {
      authenticate: () =>
        Promise.resolve({
          authUserId: AuthUserIdSchema.parse(
            "a0000000-0000-4000-8000-000000000001",
          ),
        }),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: as }),
    },
    room,
  });
  await app.ready();
  return app;
}

const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

describe("a duplex ask_q run's blocks reach the person's room (voice-cards)", () => {
  it("publishes the run's cards, keyed by run, readable over HTTP by the person only", async () => {
    const room = createQRoomFeed();
    const broker = duplexLine(room);
    const opened = await broker.open({ binding: binding() });
    expect(opened.kind).toBe("DUPLEX");

    const result = await broker.tool({
      actor: ACTOR,
      voiceSessionId: binding().voiceSessionId,
      call: {
        callId: "call_1",
        name: "ask_q",
        arguments: JSON.stringify({
          request:
            "Show me the top three companies that are aligned against the mandate.",
        }),
      },
    });
    // What the voice model is handed is words only: the cards never ride
    // on the tool output, and the screen does not need them to.
    expect(result?.output).not.toContain("ANSWER_CARDS");

    const app = await server(room, ACTOR);
    const response = await app.inject({
      method: "GET",
      url: `${Q_ROOM_PATH}?after=0&wait=0`,
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(response.statusCode).toBe(200);
    const read = QRoomReadSchema.parse(response.json());
    expect(read.entries).toHaveLength(1);
    const [entry] = read.entries;
    expect(entry?.runId).toBe(RUN_ID);
    expect(entry?.conversationId).toBe(CONVERSATION_ID);
    expect(entry?.source).toBe("VOICE");
    expect(entry?.message.messageId).toBe(MESSAGE_ID);
    expect(entry?.message.blocks).toEqual([CARDS]);
    expect(read.cursor).toBe(1);

    // After the cursor: nothing new, at once.
    const next = await app.inject({
      method: "GET",
      url: `${Q_ROOM_PATH}?after=1&epoch=${read.epoch}&wait=0`,
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(QRoomReadSchema.parse(next.json()).entries).toEqual([]);

    // Another person's room is their own: empty.
    const stranger = await server(room, STRANGER);
    const theirs = await stranger.inject({
      method: "GET",
      url: `${Q_ROOM_PATH}?after=0&wait=0`,
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(QRoomReadSchema.parse(theirs.json()).entries).toEqual([]);
  });
});

describe("the room feed", () => {
  const message = (id: string) => ({
    messageId: id,
    runId: RUN_ID,
    role: "Q" as const,
    text: "Here.",
    createdAt: NOW,
  });

  it("wakes a held read when an answer lands, and publishes each answer once", async () => {
    const room = createQRoomFeed();
    const held = room.read({
      actor: ACTOR,
      after: 0,
      wait: true,
      holdMs: 5_000,
    });
    expect(room.watched(ACTOR)).toBe(true);
    room.publish(ACTOR, {
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      source: "VOICE",
      message: message(MESSAGE_ID) as never,
    });
    // The same answer again (the voice handler and a watcher): once.
    room.publish(ACTOR, {
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      source: "TYPED",
      message: message(MESSAGE_ID) as never,
    });
    const read = await held;
    expect(read.entries.map((entry) => entry.sequence)).toEqual([1]);
  });

  it("starts a reader from another process's epoch again from the start", async () => {
    const room = createQRoomFeed();
    room.publish(ACTOR, {
      runId: RUN_ID,
      conversationId: null,
      source: "VOICE",
      message: message(MESSAGE_ID) as never,
    });
    const read = await room.read({
      actor: ACTOR,
      after: 40,
      epoch: "another-process",
      wait: false,
    });
    expect(read.entries).toHaveLength(1);
    expect(read.epoch).toBe(room.epoch);
  });

  it("follows a typed run only while the person has a reader open", async () => {
    const room = createQRoomFeed({ qStream: stream(), logger });
    room.watchRun({ actor: ACTOR, runId: RUN_ID, conversationId: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      (await room.read({ actor: ACTOR, after: 0, wait: false })).entries,
    ).toEqual([]);
    // Now they have a reader (the last read was just now).
    room.watchRun({ actor: ACTOR, runId: RUN_ID, conversationId: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const read = await room.read({ actor: ACTOR, after: 0, wait: false });
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0]?.source).toBe("TYPED");
    expect(read.entries[0]?.conversationId).toBe(CONVERSATION_ID);
  });
});
