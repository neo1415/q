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
 * DECISIONS 68 (owner, 6 Nov 2026; lead's decision B): when the OpenAI
 * account is out, the line is Deepgram listening, Q's own turn path (the
 * Model Gateway, on Claude) answering and q-api's ElevenLabs relay
 * speaking (voice-openai-out-speech.test.ts); without Deepgram, the
 * ElevenLabs Speech Engine. No OpenAI line (GPT-Live, duplex) is offered. When the
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
    accounts.health.recordFailure("openai", "m", "TRANSIENT", at);
    expect(accounts.exhausted("openai", at)).toBe(true);
    expect(accounts.exhausted("openai", new Date(at.getTime() + 600_001))).toBe(
      false,
    );
  });
});

function speechEngine(
  createSession: RealtimeVoiceProvider["createSession"],
): RealtimeVoiceProvider {
  return {
    name: "fake-speech-engine",
    voices: ["FEMALE", "MALE"],
    createSession,
    attach: () => Promise.resolve({ close: () => Promise.resolve() }),
  };
}

function duplexBroker(open: DuplexBroker["open"]): DuplexBroker {
  return {
    enabled: true,
    open,
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
  /** Without the Deepgram transport: the Speech Engine carries the line. */
  readonly noDeepgram?: boolean;
}) {
  // The mocks are held on their own, so the assertions read plain mocks.
  const createSession = vi.fn<RealtimeVoiceProvider["createSession"]>(() =>
    Promise.resolve({ token: "el_token", providerConversationId: "el_conv" }),
  );
  const open = vi.fn<DuplexBroker["open"]>(() =>
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
  );
  const engine = speechEngine(createSession);
  const duplex = duplexBroker(open);
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
    ...(input.noDeepgram === true
      ? {}
      : {
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
  const issue = () =>
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
  return { server, createSession, open, issue, available };
}

describe("a voice line while OpenAI's account is out", () => {
  it("is Deepgram's (Q's brain, the ElevenLabs relay), with no duplex line minted", async () => {
    const { server, createSession, open, issue } = await app({
      out: () => true,
    });
    const response = await issue();
    expect(response.statusCode).toBe(201);
    const body = response.json<Record<string, unknown>>();
    expect(body["provider"]).toBe("deepgram");
    expect(body["duplex"]).toBeUndefined();
    expect(body["liveOnly"]).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    await server.close();
  });

  it("falls through to the ElevenLabs Speech Engine where Deepgram is not composed", async () => {
    const { server, createSession, open, issue } = await app({
      out: () => true,
      noDeepgram: true,
    });
    const body = (await issue()).json<Record<string, unknown>>();
    expect(body["provider"]).toBe("elevenlabs");
    expect(body["duplex"]).toBeUndefined();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    await server.close();
  });

  it("gives a trial person a voice too, never a LIVE-only line that cannot open", async () => {
    const { server, issue } = await app({ out: () => true, trial: true });
    const body = (await issue()).json<Record<string, unknown>>();
    expect(body["liveOnly"]).toBeUndefined();
    expect(body["provider"]).toBe("deepgram");
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
    const { server, createSession, open, issue } = await app({
      out: () => out,
    });
    const during = (await issue()).json<Record<string, unknown>>();
    expect(during["provider"]).toBe("deepgram");
    expect(during["duplex"]).toBeUndefined();
    out = false;
    const body = (await issue()).json<Record<string, unknown>>();
    expect(body["provider"]).toBe("deepgram");
    expect(body["duplex"]).toBeDefined();
    expect(open).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
    await server.close();
  });
});
