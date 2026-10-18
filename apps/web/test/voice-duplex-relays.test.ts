import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RECOVERY A8 (C-08) and A11 (C-16): the duplex relays are plain fetches
 * through one route, never server actions (which Next.js runs one at a
 * time per tab), each with a deadline; the sealed line rides along so any
 * Q API instance can adopt it; a line the server no longer knows is
 * reported once as gone. No network: fetch is a fake.
 */

vi.mock("server-only", () => ({}));
vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({ qApiBaseUrl: "http://q-api.test" }),
}));
vi.mock("@/auth/session", () => ({
  getSessionAccessToken: () => Promise.resolve("session-bearer"),
}));

const { relayDuplex } =
  await import("../src/features/voice/duplex-relay-proxy");
const { POST } =
  await import("../app/api/q-voice-duplex/[voiceSessionId]/[relay]/route");
const { fetchDuplexRelays, ASK_RELAY_DEADLINE_MS } =
  await import("../src/features/voice/provider/duplex-relays");

const ID = "5f000000-0000-4000-8000-000000000001";
const ANSWER = {
  route: "ASK_Q",
  callId: "cq_1",
  arguments: "{}",
  output: '{"ok":true,"say":"Three fit."}',
  approvalPending: false,
  disposition: "ANSWERED",
};

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://web.test/api/q-voice-duplex/${ID}/heard`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("the duplex relay route", () => {
  it("forwards a valid turn with the person's own session and the sealed line, and validates the reply", async () => {
    const upstream = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(ANSWER)),
    );
    const response = await relayDuplex(
      request(
        { itemId: "item_1", transcript: "Who fits?" },
        { "x-q-voice-session": "sealed.token" },
      ),
      { voiceSessionId: ID, relay: "heard" },
      upstream,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ANSWER);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe(
      `http://q-api.test/v1/q/voice/sessions/${ID}/duplex/heard`,
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer session-bearer");
    expect(headers["x-q-voice-session"]).toBe("sealed.token");
  });

  it("refuses an unknown relay, a bad id and a body outside the contract", async () => {
    const upstream = vi.fn<typeof fetch>();
    expect(
      (
        await relayDuplex(
          request({}),
          { voiceSessionId: ID, relay: "run_sql" },
          upstream,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await relayDuplex(
          request({ itemId: null, transcript: "x" }),
          { voiceSessionId: "nope", relay: "heard" },
          upstream,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await relayDuplex(
          request({ transcript: "x", extra: true }),
          { voiceSessionId: ID, relay: "heard" },
          upstream,
        )
      ).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("keeps 'the line is gone' distinct from a failure, and never passes an invalid reply on", async () => {
    const gone = await relayDuplex(
      request({ itemId: null, transcript: "x" }),
      { voiceSessionId: ID, relay: "heard" },
      () => Promise.resolve(new Response(null, { status: 404 })),
    );
    expect(gone.status).toBe(404);
    const broken = await relayDuplex(
      request({ itemId: null, transcript: "x" }),
      { voiceSessionId: ID, relay: "heard" },
      () => Promise.resolve(Response.json({ route: "RUN_ANYTHING" })),
    );
    expect(broken.status).toBe(502);
  });

  it("answers 204 for the reports that carry no reply", async () => {
    const response = await relayDuplex(
      new Request(`http://web.test/api/q-voice-duplex/${ID}/outcome`, {
        method: "POST",
        body: JSON.stringify({
          turnId: "turn_abcdefgh01",
          disposition: "IGNORED",
        }),
      }),
      { voiceSessionId: ID, relay: "outcome" },
      () => Promise.resolve(new Response(null, { status: 204 })),
    );
    expect(response.status).toBe(204);
  });

  it("is exposed as a route handler", () => {
    expect(typeof POST).toBe("function");
  });
});

describe("the browser's duplex relays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("are fetches to the route, side by side, with the sealed line", async () => {
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const doFetch = vi.fn<typeof fetch>((url) => {
      const path =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      calls.push(path);
      if (path.endsWith("/heard")) {
        return new Promise((resolve) => {
          release = () => {
            resolve(Response.json(ANSWER));
          };
        });
      }
      return Promise.resolve(Response.json({ continue: true }));
    });
    const relays = fetchDuplexRelays({
      voiceSessionId: ID,
      sessionToken: "sealed.token",
      fetch: doFetch,
    });
    const heard = relays.heard?.({ itemId: null, transcript: "Who fits?" });
    // A usage report is not queued behind the long heard relay.
    const usage = await relays.usage({
      responseId: "r",
      inputTextTokens: 0,
      inputAudioTokens: 0,
      cachedTextTokens: 0,
      cachedAudioTokens: 0,
      outputTextTokens: 0,
      outputAudioTokens: 0,
    });
    expect(usage).toEqual({ continue: true });
    release();
    expect(await heard).toEqual(ANSWER);
    expect(calls).toEqual([
      `/api/q-voice-duplex/${ID}/heard`,
      `/api/q-voice-duplex/${ID}/usage`,
    ]);
    const init = doFetch.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)["x-q-voice-session"]).toBe(
      "sealed.token",
    );
  });

  it("give up at their deadline: the line gets null, never a hang", async () => {
    const relays = fetchDuplexRelays({
      voiceSessionId: ID,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    });
    const heard = relays.heard?.({ itemId: null, transcript: "Who fits?" });
    await vi.advanceTimersByTimeAsync(ASK_RELAY_DEADLINE_MS + 1);
    expect(await heard).toBeNull();
  });

  it("report a line the server no longer knows as gone; a rejoin that did not get through is retried", async () => {
    const onGone = vi.fn();
    const relays = fetchDuplexRelays({
      voiceSessionId: ID,
      onGone,
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
    });
    expect(await relays.heard?.({ itemId: null, transcript: "x" })).toBeNull();
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(await relays.rejoin?.("NETWORK")).toBeNull();
    const offline = fetchDuplexRelays({
      voiceSessionId: ID,
      fetch: () => Promise.reject(new Error("offline")),
    });
    await expect(offline.rejoin?.("NETWORK")).rejects.toThrow();
  });
});
