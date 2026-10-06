import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@capital-q/observability";

import type {
  VoiceSessionBinding,
  VoiceSessionBindings,
} from "../src/voice/bindings.js";
import { createThinkGate } from "../src/voice/think-gate.js";
import { registerVoiceThinkRoute } from "../src/voice/think.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * L1 latency sweep (hosted 2026-10-05): 58 of 113 voice turns ended
 * INTERRUPTED; one session had 35 cancelled turns, think requests every
 * 250-500 ms, 23 of them already running model calls (44.8 s of model
 * time thrown away). A burst now settles before work starts, and the same
 * words asked again join the turn already answering them.
 */
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

describe("the think gate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a think on a quiet line at once: a normal turn pays nothing", async () => {
    const gate = createThinkGate({ now: () => 0 });
    expect(await gate.admit("line", new AbortController().signal)).toBe("NOW");
  });

  it("lets a think in a burst settle, and drops it when another follows", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const gate = createThinkGate({
      burstWindowMs: 1_500,
      settleMs: 350,
      now: () => clock,
    });
    expect(await gate.admit("line", new AbortController().signal)).toBe("NOW");
    clock = 300;
    const second = new AbortController();
    const waiting = gate.admit("line", second.signal);
    // The provider asks again 300 ms later: the route aborts the older one.
    await vi.advanceTimersByTimeAsync(300);
    second.abort();
    expect(await waiting).toBe("DROPPED");
    clock = 600;
    const third = gate.admit("line", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(350);
    expect(await third).toBe("SETTLED");
  });

  it("counts lines apart: a burst on one never delays another", async () => {
    const gate = createThinkGate({ now: () => 0 });
    await gate.admit("a", new AbortController().signal);
    expect(await gate.admit("b", new AbortController().signal)).toBe("NOW");
  });

  it("before/after: a 6-request burst, 300 ms apart, starts 6 turns without the gate and 2 with it (the first, and the last)", async () => {
    vi.useFakeTimers();
    const run = async (gated: boolean) => {
      let clock = 0;
      const gate = createThinkGate({
        // Without the gate: no burst is ever recognised.
        burstWindowMs: gated ? 1_500 : 0,
        settleMs: 350,
        now: () => clock,
      });
      let started = 0;
      let previous: AbortController | undefined;
      const admissions: Promise<void>[] = [];
      for (let index = 0; index < 6; index += 1) {
        clock = index * 300;
        previous?.abort();
        const controller = new AbortController();
        previous = controller;
        admissions.push(
          gate.admit("line", controller.signal).then((admitted) => {
            if (admitted !== "DROPPED" && !controller.signal.aborted) {
              started += 1;
            }
          }),
        );
        await vi.advanceTimersByTimeAsync(index === 5 ? 400 : 300);
      }
      await Promise.all(admissions);
      return started;
    };
    expect(await run(false)).toBe(6);
    expect(await run(true)).toBe(2);
  });
});

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: "f0000000-0000-4000-8000-000000000001",
    providerConversationId: "dg_f0000000-0000-4000-8000-000000000001",
    actor: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
    } as never,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: Number.MAX_SAFE_INTEGER,
    connectedAt: 1,
    thinkToken: "secret-think-token",
  };
}

function bindingsFor(bound: VoiceSessionBinding): VoiceSessionBindings {
  return {
    issue: () => true,
    connect: () => bound,
    get: () => bound,
    byVoiceSessionId: () => bound,
    byThinkToken: (token) => (token === bound.thinkToken ? bound : null),
    restore: (token) =>
      Promise.resolve(token === bound.thinkToken ? bound : null),
    seal: () => "sealed",
    fingerprints: () => [],
    releaseFor: () => undefined,
    release: () => undefined,
    countFor: () => 1,
    size: () => 1,
  };
}

describe("the same words asked again", () => {
  it("join the turn already answering them instead of restarting it", async () => {
    const bound = binding();
    let turns = 0;
    let release: () => void = () => undefined;
    const turn: VoiceTurnHandler = async (_b, _t, signal, speaker) => {
      turns += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (signal.aborted) return { kind: "INTERRUPTED", path: "Q" };
      await speaker.speak("The answer, once.");
      return { kind: "SPOKEN", path: "Q" };
    };
    const server = Fastify();
    registerVoiceThinkRoute(server, {
      path: "/v1/q/voice/think",
      bindings: bindingsFor(bound),
      turn,
      logger,
      gate: createThinkGate({ settleMs: 0 }),
    });
    await server.ready();
    const ask = () =>
      server.inject({
        method: "POST",
        url: "/v1/q/voice/think/chat/completions",
        headers: { authorization: "Bearer secret-think-token" },
        payload: {
          messages: [{ role: "user", content: "What is our runway?" }],
        },
      });
    const older = ask();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newer = ask();
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const [first, second] = await Promise.all([older, newer]);
    expect(turns).toBe(1);
    expect(first.body.trim().endsWith("data: [DONE]")).toBe(true);
    expect(first.body).not.toContain("The answer, once.");
    expect(second.body).toContain("The answer, once.");
    expect(second.body.trim().endsWith("data: [DONE]")).toBe(true);
    await server.close();
  });
});
