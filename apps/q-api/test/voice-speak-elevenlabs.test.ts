import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type {
  VoiceSessionBinding,
  VoiceSessionBindings,
} from "../src/voice/bindings.js";
import { createDeepgramVoiceProvider } from "../src/voice/providers/deepgram.js";
import {
  Q_VOICE_SPEAK_RELAY_PATH,
  registerQVoiceRoutes,
} from "../src/voice/routes.js";
import type { QVoiceChoice } from "@capital-q/contracts";
import {
  createElevenLabsSpeechRelay,
  createElevenLabsSpeechSynthesis,
} from "../src/voice/providers/elevenlabs-speak.js";
import { SpeechSynthesisError } from "../src/voice/synthesis.js";

/**
 * Q is heard in ElevenLabs (QX-004 SPEAK rework).
 *
 * Deepgram still listens and Q still thinks; only the voice moved. The
 * properties worth holding are the ones that make that safe: the vendor
 * key stays on this server although the agent settings travel through the
 * browser, the agent is pointed at us rather than at the vendor, and a
 * build with no ElevenLabs key still speaks. The adapters are driven
 * through a fake `fetch`, so what is under test is the request this code
 * makes — not ElevenLabs.
 */

const KEY = "el-key-never-printed";
const PUBLIC_URL = "https://public.example";

/** "Sarah" and "Daniel": the account voices, public ids and not secrets. */
const FEMALE_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const MALE_VOICE_ID = "onwK4e9ZLuTAKqWW03F9";

const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]);

function mp3Response(): Response {
  const bytes = new Uint8Array(AUDIO);
  return new Response(new Blob([bytes], { type: "audio/mpeg" }), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
}

type Call = {
  url: string;
  key: string | null;
  body: Record<string, unknown> | null;
};

function recordingFetch(response: () => Response): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      key: headers.get("xi-api-key"),
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null,
    });
    return Promise.resolve(response());
  };
  return { fetch: fetchFake, calls };
}

describe("the agent's speak settings", () => {
  it("sends the agent to this server for Q's voice, never the ElevenLabs key", () => {
    const provider = createDeepgramVoiceProvider({
      apiKey: "dg-key-never-printed",
      publicUrl: PUBLIC_URL,
      thinkPath: "/v1/q/voice/think",
      speak: {
        path: "/v1/q/voice/speak",
        relay: createElevenLabsSpeechRelay({ apiKey: KEY }),
      },
    });
    const settings = provider.settingsFor({
      voice: "FEMALE",
      greeting: "Hello, I'm Q.",
      thinkToken: "secret-think-token",
    });

    expect(settings.agent).toMatchObject({
      speak: {
        provider: { type: "eleven_labs", model_id: "eleven_turbo_v2_5" },
        endpoint: {
          url: "https://public.example/v1/q/voice/speak",
          headers: { authorization: "Bearer secret-think-token" },
        },
      },
    });

    /**
     * The whole reason the agent is pointed at this server rather than at
     * api.elevenlabs.io: these settings are composed here but *sent by the
     * browser*, so anything inside them is public to the person. If this
     * ever fails, the account key is being handed to every visitor.
     */
    const serialised = JSON.stringify(settings);
    expect(serialised).not.toContain(KEY);
    expect(serialised).not.toContain("xi-api-key");
    expect(serialised).not.toContain("api.elevenlabs.io");
  });

  it("keeps listening on Deepgram and thinking on this server", () => {
    const provider = createDeepgramVoiceProvider({
      apiKey: "dg-key-never-printed",
      publicUrl: PUBLIC_URL,
      thinkPath: "/v1/q/voice/think",
      speak: {
        path: "/v1/q/voice/speak",
        relay: createElevenLabsSpeechRelay({ apiKey: KEY }),
      },
    });
    const settings = provider.settingsFor({
      voice: "FEMALE",
      greeting: undefined,
      thinkToken: "secret-think-token",
    });
    // Changing the voice must not have changed the ear or the brain.
    expect(settings.agent).toMatchObject({
      listen: { provider: { type: "deepgram", model: "flux-general-en" } },
      think: {
        endpoint: {
          url: "https://public.example/v1/q/voice/think/chat/completions",
        },
      },
    });
  });

  it("still speaks in Aura-2 on a build with no ElevenLabs key", () => {
    const provider = createDeepgramVoiceProvider({
      apiKey: "dg-key-never-printed",
      publicUrl: PUBLIC_URL,
      thinkPath: "/v1/q/voice/think",
    });
    expect(provider.speakRelay).toBeUndefined();
    expect(
      provider.settingsFor({
        voice: "MALE",
        greeting: undefined,
        thinkToken: "t",
      }).agent,
    ).toMatchObject({
      speak: { provider: { type: "deepgram", model: "aura-2-orion-en" } },
    });
  });
});

describe("the ElevenLabs relay", () => {
  it("asks for the session's voice as 24k PCM, which is what the agent plays", async () => {
    const { fetch: fetchFake, calls } = recordingFetch(mp3Response);
    const relay = createElevenLabsSpeechRelay({
      apiKey: KEY,
      fetch: fetchFake,
    });
    await relay.stream({ voice: "FEMALE", text: "Fifty thousand euros." });

    expect(calls[0]?.url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${FEMALE_VOICE_ID}/stream?output_format=pcm_24000`,
    );
    expect(calls[0]?.key).toBe(KEY);
    expect(calls[0]?.body).toEqual({
      text: "Fifty thousand euros.",
      model_id: "eleven_turbo_v2_5",
    });
  });

  it("speaks the male voice in the male voice", async () => {
    const { fetch: fetchFake, calls } = recordingFetch(mp3Response);
    const relay = createElevenLabsSpeechRelay({
      apiKey: KEY,
      fetch: fetchFake,
    });
    await relay.stream({ voice: "MALE", text: "Hello." });
    expect(calls[0]?.url).toContain(MALE_VOICE_ID);
  });

  it("will not relay an output format it was not built to ask for", async () => {
    const { fetch: fetchFake, calls } = recordingFetch(mp3Response);
    const relay = createElevenLabsSpeechRelay({
      apiKey: KEY,
      fetch: fetchFake,
    });
    // The query string arrives from outside this server; a vendor URL is
    // not the place to relay a stranger's parameters.
    await relay.stream({
      voice: "FEMALE",
      text: "Hello.",
      outputFormat: "../../v1/history?evil=1",
    });
    expect(calls[0]?.url).toContain("output_format=pcm_24000");
    expect(calls[0]?.url).not.toContain("evil");

    await relay.stream({
      voice: "FEMALE",
      text: "Hello.",
      outputFormat: "mp3_44100_128",
    });
    expect(calls[1]?.url).toContain("output_format=mp3_44100_128");
  });
});

const THINK_TOKEN = "the-sessions-own-secret";

function binding(voice: QVoiceChoice): VoiceSessionBinding {
  return {
    voiceSessionId: "f0000000-0000-4000-8000-000000000001",
    providerConversationId: "dg_f0000000-0000-4000-8000-000000000001",
    actor: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
    } as never,
    accessToken: "eyPRIVATE.bearer",
    voice,
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: Number.MAX_SAFE_INTEGER,
    connectedAt: undefined,
    thinkToken: THINK_TOKEN,
  };
}

function fakeBindings(bound: VoiceSessionBinding): VoiceSessionBindings {
  return {
    issue: () => true,
    connect: () => bound,
    get: () => bound,
    byVoiceSessionId: () => bound,
    byThinkToken: (token) => (token === bound.thinkToken ? bound : null),
    fingerprints: () => [],
    releaseFor: () => undefined,
    release: () => undefined,
    countFor: () => 1,
    size: () => 1,
  };
}

async function relayApp(
  bound: VoiceSessionBinding,
  fetchFake: typeof fetch,
): Promise<FastifyInstance> {
  const server = Fastify();
  registerQVoiceRoutes(server, {
    authenticator: { authenticate: () => Promise.reject(new Error("unused")) },
    resolver: {
      resolveHumanContext: () => Promise.reject(new Error("unused")),
    },
    bindings: fakeBindings(bound),
    deepgram: createDeepgramVoiceProvider({
      apiKey: "dg-key-never-printed",
      publicUrl: PUBLIC_URL,
      thinkPath: "/v1/q/voice/think",
      speak: {
        path: Q_VOICE_SPEAK_RELAY_PATH,
        relay: createElevenLabsSpeechRelay({ apiKey: KEY, fetch: fetchFake }),
      },
    }),
  });
  await server.ready();
  return server;
}

describe("the relay route", () => {
  it("relays a bound session's sentence and streams the audio back", async () => {
    const { fetch: fetchFake, calls } = recordingFetch(mp3Response);
    const server = await relayApp(binding("FEMALE"), fetchFake);
    const response = await server.inject({
      method: "POST",
      url: `${Q_VOICE_SPEAK_RELAY_PATH}?output_format=pcm_24000`,
      headers: { authorization: `Bearer ${THINK_TOKEN}` },
      payload: { text: "Fifty thousand euros." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(new Uint8Array(response.rawPayload)).toEqual(AUDIO);
    expect(calls[0]?.body).toMatchObject({ text: "Fifty thousand euros." });
    await server.close();
  });

  it("refuses anything that does not carry the session's own secret", async () => {
    const { fetch: fetchFake, calls } = recordingFetch(mp3Response);
    const server = await relayApp(binding("FEMALE"), fetchFake);
    for (const headers of [
      {},
      { authorization: "Bearer not-the-secret" },
      { authorization: THINK_TOKEN },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: Q_VOICE_SPEAK_RELAY_PATH,
        headers,
        payload: { text: "Hello." },
      });
      expect(response.statusCode).toBe(401);
    }
    // Nothing was spent at the vendor on an unauthorised call.
    expect(calls).toHaveLength(0);
    await server.close();
  });

  it("speaks in the voice the session was issued for, not one the caller names", async () => {
    const { fetch: fetchFake, calls } = recordingFetch(mp3Response);
    const server = await relayApp(binding("MALE"), fetchFake);
    const response = await server.inject({
      method: "POST",
      url: Q_VOICE_SPEAK_RELAY_PATH,
      headers: { authorization: `Bearer ${THINK_TOKEN}` },
      // A voice the caller would like. The binding decides.
      payload: { text: "Hello.", voice_id: FEMALE_VOICE_ID },
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0]?.url).toContain(MALE_VOICE_ID);
    expect(calls[0]?.url).not.toContain(FEMALE_VOICE_ID);
    await server.close();
  });

  it("does not ask the vendor for nothing, or for more than Q ever says", async () => {
    const { fetch: fetchFake, calls } = recordingFetch(mp3Response);
    const server = await relayApp(binding("FEMALE"), fetchFake);
    for (const payload of [{}, { text: "   " }, { text: "a".repeat(5_000) }]) {
      const response = await server.inject({
        method: "POST",
        url: Q_VOICE_SPEAK_RELAY_PATH,
        headers: { authorization: `Bearer ${THINK_TOKEN}` },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
    await server.close();
  });

  it("cancels the vendor call when the agent hangs up mid-sentence", async () => {
    // Barge-in: the person speaks over Q and the agent drops the request.
    // The vendor call must be cancelled with it — an uncancelled one is a
    // sentence nobody hears and still pays for, and letting the stream
    // error escape killed the whole line with INTERNAL_SERVER_ERROR.
    let seen: AbortSignal | undefined;
    const relay = createElevenLabsSpeechRelay({
      apiKey: KEY,
      fetch: (_input, init) => {
        seen = init?.signal ?? undefined;
        return Promise.resolve(mp3Response());
      },
    });
    const gone = new AbortController();
    await relay.stream({
      voice: "FEMALE",
      text: "Hello.",
      signal: gone.signal,
    });
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);
    gone.abort();
    expect(seen?.aborted).toBe(true);
  });

  it("tells the agent the audio did not come, never why", async () => {
    const server = await relayApp(binding("FEMALE"), () =>
      Promise.resolve(new Response("insufficient credits", { status: 401 })),
    );
    const response = await server.inject({
      method: "POST",
      url: Q_VOICE_SPEAK_RELAY_PATH,
      headers: { authorization: `Bearer ${THINK_TOKEN}` },
      payload: { text: "Hello." },
    });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("credits");
    expect(response.body).not.toContain(KEY);
    await server.close();
  });

  it("is not registered at all on a build with no ElevenLabs key", async () => {
    const server = Fastify();
    registerQVoiceRoutes(server, {
      authenticator: {
        authenticate: () => Promise.reject(new Error("unused")),
      },
      resolver: {
        resolveHumanContext: () => Promise.reject(new Error("unused")),
      },
      bindings: fakeBindings(binding("FEMALE")),
      deepgram: createDeepgramVoiceProvider({
        apiKey: "dg-key-never-printed",
        publicUrl: PUBLIC_URL,
        thinkPath: "/v1/q/voice/think",
      }),
    });
    await server.ready();
    const response = await server.inject({
      method: "POST",
      url: Q_VOICE_SPEAK_RELAY_PATH,
      headers: { authorization: `Bearer ${THINK_TOKEN}` },
      payload: { text: "Hello." },
    });
    expect(response.statusCode).toBe(404);
    await server.close();
  });
});

describe("the ElevenLabs one-way synthesiser", () => {
  it("returns playable audio and asks under the key it never returns", async () => {
    const { fetch: fetchFake, calls } = recordingFetch(mp3Response);
    const speech = createElevenLabsSpeechSynthesis({
      apiKey: KEY,
      fetch: fetchFake,
    });
    expect(speech.name).toBe("elevenlabs");
    const spoken = await speech.synthesise({ text: "Hi.", voice: "FEMALE" });
    expect(spoken.mediaType).toBe("audio/mpeg");
    expect(spoken.audio).toEqual(AUDIO);
    expect(calls[0]?.url).toContain("output_format=mp3_44100_128");
    expect(calls[0]?.key).toBe(KEY);
  });

  it("tells a caller only whether asking again is worth it", async () => {
    const speech = (status: number) =>
      createElevenLabsSpeechSynthesis({
        apiKey: KEY,
        fetch: () => Promise.resolve(new Response("nope", { status })),
      }).synthesise({ text: "Hi.", voice: "FEMALE" });

    // A refusal about the request itself is never worth repeating; the
    // vendor being busy is. Neither answer reaches a person.
    await expect(speech(401)).rejects.toMatchObject({
      name: "SpeechSynthesisError",
      retryable: false,
    });
    await expect(speech(429)).rejects.toMatchObject({ retryable: true });
    await expect(speech(503)).rejects.toMatchObject({ retryable: true });
  });

  it("refuses something that is not the audio it asked for", async () => {
    const speech = createElevenLabsSpeechSynthesis({
      apiKey: KEY,
      fetch: () => Promise.resolve(Response.json({ detail: "quota" })),
    });
    await expect(
      speech.synthesise({ text: "Hi.", voice: "FEMALE" }),
    ).rejects.toBeInstanceOf(SpeechSynthesisError);
  });

  it("gives up rather than hand a listener a truncated or oversized line", async () => {
    const empty = createElevenLabsSpeechSynthesis({
      apiKey: KEY,
      fetch: () =>
        Promise.resolve(
          new Response(new Blob([], { type: "audio/mpeg" }), {
            headers: { "content-type": "audio/mpeg" },
          }),
        ),
    });
    await expect(
      empty.synthesise({ text: "Hi.", voice: "FEMALE" }),
    ).rejects.toBeInstanceOf(SpeechSynthesisError);

    const huge = createElevenLabsSpeechSynthesis({
      apiKey: KEY,
      maxBytes: 4,
      fetch: mp3Response,
    });
    await expect(
      huge.synthesise({ text: "Hi.", voice: "FEMALE" }),
    ).rejects.toBeInstanceOf(SpeechSynthesisError);
  });

  it("treats a transport failure as worth another attempt", async () => {
    const speech = createElevenLabsSpeechSynthesis({
      apiKey: KEY,
      fetch: vi.fn(() => Promise.reject(new Error("socket"))),
    });
    await expect(
      speech.synthesise({ text: "Hi.", voice: "FEMALE" }),
    ).rejects.toMatchObject({ retryable: true });
  });
});
