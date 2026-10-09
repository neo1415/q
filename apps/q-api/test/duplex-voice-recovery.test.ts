import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QVoiceDuplexHeardResultSchema,
  QVoiceDuplexToolResultSchema,
  QVoiceDuplexTurnReportSchema,
  qVoiceDuplexHeardPath,
  qVoiceDuplexOutcomePath,
  qVoiceDuplexToolPath,
} from "@capital-q/contracts";
import { createInMemoryModelUsageRepository } from "@capital-q/model-gateway";
import {
  createRealtimeVoiceGateway,
  type RealtimeSessionProvider,
} from "@capital-q/model-gateway/realtime";
import {
  OPENAI_TRANSCRIBE_PRICES,
  OPENAI_REALTIME_MINI_PRICES,
  createOpenAISidebandConnector,
  type RealtimeSidebandConnector,
} from "@capital-q/model-gateway/realtime/openai";
import { createLogger } from "@capital-q/observability";
import { spokenFactsOf } from "@capital-q/q-core";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  C10B_FIT_BLOCKS,
  C10B_TURNS,
} from "../../../packages/q-core/test/fixtures/voice-c10b845f.js";
import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import {
  ASK_Q_TOO_LONG,
  createDuplexBroker,
  type DuplexBroker,
  type DuplexBrokerDependencies,
} from "../src/voice/duplex/broker.js";
import {
  DUPLEX_DEFAULTS,
  duplexConfigFrom,
} from "../src/voice/duplex/config.js";
import { duplexInstructions } from "../src/voice/duplex/instructions.js";
import { registerDuplexVoiceRoutes } from "../src/voice/duplex/routes.js";
import { routeDuplexTurn } from "../src/voice/duplex/routing.js";
import {
  createDuplexSideband,
  SIDEBAND_REATTACH_MAX,
  sidebandUsageReport,
} from "../src/voice/duplex/sideband.js";
import {
  createVoiceTurnTimings,
  timedVoiceTurns,
} from "../src/voice/turn-timing.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * RECOVERY-2026-10, workstream A: the duplex broker's turn dispositions
 * (A4), the silent tool-result contract (A1, C-01), facts through the
 * timing wrapper as composed in production (A2, C-02) and the ask_q
 * deadline (A8). No live provider call: the realtime provider is a fake.
 */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const ID = "5f000000-0000-4000-8000-000000000001";

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: ID,
    providerConversationId: `dg_${ID}`,
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

async function brokerWith(
  turn: VoiceTurnHandler,
  config: Partial<typeof DUPLEX_DEFAULTS> = {},
  extra: {
    readonly open?: boolean;
    readonly sideband?: DuplexBrokerDependencies["sideband"];
    readonly transcript?: DuplexBrokerDependencies["transcript"];
    readonly logger?: DuplexBrokerDependencies["logger"];
  } = {},
): Promise<DuplexBroker> {
  const provider: RealtimeSessionProvider = {
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
  };
  const broker = createDuplexBroker({
    config: { ...DUPLEX_DEFAULTS, enabled: true, ...config },
    gateway: createRealtimeVoiceGateway({
      provider,
      enabled: true,
      providerCeiling: "PUBLIC",
      usage: createInMemoryModelUsageRepository(),
    }),
    firewall: {
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
            actor: {
              userId: ACTOR.userId,
              organisationId: ACTOR.organisationId,
            },
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
    },
    tools: {
      offer: () => Promise.resolve([]),
      execute: () => Promise.reject(new Error("not offered")),
    },
    turn,
    spend: { spentTodayUsd: () => Promise.resolve(0) },
    logger: extra.logger ?? logger,
    ...(extra.sideband === undefined ? {} : { sideband: extra.sideband }),
    ...(extra.transcript === undefined ? {} : { transcript: extra.transcript }),
  });
  if (extra.open === false) return broker;
  const opened = await broker.open({ binding: binding() });
  expect(opened.kind).toBe("DUPLEX");
  return broker;
}

const askQ = (broker: DuplexBroker, request: string, signal?: AbortSignal) =>
  broker.tool({
    actor: ACTOR,
    voiceSessionId: ID,
    call: {
      callId: "call_1",
      name: "ask_q",
      arguments: JSON.stringify({ request }),
    },
    signal,
  });

const answeringTurn: VoiceTurnHandler = async (_b, _t, _s, speaker) => {
  await speaker.speak("Three investors fit.");
  return { kind: "SPOKEN", path: "Q" };
};

const silentTurn: VoiceTurnHandler = () => Promise.resolve({ kind: "NOTHING" });

describe("A1 (C-01): a silent ask_q the model called", () => {
  it("is a valid tool result, IGNORED", async () => {
    const broker = await brokerWith(silentTurn);
    const result = await askQ(broker, "uh, talking to my colleague");
    expect(result).toMatchObject({ silent: true, disposition: "IGNORED" });
    // The probe the audit ran, now passing.
    expect(QVoiceDuplexToolResultSchema.safeParse(result).success).toBe(true);
  });

  it("passes the /duplex/tool route's strict parse (200, not a 500)", async () => {
    const broker = await brokerWith(silentTurn);
    const server: FastifyInstance = Fastify();
    server.decorateRequest("actorContext", undefined);
    registerDuplexVoiceRoutes(server, {
      broker,
      withContext: (request, _reply, done) => {
        request.actorContext = ACTOR;
        done();
      },
    });
    await server.ready();
    const response = await server.inject({
      method: "POST",
      url: qVoiceDuplexToolPath(ID),
      payload: {
        callId: "call_1",
        name: "ask_q",
        arguments: JSON.stringify({ request: "mm, one sec" }),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      silent: true,
      disposition: "IGNORED",
    });
    await server.close();
  });

  it("the heard result carries the disposition too", async () => {
    const broker = await brokerWith(silentTurn);
    const result = await broker.heard({
      actor: ACTOR,
      voiceSessionId: ID,
      heard: { itemId: "item_1", transcript: "Find anything for my raise." },
    });
    expect(result).toMatchObject({
      route: "ASK_Q",
      silent: true,
      disposition: "IGNORED",
    });
    expect(QVoiceDuplexHeardResultSchema.safeParse(result).success).toBe(true);
  });
});

describe("A2 (C-02): facts through the timing wrapper, as composed in main.ts", () => {
  it("reaches the voice as facts, with no second rewrite", async () => {
    const facts = spokenFactsOf({
      asked: C10B_TURNS.topThree.asked,
      text: C10B_TURNS.topThree.said,
      blocks: C10B_FIT_BLOCKS,
    });
    if (facts === null) throw new Error("no facts");
    const inner = vi.fn<VoiceTurnHandler>(async (_b, _t, _s, speaker) => {
      // turn.ts fromFacts: facts to a voice that has a `facts` seam,
      // a rewrite only when it does not.
      if (speaker.facts === undefined) {
        await speaker.speak("REWRITTEN BY A SECOND MODEL CALL");
      } else {
        speaker.facts(facts);
        await speaker.speak(facts.fallback);
      }
      return { kind: "SPOKEN", path: "Q" };
    });
    const timings = createVoiceTurnTimings({ logger });
    const broker = await brokerWith(timedVoiceTurns(inner, timings));
    const result = await askQ(broker, C10B_TURNS.topThree.asked);
    const output = JSON.parse(result?.output ?? "{}") as Record<
      string,
      unknown
    >;
    expect(output).toMatchObject({
      ok: true,
      speakInYourOwnWords: true,
      example: facts.fallback,
    });
    expect(result?.output).not.toContain("REWRITTEN");
    expect(result?.disposition).toBe("ANSWERED");
  });
});

describe("A4: every ask_q ends in a disposition", () => {
  it("ANSWERED for an answer, ACTED when something waits for their yes", async () => {
    const answered = await brokerWith(async (_b, _t, _s, speaker) => {
      await speaker.speak("Three investors fit.");
      return { kind: "SPOKEN", path: "Q" };
    });
    expect((await askQ(answered, "Who fits?"))?.disposition).toBe("ANSWERED");
    const acted = await brokerWith(async (_b, _t, _s, speaker) => {
      await speaker.speak("I drafted the note to Halyard. Shall I go ahead?");
      return { kind: "SPOKEN", path: "Q" };
    });
    const result = await askQ(acted, "Draft a note to Halyard.");
    expect(result).toMatchObject({
      disposition: "ACTED",
      approvalPending: true,
    });
  });

  it("FAILED/TOOL_FAILED when the turn throws, with words to say", async () => {
    const broker = await brokerWith(() => Promise.reject(new Error("boom")));
    const result = await askQ(broker, "Who fits?");
    expect(result).toMatchObject({
      disposition: "FAILED",
      failure: "TOOL_FAILED",
    });
    expect(QVoiceDuplexToolResultSchema.safeParse(result).success).toBe(true);
  });

  it("CANCELLED when the browser let go", async () => {
    const broker = await brokerWith(
      (_b, _t, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            resolve({ kind: "INTERRUPTED", path: "Q" });
          });
        }),
    );
    const controller = new AbortController();
    const pending = askQ(broker, "Who fits?", controller.signal);
    controller.abort();
    expect((await pending)?.disposition).toBe("CANCELLED");
  });
});

describe("A8: the ask_q deadline", () => {
  it("ends a stuck turn FAILED/TIMEOUT with a spoken line, even when the turn ignores its signal", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | null = null;
      const broker = await brokerWith(
        (_b, _t, signal) => {
          seen = signal;
          // Never settles, never listens: a stuck provider call.
          return new Promise(() => undefined);
        },
        { askDeadlineMs: 8_000 },
      );
      const pending = askQ(broker, "Build me a full fundraising strategy.");
      await vi.advanceTimersByTimeAsync(8_001);
      const result = await pending;
      expect(result).toMatchObject({
        disposition: "FAILED",
        failure: "TIMEOUT",
      });
      expect(JSON.parse(result?.output ?? "{}")).toMatchObject({
        ok: false,
        error: ASK_Q_TOO_LONG,
      });
      expect((seen as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is configurable and bounded", () => {
    expect(duplexConfigFrom({}).askDeadlineMs).toBe(30_000);
    expect(
      duplexConfigFrom({ CQ_VOICE_REALTIME_ASK_DEADLINE_SECONDS: "45" })
        .askDeadlineMs,
    ).toBe(45_000);
    expect(
      duplexConfigFrom({ CQ_VOICE_REALTIME_ASK_DEADLINE_SECONDS: "9999" })
        .askDeadlineMs,
    ).toBe(30_000);
    expect(duplexConfigFrom({}).sideband).toBe(false);
  });
});

describe("A3 (C-03/B-01): the voice never answers business on its own", () => {
  const plain = { guided: false, awaitingApproval: false, cardInFocus: false };
  const card = { ...plain, cardInFocus: true };

  it.each([
    "find anything that needs my attention",
    "What does Halyard invest in?",
    "open their pitch deck",
    "how is my raise going",
    "Who else should I talk to?",
  ])("%s with a card in focus -> ASK_Q", (said) => {
    expect(routeDuplexTurn(said, card)).toBe("ASK_Q");
  });

  it.each([
    "send it",
    "send the Tensorgate one but make it warmer",
    "not now",
    "skip",
    "book Thursday at 3",
    "yes",
    "do it",
    "ignore Spheros",
  ])("%s with a card in focus -> decide_card (MODEL)", (said) => {
    expect(routeDuplexTurn(said, card)).toBe("MODEL");
  });

  it("a bare yes to a question Q asked is Q's; a greeting stays small talk", () => {
    expect(routeDuplexTurn("yes", { ...plain, answeringQ: true })).toBe(
      "ASK_Q",
    );
    expect(routeDuplexTurn("yes", plain)).toBe("SMALLTALK");
    expect(routeDuplexTurn("thanks!", plain)).toBe("SMALLTALK");
  });

  it("the broker remembers that Q asked something and routes the reply to Q", async () => {
    const turn = vi.fn<VoiceTurnHandler>(async (_b, _t, _s, speaker) => {
      await speaker.speak("Here it is.");
      return { kind: "SPOKEN", path: "Q" };
    });
    const broker = await brokerWith(turn);
    broker.said({
      actor: ACTOR,
      voiceSessionId: ID,
      said: { responseId: "resp_1", text: "Three fit. Want the detail?" },
    });
    const result = await broker.heard({
      actor: ACTOR,
      voiceSessionId: ID,
      heard: { itemId: "item_2", transcript: "Yeah." },
    });
    expect(result?.route).toBe("ASK_Q");
    expect(turn).toHaveBeenCalledTimes(1);
  });
});

describe("A11 (C-16): a line survives a deploy or restart", () => {
  const answering: VoiceTurnHandler = async (_b, _t, _s, speaker) => {
    await speaker.speak("Three investors fit.");
    return { kind: "SPOKEN", path: "Q" };
  };

  async function routesFor(
    broker: DuplexBroker,
    restore: (token: string) => VoiceSessionBinding | null,
  ) {
    const server: FastifyInstance = Fastify();
    server.decorateRequest("actorContext", undefined);
    registerDuplexVoiceRoutes(server, {
      broker,
      withContext: (request, _reply, done) => {
        request.actorContext = ACTOR;
        done();
      },
      restore: (request) => {
        const token = request.headers["x-q-voice-session"];
        return Promise.resolve(
          typeof token === "string" ? restore(token) : null,
        );
      },
    });
    await server.ready();
    return server;
  }

  it("a fresh instance adopts the line from its sealed binding and answers the turn in flight", async () => {
    // The instance that minted the line is gone; this one never saw it.
    const fresh = await brokerWith(answering, {}, { open: false });
    const server = await routesFor(fresh, (token) =>
      token === "sealed" ? binding() : null,
    );
    const response = await server.inject({
      method: "POST",
      url: qVoiceDuplexHeardPath(ID),
      headers: { "x-q-voice-session": "sealed" },
      payload: { itemId: "item_1", transcript: "Who fits my raise?" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      route: "ASK_Q",
      disposition: "ANSWERED",
    });
    expect(fresh.size()).toBe(1);
    await server.close();
  });

  it("is still not found without a token, with someone else's, or for another line", async () => {
    const fresh = await brokerWith(answering, {}, { open: false });
    const server = await routesFor(fresh, (token) =>
      token === "theirs"
        ? {
            ...binding(),
            actor: {
              ...ACTOR,
              userId: UserIdSchema.parse(
                "b0000000-0000-4000-8000-000000000009",
              ),
            },
          }
        : token === "other"
          ? { ...binding(), voiceSessionId: randomUUID() }
          : null,
    );
    for (const headers of [
      {},
      { "x-q-voice-session": "theirs" },
      { "x-q-voice-session": "other" },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: qVoiceDuplexHeardPath(ID),
        headers,
        payload: { itemId: "item_1", transcript: "Who fits my raise?" },
      });
      expect(response.statusCode).toBe(404);
    }
    expect(fresh.size()).toBe(0);
    await server.close();
  });

  it("logs each turn's disposition and timings, never words", async () => {
    const broker = await brokerWith(answering);
    const server = await routesFor(broker, () => null);
    const response = await server.inject({
      method: "POST",
      url: qVoiceDuplexOutcomePath(ID),
      payload: {
        turnId: "turn_abcdefgh01",
        disposition: "ANSWERED",
        firstAudioMs: 1_240,
        relayMs: 900,
      },
    });
    expect(response.statusCode).toBe(204);
    // Words are refused by the contract itself (strict).
    expect(
      QVoiceDuplexTurnReportSchema.safeParse({
        turnId: "turn_abcdefgh01",
        disposition: "ANSWERED",
        said: "Who fits my raise?",
      }).success,
    ).toBe(false);
    await server.close();
  });
});

describe("A8 SIDEBAND (fake socket; not verified on a live call)", () => {
  type Sent = Record<string, unknown>;
  function fakeConnector() {
    const sockets: {
      callId: string;
      sent: Sent[];
      emit: (event: unknown) => void;
      drop: () => void;
      closed: boolean;
    }[] = [];
    const connect: RealtimeSidebandConnector = (callId, handlers) => {
      const socket = {
        callId,
        sent: [] as Sent[],
        emit: handlers.onEvent,
        drop: () => {
          handlers.onClose(false);
        },
        closed: false,
      };
      sockets.push(socket);
      return Promise.resolve({
        send: (event) => {
          socket.sent.push({ ...event });
        },
        close: () => {
          socket.closed = true;
        },
      });
    };
    return { connect, sockets };
  }

  it("delivers Q's answer on the call from the server, and the browser is told", async () => {
    const fake = fakeConnector();
    const broker = await brokerWith(
      async (_b, _t, _s, speaker) => {
        await speaker.speak("Three investors fit.");
        return { kind: "SPOKEN", path: "Q" };
      },
      { sideband: true },
      {
        sideband: (onUsage) =>
          createDuplexSideband({ connect: fake.connect, logger, onUsage }),
      },
    );
    expect(
      broker.attach({ actor: ACTOR, voiceSessionId: ID, callId: "rtc_abc" }),
    ).toBe(true);
    await Promise.resolve();
    const result = await broker.heard({
      actor: ACTOR,
      voiceSessionId: ID,
      heard: { itemId: "item_1", transcript: "Who fits my raise?" },
    });
    expect(result).toMatchObject({ route: "ASK_Q", delivered: "SERVER" });
    expect(fake.sockets[0]?.sent.map((e) => e.type)).toEqual([
      "conversation.item.create",
      "conversation.item.create",
      "response.create",
    ]);
    expect(JSON.stringify(fake.sockets[0]?.sent)).toContain(
      "Three investors fit.",
    );
  });

  it("does not deliver a turn the person spoke over since it was heard", async () => {
    const fake = fakeConnector();
    let finish: () => void = () => undefined;
    const broker = await brokerWith(
      async (_b, _t, _s, speaker) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        await speaker.speak("Old answer.");
        return { kind: "SPOKEN", path: "Q" };
      },
      { sideband: true },
      {
        sideband: (onUsage) =>
          createDuplexSideband({
            connect: fake.connect,
            logger,
            onUsage,
            now: () => Date.now() + 5,
          }),
      },
    );
    broker.attach({ actor: ACTOR, voiceSessionId: ID, callId: "rtc_abc" });
    await Promise.resolve();
    const pending = broker.heard({
      actor: ACTOR,
      voiceSessionId: ID,
      heard: { itemId: "item_1", transcript: "Who fits my raise?" },
    });
    await Promise.resolve();
    fake.sockets[0]?.emit({ type: "input_audio_buffer.speech_started" });
    finish();
    const result = await pending;
    expect(result).not.toHaveProperty("delivered");
    expect(fake.sockets[0]?.sent).toEqual([]);
  });

  it("records usage from the call itself, once per response with the browser's report", async () => {
    const fake = fakeConnector();
    const seen: string[] = [];
    const broker = await brokerWith(
      answeringTurn,
      { sideband: true },
      {
        sideband: (onUsage) =>
          createDuplexSideband({
            connect: fake.connect,
            logger,
            onUsage: (id, report) => {
              seen.push(report.responseId);
              onUsage(id, report);
            },
          }),
      },
    );
    broker.attach({ actor: ACTOR, voiceSessionId: ID, callId: "rtc_abc" });
    await Promise.resolve();
    fake.sockets[0]?.emit({
      type: "response.done",
      response: {
        id: "resp_1",
        status: "completed",
        usage: { output_token_details: { audio_tokens: 400 } },
      },
    });
    fake.sockets[0]?.emit({
      type: "error",
      error: { type: "invalid_request_error", code: "x" },
    });
    expect(seen).toEqual(["resp_1"]);
    expect(
      sidebandUsageReport("resp_1", {
        output_token_details: { audio_tokens: 400 },
      }).outputAudioTokens,
    ).toBe(400);
    // The browser's report of the same response is not counted twice.
    const usage = await broker.usage({
      actor: ACTOR,
      voiceSessionId: ID,
      report: sidebandUsageReport("resp_1", {}),
    });
    expect(usage).toMatchObject({ continue: true });
  });

  it("re-attaches a dropped sideband a bounded number of times", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeConnector();
      const sideband = createDuplexSideband({
        connect: fake.connect,
        logger,
        onUsage: () => undefined,
      });
      sideband.attach(ID, "rtc_abc");
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < SIDEBAND_REATTACH_MAX + 2; i += 1) {
        fake.sockets.at(-1)?.drop();
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(fake.sockets).toHaveLength(SIDEBAND_REATTACH_MAX + 1);
      sideband.detach(ID);
      expect(sideband.attached(ID)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is never attached when the flag is off", async () => {
    const fake = fakeConnector();
    const broker = await brokerWith(
      answeringTurn,
      {},
      {
        sideband: (onUsage) =>
          createDuplexSideband({ connect: fake.connect, logger, onUsage }),
      },
    );
    broker.attach({ actor: ACTOR, voiceSessionId: ID, callId: "rtc_abc" });
    expect(fake.sockets).toHaveLength(0);
  });

  it("the OpenAI connector attaches with the server's key in a header, to the call's id, and refuses a bad id", async () => {
    const opened: { url: string; headers: Record<string, string> }[] = [];
    const listeners = new Map<string, (event: unknown) => void>();
    const connector = createOpenAISidebandConnector({
      apiKey: "disabled-locally-000000000000",
      webSocket: (url, headers) => {
        opened.push({ url, headers: { ...headers } });
        return {
          readyState: 1,
          send: () => undefined,
          close: () => undefined,
          addEventListener: (type, listener) => {
            listeners.set(type, listener);
          },
        };
      },
    });
    const events: unknown[] = [];
    const pending = connector("rtc_abc123", {
      onEvent: (event) => events.push(event),
      onClose: () => undefined,
    });
    listeners.get("open")?.({});
    await pending;
    listeners.get("message")?.({ data: '{"type":"session.updated"}' });
    expect(opened[0]?.url).toBe(
      "wss://api.openai.com/v1/realtime?call_id=rtc_abc123",
    );
    expect(opened[0]?.headers.authorization).toBe(
      "Bearer disabled-locally-000000000000",
    );
    expect(events).toEqual([{ type: "session.updated" }]);
    await expect(
      connector("https://evil.example/", {
        onEvent: () => undefined,
        onClose: () => undefined,
      }),
    ).rejects.toThrow();
  });
});

describe("A10 (C-17): natural delivery", () => {
  it("never tells the voice to read Q's words out word for word", () => {
    const text = duplexInstructions({
      firstMessage: "Hi Ada. Three investors fit your raise.",
      listening: true,
    });
    expect(text).not.toMatch(
      /word for word|say(?:ing)? exactly this|faithfully/i,
    );
    // The substance is still bound.
    expect(text).toContain("Keep every fact, figure, name and commitment");
    expect(text).toContain("Hi Ada. Three investors fit your raise.");
  });
});

describe("the transport harness prices", () => {
  it("are the gateway's own tables (the web harness keeps a copy)", () => {
    const harness = readFileSync(
      resolve(__dirname, "../../web/test/voice-transport-harness.test.ts"),
      "utf8",
    );
    const block = (name: string) =>
      harness
        .slice(harness.indexOf(`const ${name} = {`))
        .split("} as const")[0] ?? "";
    for (const [name, prices] of [
      ["HARNESS_REALTIME_PRICES", OPENAI_REALTIME_MINI_PRICES],
      ["HARNESS_TRANSCRIBE_PRICES", OPENAI_TRANSCRIBE_PRICES],
    ] as const) {
      for (const [key, value] of Object.entries(prices)) {
        expect(block(name)).toContain(`${key}: ${String(value)},`);
      }
    }
  });
});

describe("INC-1 (top three, live 2026-10-08): the server side of one turn's lifecycle", () => {
  const TURN_1 = "turn_top3aaaa01";
  const TURN_2 = "turn_rankbbbb02";

  it("offers at most one bridge per ask_q, and none once the answer is in", async () => {
    let answerReady: () => void = () => undefined;
    let finish: () => void = () => undefined;
    const broker = await brokerWith(async (_b, _t, _s, speaker) => {
      speaker.narrate?.({ kind: "STAGE_LINE", text: "Bridge 1" });
      speaker.narrate?.({ kind: "STAGE_LINE", text: "Bridge 1b" });
      await new Promise<void>((resolve) => {
        answerReady = resolve;
      });
      await speaker.speak(
        "Your top three are Halyard, Clearwater and Tensorgate.",
      );
      // The ladder keeps going while the answer is post-processed
      // (production: narration #2 and #3 after the run completed).
      speaker.narrate?.({ kind: "STAGE_LINE", text: "Bridge 2" });
      speaker.narrate?.({ kind: "PROGRESS_LINE", text: "Bridge 3" });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { kind: "SPOKEN", path: "Q" };
    });
    const pending = broker.heard({
      actor: ACTOR,
      voiceSessionId: ID,
      heard: {
        itemId: "item_1",
        transcript: "Top three companies for my mandate?",
        turnId: TURN_1,
      },
    });
    await Promise.resolve();
    const first = await broker.narration({
      actor: ACTOR,
      voiceSessionId: ID,
      after: 0,
    });
    expect(first?.beats.map((b) => b.beat)).toEqual([
      { kind: "STAGE_LINE", text: "Bridge 1" },
    ]);
    answerReady();
    await Promise.resolve();
    await Promise.resolve();
    const afterAnswer = await broker.narration({
      actor: ACTOR,
      voiceSessionId: ID,
      after: 1,
      signal: AbortSignal.abort(),
    });
    expect(afterAnswer?.beats).toEqual([]);
    finish();
    expect((await pending)?.route).toBe("ASK_Q");
  });

  it("SPOKEN only on the client's said for that turn id; a stale said is never kept", async () => {
    const kept: { role: string; content: string }[] = [];
    const info = vi.fn();
    const spyLogger = {
      ...logger,
      info,
      warn: vi.fn(),
    } as unknown as typeof logger;
    const broker = await brokerWith(
      async (_b, _t, _s, speaker) => {
        await speaker.speak(
          "Your top three are Halyard, Clearwater and Tensorgate.",
        );
        return { kind: "SPOKEN", path: "Q" };
      },
      {},
      {
        logger: spyLogger,
        transcript: {
          record: (entry) => {
            kept.push({ role: entry.role, content: entry.content });
            return Promise.resolve();
          },
          mirror: ({ messages }) => Promise.resolve(messages.length),
        },
      },
    );
    await broker.heard({
      actor: ACTOR,
      voiceSessionId: ID,
      heard: { itemId: "i1", transcript: "Top three?", turnId: TURN_1 },
    });
    // Handed over is not spoken: nothing logged as SPOKEN yet.
    expect(
      info.mock.calls.some(
        ([, message]) => message === "duplex voice turn spoken",
      ),
    ).toBe(false);
    // A newer turn opens; then the stale reply for turn 1 arrives.
    await broker.heard({
      actor: ACTOR,
      voiceSessionId: ID,
      heard: { itemId: "i2", transcript: "Rank them.", turnId: TURN_2 },
    });
    broker.said({
      actor: ACTOR,
      voiceSessionId: ID,
      said: {
        responseId: "resp_stale",
        text: "Let me find the top three, give me a moment.",
        turnId: TURN_1,
      },
    });
    expect(kept.filter((k) => k.role === "Q")).toEqual([]);
    // The current turn's answer, confirmed: SPOKEN.
    broker.said({
      actor: ACTOR,
      voiceSessionId: ID,
      said: { responseId: "resp_2", text: "Ranked.", turnId: TURN_2 },
    });
    expect(kept.filter((k) => k.role === "Q")).toEqual([
      { role: "Q", content: "Ranked." },
    ]);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: TURN_2, outcome: "SPOKEN" }),
      "duplex voice turn spoken",
    );
  });

  it("the voice turn timing says HANDED, not SPOKEN, for a deferred (duplex) speaker", async () => {
    const info = vi.fn();
    const timings = createVoiceTurnTimings({
      logger: { ...logger, info },
      graceMs: 0,
    });
    const timed = timedVoiceTurns(async (_b, _t, _s, speaker) => {
      await speaker.speak("Your top three are ready.");
      return { kind: "SPOKEN", path: "Q" };
    }, timings);
    const broker = await brokerWith(timed);
    await askQ(broker, "Top three?");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const outcomes = info.mock.calls
      .filter(([, message]) => message === "voice turn timed")
      .map(([fields]) => (fields as { outcome?: string }).outcome);
    expect(outcomes).toContain("HANDED");
    expect(outcomes).not.toContain("SPOKEN");
  });
});
