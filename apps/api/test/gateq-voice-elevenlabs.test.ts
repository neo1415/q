import { describe, expect, it, vi } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  GATEQ_APPLY_VOICE_PATH,
  GATEQ_VOICE_BRIDGE_PATH,
  GateqVoiceStateDtoSchema,
} from "@capital-q/contracts";
import {
  createGateqVoiceInterview,
  GATEQ_VOICE_CLOSED_LINE,
  GATEQ_VOICE_DEFAULTS,
  GATEQ_VOICE_RETRY_LINE,
  IntakeRefusedError,
  type GateqDialBackVoiceProvider,
  type GateqVoiceSessionRow,
  type GateqVoiceSessionStore,
} from "@capital-q/gateq-intake";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";
import { createGateqDialBackHandlers } from "../src/gateq/voice-dial-back.js";
import { selectGateqVoiceProvider } from "../src/gateq/voice-providers/select.js";

/**
 * Owner directive 2026-11-14: GateQ voice reuses the existing voice
 * providers. Q's ElevenLabs Speech Engine is the default; Deepgram is a
 * fallback only when configured explicitly. No test reaches a provider:
 * the dial-back provider here is a fake with the adapter's shape.
 */

const NO_SECURITY: ApiSecurityDependencies = {
  authenticator: { authenticate: () => Promise.resolve(null) },
  resolver: {
    resolveHumanContext: () => Promise.resolve({ status: "CONTEXT_REQUIRED" }),
  },
  identities: { lookup: () => Promise.resolve(null) },
};

const TOKEN = `gqs_${"c".repeat(43)}`;
const OTHER = `gqs_${"d".repeat(43)}`;
const APP = "00000000-0000-4000-8000-0000000000a1";
const OTHER_APP = "00000000-0000-4000-8000-0000000000a2";
const TENANT = "00000000-0000-4000-8000-0000000000b1";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000b2";
const PROVIDER_KEY = "disabled-locally-000000000000";
const LINE_SECRET = "line-secret-for-tests-0000000000000000000";

function memoryStore(): GateqVoiceSessionStore {
  const rows: GateqVoiceSessionRow[] = [];
  const live = (r: GateqVoiceSessionRow) =>
    r.status === "LIVE" && Date.parse(r.endsAt) > Date.now();
  const mine =
    (k: { applicationId: string; tenantId: string }) =>
    (r: GateqVoiceSessionRow) =>
      r.applicationId === k.applicationId && r.tenantId === k.tenantId;
  return {
    reserve: (input) => {
      const i = rows.findIndex((r) => mine(input)(r) && live(r));
      const open = rows[i];
      if (open !== undefined) {
        rows[i] = { ...open, bridgeTokenHash: input.bridgeTokenHash };
        return Promise.resolve({
          kind: "EXISTING" as const,
          row: rows[i] ?? open,
        });
      }
      const row: GateqVoiceSessionRow = {
        id: input.id,
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        status: "LIVE",
        endedReason: null,
        guestCredentialSealed: input.guestCredentialSealed,
        bridgeTokenHash: input.bridgeTokenHash,
        maxSeconds: input.maxSeconds,
        createdAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + input.maxSeconds * 1000).toISOString(),
      };
      rows.push(row);
      return Promise.resolve({ kind: "CREATED" as const, row });
    },
    end: (input) => {
      const i = rows.findIndex((r) => r.id === input.id);
      const row = rows[i];
      if (row === undefined) return Promise.resolve(null);
      rows[i] = { ...row, status: "ENDED", endedReason: input.reason };
      return Promise.resolve(rows[i] ?? null);
    },
    openForApplication: (k) =>
      Promise.resolve(rows.find((r) => mine(k)(r) && live(r)) ?? null),
    countForApplication: (k) => Promise.resolve(rows.filter(mine(k)).length),
    byBridgeTokenHash: (hash) =>
      Promise.resolve(rows.find((r) => r.bridgeTokenHash === hash) ?? null),
    expired: () => Promise.resolve([]),
  };
}

function build() {
  let issued = 0;
  const provider: GateqDialBackVoiceProvider = {
    kind: "DIAL_BACK",
    name: "elevenlabs",
    issueLine: vi.fn(() => {
      issued += 1;
      return Promise.resolve({
        providerConversationId: `conv_${String(issued)}`,
        token: `webrtc-token-${String(issued)}`,
      });
    }),
  };
  const apps: Record<string, { id: string; tenantId: string }> = {
    [TOKEN]: { id: APP, tenantId: TENANT },
    [OTHER]: { id: OTHER_APP, tenantId: OTHER_TENANT },
  };
  let release: (() => void) | null = null;
  let released = false;
  const turn = vi.fn(
    async (input: {
      token: string;
      message: string;
      clientTurnId: string;
      channel?: string | undefined;
    }) => {
      if (input.message === "boom") throw new Error("model");
      if (input.message === "slow" && !released)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { reply: `Q heard: ${input.message}` } as never;
    },
  );
  const voice = createGateqVoiceInterview({
    config: { ...GATEQ_VOICE_DEFAULTS, enabled: true },
    store: memoryStore(),
    provider,
    lineSecret: LINE_SECRET,
    sealer: { seal: (p) => `sealed:${p}`, open: (s) => s.slice(7) },
    intake: {
      authorise: (token: string) => {
        const app = apps[token];
        if (app === undefined)
          return Promise.reject(new IntakeRefusedError("SESSION_INVALID"));
        return Promise.resolve({
          application: { ...app, status: "IN_PROGRESS" },
          sessionId: "s",
        } as never);
      },
      assertInterviewReady: () => Promise.resolve(),
    },
    conversation: {
      openingFor: () => Promise.resolve("What does the company do?"),
      turn,
    },
    bridgePath: GATEQ_VOICE_BRIDGE_PATH,
  });
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), NO_SECURITY, {
    gateqVoice: { voice },
  });
  const handlers = createGateqDialBackHandlers({ voice });
  return {
    app,
    voice,
    turn,
    handlers,
    provider,
    releaseSlow: () => {
      released = true;
      release?.();
    },
  };
}

function speaker() {
  const said: string[] = [];
  const closed = vi.fn();
  const api = {
    speak: (text: string) => {
      said.push(text);
      return Promise.resolve();
    },
    close: () => {
      closed();
    },
  };
  return { said, closed, api };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function open(app: ReturnType<typeof build>["app"], token = TOKEN) {
  const response = await app.inject({
    method: "POST",
    url: GATEQ_APPLY_VOICE_PATH,
    headers: auth(token),
    payload: {},
  });
  return { response, state: GateqVoiceStateDtoSchema.parse(response.json()) };
}

const heard = (...lines: string[]) =>
  lines.flatMap((content, i) => [
    ...(i === 0
      ? [{ role: "agent" as const, content: "What does the company do?" }]
      : []),
    { role: "user" as const, content },
  ]);

describe("GateQ voice provider selection", () => {
  it("chooses Q's existing ElevenLabs voice by default", () => {
    expect(
      selectGateqVoiceProvider({
        ELEVENLABS_API_KEY: "real-looking-key",
        ELEVENLABS_GATEQ_SPEECH_ENGINE_ID: "seng_gateq",
        DEEPGRAM_API_KEY: "a-deepgram-key",
        API_PUBLIC_URL: "https://api.example.test",
      }),
    ).toMatchObject({ kind: "elevenlabs", speechEngineId: "seng_gateq" });
  });

  it("never selects Deepgram from its key alone; only when configured explicitly", () => {
    const keyOnly = selectGateqVoiceProvider({
      DEEPGRAM_API_KEY: "a-deepgram-key",
      API_PUBLIC_URL: "https://api.example.test",
    });
    expect(keyOnly.kind).toBe("none");
    expect(keyOnly).toMatchObject({
      missing: ["ELEVENLABS_API_KEY", "ELEVENLABS_GATEQ_SPEECH_ENGINE_ID"],
    });
    expect(
      selectGateqVoiceProvider({
        CQ_GATEQ_VOICE_PROVIDER: "deepgram",
        DEEPGRAM_API_KEY: "a-deepgram-key",
        API_PUBLIC_URL: "https://api.example.test/",
      }),
    ).toMatchObject({
      kind: "deepgram",
      publicBaseUrl: "https://api.example.test",
    });
    expect(
      selectGateqVoiceProvider({
        CQ_GATEQ_VOICE_PROVIDER: "deepgram",
        ELEVENLABS_API_KEY: "real-looking-key",
        ELEVENLABS_GATEQ_SPEECH_ENGINE_ID: "seng_gateq",
      }),
    ).toMatchObject({
      kind: "none",
      missing: ["DEEPGRAM_API_KEY", "API_PUBLIC_URL"],
    });
  });

  it("a disabled placeholder, a malformed engine id or an unknown preference is not a provider", () => {
    expect(
      selectGateqVoiceProvider({
        ELEVENLABS_API_KEY: PROVIDER_KEY,
        ELEVENLABS_GATEQ_SPEECH_ENGINE_ID: "seng_gateq",
      }).kind,
    ).toBe("none");
    expect(
      selectGateqVoiceProvider({
        ELEVENLABS_API_KEY: "real-looking-key",
        ELEVENLABS_GATEQ_SPEECH_ENGINE_ID: "../../etc",
      }).kind,
    ).toBe("none");
    expect(
      selectGateqVoiceProvider({
        CQ_GATEQ_VOICE_PROVIDER: "openai",
        ELEVENLABS_API_KEY: "real-looking-key",
        ELEVENLABS_GATEQ_SPEECH_ENGINE_ID: "seng_gateq",
      }).kind,
    ).toBe("none");
  });
});

describe("GateQ voice on ElevenLabs: the guest's scoped credential", () => {
  it("returns a one-conversation token and Q's opening: no provider key, guest credential or line bearer", async () => {
    const { app, provider } = build();
    const { response, state } = await open(app);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(state.line).toEqual({
      provider: "elevenlabs",
      token: "webrtc-token-1",
      firstMessage: "What does the company do?",
    });
    expect(response.body).not.toContain(PROVIDER_KEY);
    expect(response.body).not.toContain(TOKEN);
    expect(response.body).not.toContain(LINE_SECRET);
    expect(response.body).not.toContain("conv_1");
    expect(provider.issueLine).toHaveBeenCalledTimes(1);
    // A GET never hands out a line credential.
    const read = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth(TOKEN),
    });
    expect(GateqVoiceStateDtoSchema.parse(read.json()).line).toBeUndefined();
  });

  it("a forged credential is a 404 and issues nothing", async () => {
    const { app, provider } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth("gqs_forged"),
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(provider.issueLine).not.toHaveBeenCalled();
  });

  it("the HTTP bridge never accepts a dial-back conversation id as a bearer", async () => {
    const { app, turn } = build();
    await open(app);
    const response = await app.inject({
      method: "POST",
      url: `${GATEQ_VOICE_BRIDGE_PATH}/chat/completions`,
      headers: auth("conv_1"),
      payload: { messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.statusCode).toBe(401);
    expect(turn).not.toHaveBeenCalled();
  });
});

describe("GateQ voice on ElevenLabs: the dial-back channel", () => {
  it("refuses a conversation this server did not issue", async () => {
    const { handlers } = build();
    const line = speaker();
    handlers.onInit("conv_unknown", line.api);
    await handlers.settled();
    expect(line.closed).toHaveBeenCalledTimes(1);
  });

  it("each heard line is the canonical turn (channel voice, its own application) and Q speaks the reply", async () => {
    const { app, handlers, turn } = build();
    await open(app);
    await open(app, OTHER);
    const mine = speaker();
    handlers.onInit("conv_1", mine.api);
    handlers.onTranscript(
      "conv_1",
      heard("We sell to clinics."),
      new AbortController().signal,
      mine.api,
    );
    await handlers.settled();
    expect(mine.closed).not.toHaveBeenCalled();
    expect(mine.said).toEqual(["Q heard: We sell to clinics."]);
    expect(turn.mock.calls[0]?.[0]).toMatchObject({
      token: TOKEN,
      channel: "voice",
      message: "We sell to clinics.",
    });
    // The other application's line acts only for that application.
    const theirs = speaker();
    handlers.onTranscript(
      "conv_2",
      heard("Ours is logistics."),
      new AbortController().signal,
      theirs.api,
    );
    await handlers.settled();
    expect(turn.mock.calls[1]?.[0].token).toBe(OTHER);
  });

  it("a re-sent transcript is the same turn; nothing after Q's own line is a new turn", async () => {
    const { app, handlers, turn } = build();
    await open(app);
    const line = speaker();
    const signal = new AbortController().signal;
    handlers.onTranscript("conv_1", heard("First."), signal, line.api);
    handlers.onTranscript("conv_1", heard("First."), signal, line.api);
    handlers.onTranscript(
      "conv_1",
      [...heard("First."), { role: "agent", content: "Q heard: First." }],
      signal,
      line.api,
    );
    await handlers.settled();
    expect(turn).toHaveBeenCalledTimes(2);
    expect(turn.mock.calls[1]?.[0].clientTurnId).toBe(
      turn.mock.calls[0]?.[0].clientTurnId,
    );
  });

  it("barge-in: an interrupted answer is never spoken, and the next line is answered after it, in order", async () => {
    const { app, handlers, turn, releaseSlow } = build();
    await open(app);
    const line = speaker();
    const first = new AbortController();
    handlers.onTranscript("conv_1", heard("slow"), first.signal, line.api);
    // The person speaks again before Q answers.
    await Promise.resolve();
    first.abort();
    handlers.onTranscript(
      "conv_1",
      heard("slow", "Actually, we sell to hospitals."),
      new AbortController().signal,
      line.api,
    );
    releaseSlow();
    await handlers.settled();
    expect(line.said).toEqual(["Q heard: Actually, we sell to hospitals."]);
    expect(turn.mock.calls.map((c) => c[0].message)).toEqual([
      "slow",
      "Actually, we sell to hospitals.",
    ]);
  });

  it("a failed turn is spoken as a retry; past the end only the closing line is said", async () => {
    const { app, handlers, voice } = build();
    await open(app);
    const line = speaker();
    const signal = new AbortController().signal;
    handlers.onTranscript("conv_1", heard("boom"), signal, line.api);
    await handlers.settled();
    expect(line.said).toEqual([GATEQ_VOICE_RETRY_LINE]);
    await voice.end({ token: TOKEN, continueByTyping: true });
    handlers.onTranscript("conv_1", heard("boom", "More."), signal, line.api);
    await handlers.settled();
    expect(line.said.at(-1)).toBe(GATEQ_VOICE_CLOSED_LINE);
  });
});
