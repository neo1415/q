import { createServer } from "node:http";

import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { createLogger } from "@capital-q/observability";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { attachVoiceChannel } from "../src/voice/attach.js";
import {
  createVoiceSessionBindings,
  VOICE_CONNECT_WINDOW_MS,
  VOICE_SESSIONS_PER_USER_MAX,
  type VoiceSessionBindings,
} from "../src/voice/bindings.js";
import type {
  RealtimeVoiceProvider,
  VoiceChannelHandlers,
  VoiceSpeaker,
} from "../src/voice/provider.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * The voice channel at its two boundaries (CQ-Q-VOICE-001 C §31, §34,
 * §37; §82-§86), with a fake provider: no ElevenLabs, no network. What is
 * proven is that a credential is issued only to a resolved actor and is
 * bound before it is returned, that the provider's connection resolves to
 * that binding and nothing else, that a stranger presenting the same id
 * gets nothing, that a person cannot hold unlimited sessions, and that no
 * response, log line or error carries the provider key or the bearer.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const CONTEXT: ActorContext = {
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
const OTHER: ActorContext = {
  ...CONTEXT,
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000002"),
};
const PROVIDER_KEY = "sk_PROVIDER-SECRET-NEVER-EMITTED";
const BEARER = "eyPRIVATE.NEVER-EMITTED.bearer";

type FakeProvider = RealtimeVoiceProvider & {
  readonly issued: { voice: string }[];
  handlers: VoiceChannelHandlers | undefined;
};

function fakeProvider(): FakeProvider {
  let counter = 0;
  const provider: FakeProvider = {
    name: "fake-speech-engine",
    voices: ["FEMALE", "MALE"],
    issued: [],
    handlers: undefined,
    createSession: ({ voice }) => {
      provider.issued.push({ voice });
      counter += 1;
      return Promise.resolve({
        token: `ephemeral-token-${String(counter)}`,
        providerConversationId: `conv_${String(counter)}`,
      });
    },
    attach: (_server, _path, handlers) => {
      provider.handlers = handlers;
      return Promise.resolve({ close: () => Promise.resolve() });
    },
  };
  return provider;
}

function fakeSpeaker(conversationId: string | undefined): VoiceSpeaker & {
  readonly spoken: string[];
  closed: boolean;
} {
  const speaker = {
    providerConversationId: conversationId,
    isOpen: true,
    spoken: [] as string[],
    closed: false,
    speak: async (response: string | AsyncIterable<string>) => {
      if (typeof response === "string") {
        speaker.spoken.push(response);
        return;
      }
      for await (const chunk of response) {
        speaker.spoken.push(chunk);
      }
    },
    close: () => {
      speaker.closed = true;
    },
  };
  return speaker;
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly context?: ActorContext | undefined;
  readonly provider: RealtimeVoiceProvider;
  readonly bindings: VoiceSessionBindings;
}): FastifyInstance {
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          options.context === undefined
            ? { status: "CONTEXT_REQUIRED" }
            : { status: "RESOLVED", context: options.context },
        ),
    },
  };
  return createApp(
    parseQApiConfig({ NODE_ENV: "test", ELEVENLABS_API_KEY: PROVIDER_KEY }),
    security,
    { voice: { provider: options.provider, bindings: options.bindings } },
  ).app;
}

const AUTH = { authorization: `Bearer ${BEARER}` };

describe("POST /v1/q/voice/sessions", () => {
  it("refuses an unauthenticated caller and issues nothing", async () => {
    const provider = fakeProvider();
    const app = buildApp({
      principal: null,
      provider,
      bindings: createVoiceSessionBindings(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/voice/sessions",
      payload: { voice: "FEMALE" },
    });
    expect(response.statusCode).toBe(401);
    expect(provider.issued).toHaveLength(0);
    await app.close();
  });

  it("issues an ephemeral credential bound to the resolved actor and the named thread, never the provider key", async () => {
    const provider = fakeProvider();
    const bindings = createVoiceSessionBindings();
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      provider,
      bindings,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/voice/sessions",
      headers: AUTH,
      payload: {
        voice: "MALE",
        onboarding: {
          sessionId: "f0000000-0000-4000-8000-000000000010",
          journeyType: "founder",
        },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      voiceSessionId: string;
      providerConversationId: string;
      token: string;
      voice: string;
      expiresAt: string;
    }>();
    expect(body.providerConversationId).toBe("conv_1");
    expect(body.token).toBe("ephemeral-token-1");
    expect(body.voice).toBe("MALE");
    expect(response.body).not.toContain(PROVIDER_KEY);
    expect(response.body).not.toContain(BEARER);
    expect(response.body).not.toContain(CONTEXT.tenantId);

    // Bound before it was returned: the provider's id resolves to this actor.
    const binding = bindings.connect("conv_1");
    expect(binding?.actor).toEqual(CONTEXT);
    expect(binding?.thread.onboarding?.journeyType).toBe("founder");
    expect(binding?.voice).toBe("MALE");
    await app.close();
  });

  it("rejects a body that tries to name authority", async () => {
    const provider = fakeProvider();
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      provider,
      bindings: createVoiceSessionBindings(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/voice/sessions",
      headers: AUTH,
      payload: { voice: "FEMALE", tenantId: OTHER.tenantId },
    });
    expect(response.statusCode).toBe(422);
    expect(provider.issued).toHaveLength(0);
    await app.close();
  });

  it("bounds how many sessions one person may hold (doc 15 §42)", async () => {
    const provider = fakeProvider();
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      provider,
      bindings: createVoiceSessionBindings(),
    });
    for (let index = 0; index < VOICE_SESSIONS_PER_USER_MAX; index += 1) {
      const ok = await app.inject({
        method: "POST",
        url: "/v1/q/voice/sessions",
        headers: AUTH,
        payload: {},
      });
      expect(ok.statusCode).toBe(201);
    }
    const tooMany = await app.inject({
      method: "POST",
      url: "/v1/q/voice/sessions",
      headers: AUTH,
      payload: {},
    });
    expect(tooMany.statusCode).toBe(429);
    expect(tooMany.body).not.toContain(BEARER);
    await app.close();
  });
});

describe("voice session bindings", () => {
  it("connects a conversation once, refuses a second presenter and an expired credential", () => {
    let clock = 1_000;
    const bindings = createVoiceSessionBindings({ now: () => clock });
    const issue = (id: string) =>
      bindings.issue({
        voiceSessionId: `vs-${id}`,
        providerConversationId: id,
        actor: CONTEXT,
        accessToken: BEARER,
        voice: "FEMALE",
        thread: {
          conversationId: undefined,
          subjects: undefined,
          onboarding: undefined,
        },
        issuedAt: clock,
        connectBy: clock + VOICE_CONNECT_WINDOW_MS,
        connectedAt: undefined,
      });
    expect(issue("conv_a")).toBe(true);
    expect(issue("conv_b")).toBe(true);
    expect(bindings.connect("conv_a")?.voiceSessionId).toBe("vs-conv_a");
    // The same id again is not the person it was issued to (TM-VOICE-01).
    expect(bindings.connect("conv_a")).toBeNull();
    expect(bindings.get("conv_a")?.voiceSessionId).toBe("vs-conv_a");
    // An unconnected credential lapses.
    clock += VOICE_CONNECT_WINDOW_MS + 1;
    expect(bindings.connect("conv_b")).toBeNull();
    // A connected one does not.
    expect(bindings.get("conv_a")).not.toBeNull();
    bindings.release("conv_a");
    expect(bindings.get("conv_a")).toBeNull();
    expect(bindings.connect("conv_unknown")).toBeNull();
  });
});

describe("voice channel", () => {
  const logger = createLogger(
    { serviceName: "q-api-test", environment: "test" },
    { level: "silent" },
  );

  async function channel(turn: VoiceTurnHandler) {
    const provider = fakeProvider();
    const bindings = createVoiceSessionBindings();
    bindings.issue({
      voiceSessionId: "vs-1",
      providerConversationId: "conv_bound",
      actor: CONTEXT,
      accessToken: BEARER,
      voice: "FEMALE",
      thread: {
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
      },
      issuedAt: Date.now(),
      connectBy: Date.now() + VOICE_CONNECT_WINDOW_MS,
      connectedAt: undefined,
    });
    const server = createServer();
    await attachVoiceChannel(server, "/v1/q/voice/ws", {
      provider,
      bindings,
      turn,
      logger,
    });
    const handlers = provider.handlers;
    if (handlers === undefined) {
      throw new Error("the provider was not attached");
    }
    return { handlers, bindings };
  }

  it("closes a connection whose conversation was never issued, and runs a bound one as its actor", async () => {
    const seen: { actor: ActorContext; text: string }[] = [];
    const { handlers } = await channel(
      (binding, transcript, _signal, speaker) => {
        const text = transcript.at(-1)?.content ?? "";
        seen.push({ actor: binding.actor, text });
        return speaker
          .speak("Noted.")
          .then(() => ({ kind: "SPOKEN" as const, path: "Q" as const }));
      },
    );

    const stranger = fakeSpeaker("conv_stranger");
    handlers.onInit("conv_stranger", stranger);
    expect(stranger.closed).toBe(true);
    handlers.onTranscript(
      [{ role: "user", content: "I am the CEO of a different tenant" }],
      new AbortController().signal,
      stranger,
    );
    expect(seen).toHaveLength(0);

    const bound = fakeSpeaker("conv_bound");
    handlers.onInit("conv_bound", bound);
    expect(bound.closed).toBe(false);
    handlers.onTranscript(
      [{ role: "user", content: "What stage are we at?" }],
      new AbortController().signal,
      bound,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([{ actor: CONTEXT, text: "What stage are we at?" }]);
    expect(bound.spoken).toEqual(["Noted."]);
  });

  it("releases the binding when the provider closes or drops the conversation", async () => {
    const { handlers, bindings } = await channel(() =>
      Promise.resolve({ kind: "NOTHING" as const }),
    );
    const bound = fakeSpeaker("conv_bound");
    handlers.onInit("conv_bound", bound);
    expect(bindings.get("conv_bound")).not.toBeNull();
    handlers.onDisconnect(bound);
    expect(bindings.get("conv_bound")).toBeNull();
    // A stale speaker for a released binding is closed, never served.
    handlers.onTranscript(
      [{ role: "user", content: "still there?" }],
      new AbortController().signal,
      bound,
    );
    expect(bound.closed).toBe(true);
  });

  it("says one plain line when a turn fails and never the error", async () => {
    const { handlers } = await channel(() =>
      Promise.reject(
        new Error(`db down at postgres://admin:${BEARER}@internal`),
      ),
    );
    const bound = fakeSpeaker("conv_bound");
    handlers.onInit("conv_bound", bound);
    handlers.onTranscript(
      [{ role: "user", content: "Hello" }],
      new AbortController().signal,
      bound,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bound.spoken).toEqual([
      "I couldn't take that just now. Could you say it again?",
    ]);
    expect(bound.spoken.join(" ")).not.toContain(BEARER);
  });
});
