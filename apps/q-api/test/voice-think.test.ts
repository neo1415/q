import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@capital-q/observability";

import type {
  VoiceSessionBinding,
  VoiceSessionBindings,
} from "../src/voice/bindings.js";
import { createDeepgramVoiceProvider } from "../src/voice/providers/deepgram.js";
import { registerVoiceThinkRoute } from "../src/voice/think.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * The Deepgram think route: the per-session bearer names the bound
 * conversation, the provider's chat-completions body becomes the turn's
 * transcript, and what Q says streams back as chat-completion chunks. A
 * request without the bearer is refused before anything runs. The
 * provider adapter composes settings whose think endpoint carries that
 * bearer and nothing of the person's Capital Q session.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function binding(thinkToken: string): VoiceSessionBinding {
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
    connectedAt: undefined,
    thinkToken,
  };
}

function fakeBindings(bound: VoiceSessionBinding): VoiceSessionBindings {
  return {
    issue: () => true,
    connect: () => {
      bound.connectedAt = 1;
      return bound;
    },
    get: () => bound,
    byVoiceSessionId: () => bound,
    byThinkToken: (token) => (token === bound.thinkToken ? bound : null),
    // The refusal path logs these, so a double without them turned the
    // 401 this test is about into a 500 and the assertion never ran.
    fingerprints: () => [bound.thinkToken?.slice(0, 8) ?? ""],
    releaseFor: () => undefined,
    release: () => undefined,
    countFor: () => 1,
    size: () => 1,
  };
}

async function app(turn: VoiceTurnHandler, bound: VoiceSessionBinding) {
  const server = Fastify();
  registerVoiceThinkRoute(server, {
    path: "/v1/q/voice/think",
    bindings: fakeBindings(bound),
    turn,
    logger,
  });
  await server.ready();
  return server;
}

describe("the think route", () => {
  it("streams what Q says as chat-completion chunks for the bound conversation", async () => {
    const bound = binding("secret-think-token");
    let seen: readonly { role: string; content: string }[] = [];
    const turn: VoiceTurnHandler = async (b, transcript, _signal, speaker) => {
      expect(b.voiceSessionId).toBe(bound.voiceSessionId);
      seen = transcript;
      await speaker.speak("Two pilots, nice.");
      await speaker.speak(
        (async function* () {
          await Promise.resolve();
          yield "Are the founders full-time?";
        })(),
      );
      return { kind: "SPOKEN", path: "INTERVIEW" };
    };
    const server = await app(turn, bound);
    const response = await server.inject({
      method: "POST",
      url: "/v1/q/voice/think/chat/completions",
      headers: { authorization: "Bearer secret-think-token" },
      payload: {
        model: "capital-q",
        stream: true,
        messages: [
          { role: "system", content: "You are Q." },
          { role: "assistant", content: "How many pilots do you have?" },
          { role: "user", content: "We have two pilots." },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(seen).toEqual([
      { role: "agent", content: "How many pilots do you have?" },
      { role: "user", content: "We have two pilots." },
    ]);
    const body = response.body;
    expect(body).toContain('"content":"Two pilots, nice. "');
    expect(body).toContain('"content":"Are the founders full-time? "');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body.trim().endsWith("data: [DONE]")).toBe(true);
    expect(bound.connectedAt).toBe(1);
    await server.close();
  });

  it("says so when a turn runs out of time, instead of leaving a beat and silence", async () => {
    // Hosted, 2026-09-22. A turn that passed six seconds got the beat
    // ("One moment."), and a turn that then passed twenty got nothing at
    // all: the deadline set the flag that suppresses a turn's late words
    // before writing its own sentence, so it suppressed itself. The
    // person was left looking at a line that had stopped.
    vi.useFakeTimers();
    try {
      const bound = binding("secret-think-token");
      const turn: VoiceTurnHandler = (_b, _t, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () =>
            resolve({ kind: "INTERRUPTED", path: "Q" }),
          );
        });
      const server = await app(turn, bound);
      const pending = server.inject({
        method: "POST",
        url: "/v1/q/voice/think",
        headers: { authorization: "Bearer secret-think-token" },
        payload: {
          model: "capital-q",
          stream: true,
          messages: [{ role: "user", content: "Zino Aviation." }],
        },
      });
      await vi.advanceTimersByTimeAsync(25_000);
      const response = await pending;
      const body = response.body;
      // No filler beat is spoken while Q works (founder, 2026-09-27).
      expect(body).not.toContain("One moment");
      // And then a sentence the person can answer, rather than nothing.
      expect(body).toContain("taking longer than I want to keep you waiting");
      expect(body.trim().endsWith("data: [DONE]")).toBe(true);
      await server.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a request without the session's bearer, before any turn runs", async () => {
    const bound = binding("secret-think-token");
    let ran = false;
    const turn: VoiceTurnHandler = () => {
      ran = true;
      return Promise.resolve({ kind: "NOTHING" });
    };
    const server = await app(turn, bound);
    const none = await server.inject({
      method: "POST",
      url: "/v1/q/voice/think",
      payload: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(none.statusCode).toBe(401);
    const wrong = await server.inject({
      method: "POST",
      url: "/v1/q/voice/think",
      headers: { authorization: "Bearer not-it" },
      payload: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(wrong.statusCode).toBe(401);
    expect(ran).toBe(false);
    await server.close();
  });
});

describe("the Deepgram provider", () => {
  it("composes settings whose think endpoint carries the session secret and the chosen voice", () => {
    const provider = createDeepgramVoiceProvider({
      apiKey: "dg-key-never-printed",
      publicUrl: "https://public.example/",
      thinkPath: "/v1/q/voice/think",
    });
    const settings = provider.settingsFor({
      voice: "MALE",
      greeting: "Hello, I'm Q.",
      thinkToken: "secret-think-token",
    });
    expect(settings.agent).toMatchObject({
      greeting: "Hello, I'm Q.",
      think: {
        endpoint: {
          url: "https://public.example/v1/q/voice/think/chat/completions",
          headers: { authorization: "Bearer secret-think-token" },
        },
      },
      speak: { provider: { model: "aura-2-orion-en" } },
    });
    expect(JSON.stringify(settings)).not.toContain("dg-key-never-printed");
    expect(settings.audio.input.sample_rate).toBe(16_000);
  });

  it("mints a short-lived browser token with the API key it never returns", async () => {
    const calls: { url: string; auth: string | null; body: unknown }[] = [];
    const fetchFake: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        auth: headers.get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Promise.resolve(
        Response.json({ access_token: "jwt-for-the-browser", expires_in: 60 }),
      );
    };
    const provider = createDeepgramVoiceProvider({
      apiKey: "dg-key-never-printed",
      publicUrl: "https://public.example",
      thinkPath: "/v1/q/voice/think",
      fetch: fetchFake,
    });
    await expect(provider.mintToken()).resolves.toBe("jwt-for-the-browser");
    expect(calls[0]?.url).toBe("https://api.deepgram.com/v1/auth/grant");
    expect(calls[0]?.auth).toBe("Token dg-key-never-printed");
    expect(calls[0]?.body).toEqual({ ttl_seconds: 60 });
  });
});
