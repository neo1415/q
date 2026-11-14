import { describe, expect, it, vi } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  GATEQ_APPLY_VOICE_END_PATH,
  GATEQ_APPLY_VOICE_PATH,
  GATEQ_VOICE_BRIDGE_PATH,
  GateqVoiceStateDtoSchema,
  type GateqVoiceStateDto,
} from "@capital-q/contracts";
import {
  createGateqVoiceInterview,
  GATEQ_VOICE_DEFAULTS,
  GATEQ_VOICE_RETRY_LINE,
  IntakeRefusedError,
  type GateqVoiceSessionRow,
  type GateqVoiceSessionStore,
} from "@capital-q/gateq-intake";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";
import { createDeepgramGateqVoiceProvider } from "../src/gateq/voice-provider.js";

/** Guest routes and the provider bridge need no signed-in actor. */
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
      if (rows.filter(mine(input)).length >= input.perApplication)
        return Promise.resolve({ kind: "ALLOWANCE" as const });
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

function build(
  options: { readonly enabled?: boolean; readonly grant?: number } = {},
) {
  // The speech provider's token grant, mocked: no live call is ever made.
  const fetch = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({ access_token: "short-lived-grant", expires_in: 60 }),
        { status: options.grant ?? 200 },
      ),
    ),
  );
  const provider = createDeepgramGateqVoiceProvider({
    apiKey: PROVIDER_KEY,
    publicBaseUrl: "https://api.example.test/",
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const apps: Record<string, { id: string; tenantId: string }> = {
    [TOKEN]: { id: APP, tenantId: TENANT },
    [OTHER]: { id: OTHER_APP, tenantId: OTHER_TENANT },
  };
  const turn = vi.fn(
    (input: {
      token: string;
      message: string;
      clientTurnId: string;
      channel?: string | undefined;
    }) => {
      if (input.message === "boom") return Promise.reject(new Error("model"));
      return Promise.resolve({ reply: `Q heard: ${input.message}` } as never);
    },
  );
  const voice = createGateqVoiceInterview({
    config: {
      ...GATEQ_VOICE_DEFAULTS,
      enabled: options.enabled ?? true,
      perApplication: 2,
    },
    store: memoryStore(),
    provider,
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
  return { app, fetch, turn };
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

/** The Deepgram fallback's agent settings (these tests compose Deepgram explicitly). */
function agentOf(
  line: GateqVoiceStateDto["line"],
): Readonly<Record<string, unknown>> {
  return line?.provider === "deepgram" ? line.agent : {};
}

function bearerOf(agent: Record<string, unknown>): string {
  const header = JSON.stringify(agent).match(/Bearer ([A-Za-z0-9_-]+)/u);
  return header?.[1] ?? "";
}

const think = (
  app: ReturnType<typeof build>["app"],
  bearer: string,
  said: readonly string[],
) =>
  app.inject({
    method: "POST",
    url: `${GATEQ_VOICE_BRIDGE_PATH}/chat/completions`,
    headers: auth(bearer),
    payload: {
      model: "capital-q-gateq",
      stream: true,
      messages: [
        { role: "system", content: "relay" },
        { role: "assistant", content: "What does the company do?" },
        ...said.map((content) => ({ role: "user", content })),
      ],
    },
  });

describe("GateQ voice: the applicant's session by guest credential", () => {
  it("no credential, a forged one, or none at all is the same 404", async () => {
    const { app } = build();
    for (const headers of [{}, auth("gqs_forged"), auth("")]) {
      for (const [method, url] of [
        ["GET", GATEQ_APPLY_VOICE_PATH],
        ["POST", GATEQ_APPLY_VOICE_PATH],
      ] as const) {
        const response = await app.inject({
          method,
          url,
          headers,
          ...(method === "POST" ? { payload: {} } : {}),
        });
        expect(response.statusCode).toBe(404);
      }
    }
  });

  it("mints a short-lived line bound to this application: no provider key, no guest credential, no-store", async () => {
    const { app, fetch } = build();
    const { response, state } = await open(app);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(state.session?.status).toBe("LIVE");
    expect(state.session?.maxSeconds).toBe(180);
    expect(state.line?.token).toBe("short-lived-grant");
    const body = response.body;
    expect(body).not.toContain(PROVIDER_KEY);
    expect(body).not.toContain(TOKEN);
    // The think endpoint is this API's bridge under the line's own bearer.
    const agent = agentOf(state.line);
    expect(JSON.stringify(agent)).toContain(
      `https://api.example.test${GATEQ_VOICE_BRIDGE_PATH}/chat/completions`,
    );
    expect(bearerOf(agent).length).toBeGreaterThanOrEqual(32);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] ?? [];
    expect(init?.body).toBe(JSON.stringify({ ttl_seconds: 60 }));
    // A GET never hands out a line credential.
    const read = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth(TOKEN),
    });
    const after = GateqVoiceStateDtoSchema.parse(read.json());
    expect(after.line).toBeUndefined();
    expect(after.session?.id).toBe(state.session?.id);
  });

  it("another application's credential sees and ends nothing of this one", async () => {
    const { app } = build();
    const mine = await open(app);
    const other = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth(OTHER),
    });
    expect(GateqVoiceStateDtoSchema.parse(other.json()).session).toBeNull();
    const ended = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_VOICE_END_PATH,
      headers: auth(OTHER),
      payload: { continueByTyping: true },
    });
    expect(GateqVoiceStateDtoSchema.parse(ended.json()).session).toBeNull();
    const still = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth(TOKEN),
    });
    expect(GateqVoiceStateDtoSchema.parse(still.json()).session?.id).toBe(
      mine.state.session?.id,
    );
  });

  it("off: not offered, and starting says so plainly (409), typing untouched", async () => {
    const { app } = build({ enabled: false });
    const read = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth(TOKEN),
    });
    expect(GateqVoiceStateDtoSchema.parse(read.json())).toMatchObject({
      available: false,
      unavailableReason: "NOT_OFFERED",
    });
    const { response } = await app
      .inject({
        method: "POST",
        url: GATEQ_APPLY_VOICE_PATH,
        headers: auth(TOKEN),
        payload: {},
      })
      .then((r) => ({ response: r }));
    expect(response.statusCode).toBe(409);
    expect(response.json<{ detail: string }>().detail).toContain(
      "continue by typing",
    );
  });

  it("the provider refusing a token is an honest 409 and spends nothing", async () => {
    const { app } = build({ grant: 503 });
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth(TOKEN),
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ detail: string }>().detail).toBe(
      "The voice line isn't available right now. You can continue by typing.",
    );
  });

  it("the allowance runs out after the configured sessions", async () => {
    const { app } = build();
    for (let i = 0; i < 2; i += 1) {
      await open(app);
      await app.inject({
        method: "POST",
        url: GATEQ_APPLY_VOICE_END_PATH,
        headers: auth(TOKEN),
        payload: { continueByTyping: true },
      });
    }
    const read = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth(TOKEN),
    });
    expect(GateqVoiceStateDtoSchema.parse(read.json())).toMatchObject({
      available: false,
      unavailableReason: "APPLICATION_SESSIONS_USED",
      remaining: 0,
    });
    const refused = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_VOICE_PATH,
      headers: auth(TOKEN),
      payload: {},
    });
    expect(refused.statusCode).toBe(409);
  });
});

describe("GateQ voice: the speech provider's bridge", () => {
  it("refuses a missing or unknown bearer with 401, before any stream opens", async () => {
    const { app, turn } = build();
    await open(app);
    for (const headers of [{}, auth("x".repeat(43))]) {
      const response = await app.inject({
        method: "POST",
        url: `${GATEQ_VOICE_BRIDGE_PATH}/chat/completions`,
        headers,
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(response.statusCode).toBe(401);
    }
    expect(turn).not.toHaveBeenCalled();
  });

  it("each heard line is the canonical turn with channel voice, streamed back as Q's reply", async () => {
    const { app, turn } = build();
    const { state } = await open(app);
    const bearer = bearerOf(agentOf(state.line));
    const response = await think(app, bearer, ["We sell to banks."]);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("Q heard: We sell to banks.");
    expect(response.body).toContain("[DONE]");
    expect(turn).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        message: "We sell to banks.",
        channel: "voice",
      }),
    );
  });

  it("a failed turn is a spoken retry, not a broken stream", async () => {
    const { app } = build();
    const { state } = await open(app);
    const response = await think(app, bearerOf(agentOf(state.line)), ["boom"]);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(GATEQ_VOICE_RETRY_LINE);
  });

  it("after the applicant ends the line, the bridge only says time is up", async () => {
    const { app, turn } = build();
    const { state } = await open(app);
    await app.inject({
      method: "POST",
      url: GATEQ_APPLY_VOICE_END_PATH,
      headers: auth(TOKEN),
      payload: { continueByTyping: true },
    });
    const response = await think(app, bearerOf(agentOf(state.line)), [
      "One more thing",
    ]);
    expect(response.body).toContain("carry on by typing");
    expect(turn).not.toHaveBeenCalled();
  });
});
