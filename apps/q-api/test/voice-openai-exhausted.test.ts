import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { Q_VOICE_SESSIONS_PATH } from "@capital-q/contracts";
import type { ProviderHealthPort } from "@capital-q/model-gateway";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createVoiceSessionBindings } from "../src/voice/bindings.js";
import type { DuplexBroker } from "../src/voice/duplex/broker.js";
import type { LiveBroker } from "../src/voice/live/broker.js";
import { Q_VOICE_LIVE_AVAILABLE_PATH } from "../src/voice/live/contracts.js";
import type { RealtimeVoiceProvider } from "../src/voice/provider.js";
import { watchProviderAccounts } from "../src/voice/provider-accounts.js";
import { createDeepgramVoiceProvider } from "../src/voice/providers/deepgram.js";
import { registerQVoiceRoutes } from "../src/voice/routes.js";

/**
 * DECISIONS 68 (owner, 6 Nov 2026): when the OpenAI account is out, voice
 * falls back to ElevenLabs -- speech in and out by the ElevenLabs Speech
 * Engine, every answer from Q's own turn path (the Model Gateway, on
 * Claude) -- and no OpenAI line (GPT-Live, duplex) is offered. When the
 * gateway's probe succeeds again, new lines take the normal path. No live
 * provider call: every transport here is a fake.
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
const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

function innerHealth(): ProviderHealthPort & {
  readonly failures: unknown[][];
  readonly successes: unknown[][];
} {
  const failures: unknown[][] = [];
  const successes: unknown[][] = [];
  return {
    failures,
    successes,
    state: () => "HEALTHY",
    recordFailure: (...args: unknown[]) => {
      failures.push(args);
    },
    recordSuccess: (...args: unknown[]) => {
      successes.push(args);
    },
  };
}

describe("the OpenAI account, as the gateway's health records it", () => {
  it("is out after an exhausted refusal, back on the probe's success, and still the gateway's health", () => {
    const inner = innerHealth();
    const accounts = watchProviderAccounts(inner);
    const at = new Date("2026-11-06T19:00:00Z");
    expect(accounts.exhausted("openai", at)).toBe(false);
    accounts.health.recordFailure(
      "openai",
      "gpt-5.4",
      "PERMANENT",
      at,
      120,
      true,
    );
    expect(accounts.exhausted("openai", at)).toBe(true);
    // Another provider is not touched.
    expect(accounts.exhausted("anthropic", at)).toBe(false);
    // The gateway's own health is told everything, unchanged.
    expect(inner.failures).toHaveLength(1);
    // The 30-second probe succeeds: OpenAI is back.
    accounts.health.recordSuccess(
      "openai",
      "gpt-5.4",
      new Date(at.getTime() + 30_000),
    );
    expect(accounts.exhausted("openai", at)).toBe(false);
    expect(inner.successes).toHaveLength(1);
  });

  it("is back when the account answers at all, and lapses like the gateway's block", () => {
    const at = new Date("2026-11-06T19:00:00Z");
    const accounts = watchProviderAccounts(innerHealth(), {
      openForMs: 600_000,
    });
    accounts.health.recordFailure("openai", "m", "PERMANENT", at, 1, true);
    accounts.health.recordFailure("openai", "m", "RATE_LIMIT", at);
    expect(accounts.exhausted("openai", at)).toBe(false);
    accounts.health.recordFailure("openai", "m", "PERMANENT", at, 1, true);
    // A plain outage says nothing about the account.
    accounts.health.recordFailure("openai", "m", "TEMPORARY", at);
    expect(accounts.exhausted("openai", at)).toBe(true);
    expect(accounts.exhausted("openai", new Date(at.getTime() + 600_001))).toBe(
      false,
    );
  });
});

function speechEngine(): RealtimeVoiceProvider & {
  readonly createSession: ReturnType<typeof vi.fn>;
} {
  return {
    name: "fake-speech-engine",
    voices: ["FEMALE", "MALE"],
    createSession: vi.fn(() =>
      Promise.resolve({ token: "el_token", providerConversationId: "el_conv" }),
    ),
    attach: () => Promise.resolve({ close: () => Promise.resolve() }),
  };
}

function duplexBroker(): DuplexBroker & {
  readonly open: ReturnType<typeof vi.fn>;
} {
  return {
    enabled: true,
    open: vi.fn(() =>
      Promise.resolve({
        kind: "DUPLEX" as const,
        credential: {
          clientSecret: "ek_fake_secret",
          callsUrl: "https://realtime.invalid/v1/realtime/calls",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxSessionMs: 600_000,
          idleMs: 30_000,
        },
      }),
    ),
    tool: () => Promise.resolve(null),
    usage: () => Promise.resolve(null),
    rejoin: () => Promise.resolve(null),
    narration: () => Promise.resolve(null),
    end: () => false,
    size: () => 0,
    heard: () => Promise.resolve(null),
    said: () => false,
    adopt: () => Promise.resolve(false),
    outcome: () => false,
    attach: () => false,
  };
}

async function app(input: {
  readonly out: () => boolean;
  readonly trial?: boolean;
}) {
  const engine = speechEngine();
  const duplex = duplexBroker();
  const liveBroker = {
    enabled: true,
    isTrialUser: () => input.trial === true,
    trialFor: () =>
      Promise.resolve({ allowanceSeconds: 600, remainingSeconds: 600 }),
  } as unknown as LiveBroker;
  const server: FastifyInstance = Fastify();
  registerQVoiceRoutes(server, {
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
        Promise.resolve({ status: "RESOLVED", context: ACTOR }),
    },
    bindings: createVoiceSessionBindings(),
    provider: engine,
    deepgram: createDeepgramVoiceProvider({
      apiKey: "disabled-locally-000000000000",
      publicUrl: "https://q-api.invalid",
      thinkPath: "/v1/q/voice/think",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ access_token: "dg_fake" }), {
            status: 200,
          }),
        ),
    }),
    duplex,
    live: {
      broker: liveBroker,
      allowedUsers: null,
      preview: { enabled: false, providers: () => ({}) },
    },
    openAiExhausted: input.out,
  });
  await server.ready();
  const open = () =>
    server.inject({
      method: "POST",
      url: Q_VOICE_SESSIONS_PATH,
      headers: { authorization: `Bearer ${BEARER}` },
      payload: {},
    });
  const available = () =>
    server.inject({
      method: "GET",
      url: Q_VOICE_LIVE_AVAILABLE_PATH,
      headers: { authorization: `Bearer ${BEARER}` },
    });
  return { server, engine, duplex, open, available };
}

describe("a voice line while OpenAI's account is out", () => {
  it("is ElevenLabs' (speech in and out), with no duplex line offered", async () => {
    const { server, engine, duplex, open } = await app({ out: () => true });
    const response = await open();
    expect(response.statusCode).toBe(201);
    const body = response.json<Record<string, unknown>>();
    expect(body["provider"]).toBe("elevenlabs");
    expect(body["deepgram"]).toBeUndefined();
    expect(body["duplex"]).toBeUndefined();
    expect(body["liveOnly"]).toBeUndefined();
    expect(engine.createSession).toHaveBeenCalledTimes(1);
    expect(duplex.open).not.toHaveBeenCalled();
    await server.close();
  });

  it("gives a trial person a voice too, never a LIVE-only line that cannot open", async () => {
    const { server, open } = await app({ out: () => true, trial: true });
    const body = (await open()).json<Record<string, unknown>>();
    expect(body["liveOnly"]).toBeUndefined();
    expect(body["provider"]).toBe("elevenlabs");
    await server.close();
  });

  it("does not offer GPT-Live, even to someone it was remembered as yes for", async () => {
    let out = false;
    const { server, available } = await app({ out: () => out });
    expect((await available()).json()).toEqual({ available: true });
    out = true;
    expect((await available()).json()).toEqual({ available: false });
    // Back: offered again at once (the "no" was never remembered).
    out = false;
    expect((await available()).json()).toEqual({ available: true });
    await server.close();
  });
});

describe("a voice line when OpenAI is back (the gateway's probe succeeded)", () => {
  it("takes the normal path again: Deepgram's line with the duplex line on top", async () => {
    let out = true;
    const { server, engine, duplex, open } = await app({ out: () => out });
    expect((await open()).json<Record<string, unknown>>()["provider"]).toBe(
      "elevenlabs",
    );
    out = false;
    const body = (await open()).json<Record<string, unknown>>();
    expect(body["provider"]).toBe("deepgram");
    expect(body["duplex"]).toBeDefined();
    expect(duplex.open).toHaveBeenCalledTimes(1);
    expect(engine.createSession).toHaveBeenCalledTimes(1);
    await server.close();
  });
});
