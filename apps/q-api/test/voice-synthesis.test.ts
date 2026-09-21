import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  Q_SPEECH_MAX_CHARS,
  Q_VOICE_SPEECH_PATH,
  type QVoiceChoice,
} from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { createVoiceSessionBindings } from "../src/voice/bindings.js";
import { createDeepgramSpeechSynthesis } from "../src/voice/providers/deepgram-speak.js";
import {
  SpeechSynthesisError,
  createSpeechThrottle,
  type SpeechSynthesisPort,
} from "../src/voice/synthesis.js";

/**
 * `POST /v1/q/voice/speech` and the synthesiser behind it
 * (Q-FIRST-RUN-TTS-001).
 *
 * The properties worth holding are the ones that make hearing Q safe to
 * offer: the key never leaves the server, the text is bounded before a
 * provider is addressed, one person cannot spend the product's synthesis
 * budget, and a provider having a bad day is never described to a
 * listener. The adapter is driven through a fake `fetch`, so what is
 * under test is the request this code makes and what it does with the
 * answer — not Deepgram.
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

const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]);

function buildApp(
  speech: SpeechSynthesisPort | undefined,
  throttle = createSpeechThrottle(),
): FastifyInstance {
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  return createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    voice: {
      bindings: createVoiceSessionBindings(),
      speech,
      speechThrottle: throttle,
    },
  }).app;
}

function speak(
  app: FastifyInstance,
  payload: Record<string, unknown> = { text: "Hi, I'm Q." },
) {
  return app.inject({
    method: "POST",
    url: Q_VOICE_SPEECH_PATH,
    headers: { authorization: "Bearer token" },
    payload,
  });
}

function port(
  synthesise: SpeechSynthesisPort["synthesise"],
): SpeechSynthesisPort {
  return { name: "test", voices: ["FEMALE", "MALE"], synthesise };
}

function mp3Response(body: Uint8Array = AUDIO): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
}

describe("Q-FIRST-RUN-TTS-001 · Q reads a line aloud", () => {
  it("answers with playable audio and never lets a cache keep it", async () => {
    const app = buildApp(
      port(() => Promise.resolve({ audio: AUDIO, mediaType: "audio/mpeg" })),
    );
    const response = await speak(app);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(new Uint8Array(response.rawPayload)).toEqual(AUDIO);
    await app.close();
  });

  it("refuses more text than it will read out, before any provider is asked", async () => {
    const synthesise = vi.fn();
    const app = buildApp(port(synthesise));
    const response = await speak(app, {
      text: "a".repeat(Q_SPEECH_MAX_CHARS + 1),
    });
    expect(response.statusCode).toBe(422);
    expect(synthesise).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses anything the contract does not allow the caller to choose", async () => {
    const synthesise = vi.fn();
    const app = buildApp(port(synthesise));
    // A model, a voice id, a provider: all resolved on the server.
    const response = await speak(app, { text: "Hello", model: "aura-2-x" });
    expect(response.statusCode).toBe(422);
    expect(synthesise).not.toHaveBeenCalled();
    await app.close();
  });

  it("says Q cannot speak, and nothing about why, when the provider refuses", async () => {
    const app = buildApp(
      port(() => Promise.reject(new SpeechSynthesisError(true))),
    );
    const response = await speak(app);
    expect(response.statusCode).toBe(503);
    const body = response.body.toLowerCase();
    expect(body).toContain("q can't speak right now");
    for (const leak of ["deepgram", "token", "quota", "429", "api key"]) {
      expect(body).not.toContain(leak);
    }
    await app.close();
  });

  it("is not there at all on a build with no synthesiser", async () => {
    const app = buildApp(undefined);
    expect((await speak(app)).statusCode).toBe(404);
    await app.close();
  });

  it("stops one person spending the synthesis budget", async () => {
    const throttle = createSpeechThrottle({
      quota: { limit: 2, windowMs: 60_000 },
    });
    const app = buildApp(
      port(() => Promise.resolve({ audio: AUDIO, mediaType: "audio/mpeg" })),
      throttle,
    );
    expect((await speak(app)).statusCode).toBe(200);
    expect((await speak(app)).statusCode).toBe(200);
    expect((await speak(app)).statusCode).toBe(429);
    await app.close();
  });

  it("gives each person their own allowance, and forgets a spent window", () => {
    let now = 0;
    const throttle = createSpeechThrottle({
      quota: { limit: 1, windowMs: 1_000 },
      clock: () => now,
    });
    expect(throttle.charge("tenant:one")).toBe(true);
    expect(throttle.charge("tenant:one")).toBe(false);
    // Somebody else's turn is not spent by the first person's.
    expect(throttle.charge("tenant:two")).toBe(true);
    now = 2_000;
    expect(throttle.charge("tenant:one")).toBe(true);
  });
});

describe("Q-FIRST-RUN-TTS-001 · the Deepgram adapter", () => {
  const voices: readonly QVoiceChoice[] = ["FEMALE", "MALE"];

  it("asks Deepgram for mp3 in the chosen voice, with the key in the header and nowhere else", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(mp3Response()));
    const synthesiser = createDeepgramSpeechSynthesis({
      apiKey: "secret-key-value-0123456789",
      fetch: fetchMock,
    });
    for (const voice of voices) {
      await synthesiser.synthesise({ text: "Hi, I'm Q.", voice });
    }
    const [first, second] = fetchMock.mock.calls as unknown as [
      [URL, RequestInit],
      [URL, RequestInit],
    ];
    expect(first[0].searchParams.get("encoding")).toBe("mp3");
    expect(first[0].searchParams.get("model")).toBe("aura-2-thalia-en");
    expect(second[0].searchParams.get("model")).toBe("aura-2-orion-en");
    expect(first[0].toString()).not.toContain("secret-key-value");
    expect((first[1].headers as Record<string, string>)["Authorization"]).toBe(
      "Token secret-key-value-0123456789",
    );
    const body: unknown = first[1].body;
    expect(JSON.parse(typeof body === "string" ? body : "{}")).toEqual({
      text: "Hi, I'm Q.",
    });
  });

  it("refuses a response that is not the audio it asked for", async () => {
    const synthesiser = createDeepgramSpeechSynthesis({
      apiKey: "secret-key-value-0123456789",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ err: "nope" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    });
    await expect(
      synthesiser.synthesise({ text: "Hello", voice: "FEMALE" }),
    ).rejects.toBeInstanceOf(SpeechSynthesisError);
  });

  it("refuses audio larger than it will hand to a browser", async () => {
    const synthesiser = createDeepgramSpeechSynthesis({
      apiKey: "secret-key-value-0123456789",
      maxBytes: 4,
      fetch: () => Promise.resolve(mp3Response(new Uint8Array(16))),
    });
    await expect(
      synthesiser.synthesise({ text: "Hello", voice: "FEMALE" }),
    ).rejects.toBeInstanceOf(SpeechSynthesisError);
  });

  it("treats being rate-limited as worth retrying and a bad request as not", async () => {
    const status = (code: number) =>
      createDeepgramSpeechSynthesis({
        apiKey: "secret-key-value-0123456789",
        fetch: () => Promise.resolve(new Response("", { status: code })),
      }).synthesise({ text: "Hello", voice: "FEMALE" });

    await expect(status(429)).rejects.toMatchObject({ retryable: true });
    await expect(status(503)).rejects.toMatchObject({ retryable: true });
    await expect(status(400)).rejects.toMatchObject({ retryable: false });
  });

  it("never describes the provider in the error a caller sees", async () => {
    const synthesiser = createDeepgramSpeechSynthesis({
      apiKey: "secret-key-value-0123456789",
      fetch: () =>
        Promise.resolve(
          new Response("Deepgram: project quota exceeded", { status: 402 }),
        ),
    });
    await expect(
      synthesiser.synthesise({ text: "Hello", voice: "FEMALE" }),
    ).rejects.toThrow("Q could not speak that line.");
  });
});
