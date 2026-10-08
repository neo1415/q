import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QVoiceDuplexHeardResultSchema,
  QVoiceDuplexToolResultSchema,
  qVoiceDuplexToolPath,
} from "@capital-q/contracts";
import { createInMemoryModelUsageRepository } from "@capital-q/model-gateway";
import {
  createRealtimeVoiceGateway,
  type RealtimeSessionProvider,
} from "@capital-q/model-gateway/realtime";
import { OPENAI_REALTIME_MINI_PRICES } from "@capital-q/model-gateway/realtime/openai";
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
} from "../src/voice/duplex/broker.js";
import {
  DUPLEX_DEFAULTS,
  duplexConfigFrom,
} from "../src/voice/duplex/config.js";
import { registerDuplexVoiceRoutes } from "../src/voice/duplex/routes.js";
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
    logger,
  });
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
