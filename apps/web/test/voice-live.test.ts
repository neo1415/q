import { describe, expect, it, vi } from "vitest";

/**
 * V: the GPT-Live delegation bridge and the developer preview gate. No
 * network and no provider: events are fed by hand, fetch is a fake.
 */

const runtime = { deploymentEnvironment: "local" };
vi.mock("server-only", () => ({}));
vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({ qApiBaseUrl: "http://q-api.test", runtime }),
}));
vi.mock("@/auth/session", () => ({
  getSessionAccessToken: () => Promise.resolve("session-bearer"),
}));

const { createLiveBridge, LIVE_APPEND_MAX_CHARS } =
  await import("../src/features/voice/live/bridge");
const { relayLive, voicePreviewEnabled } =
  await import("../src/features/voice/live/live-relay-proxy");

type Sent = { type: string; delegation_id: string | null; content: string };

function harness(options: { progressAfterMs?: number } = {}) {
  let clock = 0;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 0;
  const sent: Sent[] = [];
  const pending = new Map<
    string,
    (outcome: { commentary: string | null; stale?: boolean }) => void
  >();
  const asked: { delegationId: string; request: string }[] = [];
  const bridge = createLiveBridge({
    send: (event) => {
      sent.push(event);
    },
    delegate: (request) => {
      asked.push({
        delegationId: request.delegationId,
        request: request.request,
      });
      return new Promise((resolve) => {
        pending.set(request.delegationId, resolve);
      });
    },
    cancel: () => Promise.resolve(true),
    newEventId: () => `e${String(sent.length)}`,
    now: () => clock,
    settleMs: 300,
    progressAfterMs: options.progressAfterMs ?? 3_000,
    timers: {
      setTimeout: (run, ms) => {
        nextId += 1;
        timers.push({ at: clock + ms, run, id: nextId });
        return nextId;
      },
      clearTimeout: (handle) => {
        const index = timers.findIndex((t) => t.id === handle);
        if (index >= 0) timers.splice(index, 1);
      },
    },
  });
  const advance = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (next === undefined || next.at > until) break;
      timers.shift();
      clock = next.at;
      next.run();
    }
    clock = until;
  };
  const heard = (text: string) => {
    bridge.handle({ type: "session.input_transcript.delta", delta: text });
  };
  const said = (text: string) => {
    bridge.handle({ type: "session.output_transcript.delta", delta: text });
  };
  const delegation = (id: string) => {
    bridge.handle({
      type: "session.delegation.created",
      delegation: { id, type: "delegation", target: "client" },
    });
  };
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return {
    bridge,
    sent,
    asked,
    pending,
    advance,
    heard,
    said,
    delegation,
    settle,
  };
}

describe("the GPT-Live delegation bridge", () => {
  it("rebuilds the request from the person's words and speaks the verified result", async () => {
    const h = harness();
    h.heard(" What are the top three");
    h.heard(" companies for my mandate?");
    h.delegation("dlg_1");
    h.advance(400);
    expect(h.asked).toEqual([
      {
        delegationId: "dlg_1",
        request: "What are the top three companies for my mandate?",
      },
    ]);
    h.pending.get("dlg_1")?.({
      commentary: "Verified: Ledgerfold, Ajopot, Maji Loop.",
    });
    await h.settle();
    expect(h.sent).toEqual([
      expect.objectContaining({
        type: "session.commentary.append",
        delegation_id: "dlg_1",
        content: "Verified: Ledgerfold, Ajopot, Maji Loop.",
      }),
    ]);
  });

  it("waits for late words: a delegation can arrive before the transcript settles", () => {
    const h = harness();
    h.heard("Open");
    h.delegation("dlg_1");
    h.advance(100);
    h.heard(" Ajopot's profile");
    h.advance(100);
    expect(h.asked).toHaveLength(0);
    h.advance(400);
    expect(h.asked[0]?.request).toBe("Open Ajopot's profile");
  });

  it("runs one delegation id once, however often the provider repeats it", () => {
    const h = harness();
    h.heard("Top three");
    h.delegation("dlg_1");
    h.delegation("dlg_1");
    h.advance(400);
    h.delegation("dlg_1");
    h.advance(400);
    expect(h.asked).toHaveLength(1);
  });

  it("keeps a run going when the person talks over Q (an interruption is not a cancel)", async () => {
    const h = harness();
    h.heard("Research Ajopot");
    h.delegation("dlg_1");
    h.advance(400);
    h.said("Sure, I'm looking at");
    h.heard(" sorry, go on");
    h.advance(1_000);
    expect(h.asked).toHaveLength(1);
    h.pending.get("dlg_1")?.({ commentary: "Verified: Ajopot raised $2M." });
    await h.settle();
    expect(h.sent.at(-1)).toMatchObject({
      type: "session.commentary.append",
      delegation_id: "dlg_1",
    });
  });

  it("still speaks a slow answer when the newer request is only waiting (the founder's nudges)", async () => {
    const h = harness();
    h.heard("Give me three good examples");
    h.delegation("dlg_1");
    h.advance(400);
    h.heard(" still waiting, can you do it or not");
    h.delegation("dlg_2");
    h.advance(400);
    h.pending.get("dlg_1")?.({
      commentary: "Verified: Tensorgate, Ledgerline, Tarmacly.",
      stale: true,
    });
    await h.settle();
    const spoken = h.sent.filter((e) => e.type === "session.commentary.append");
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.delegation_id).toBe("dlg_1");
    expect(spoken[0]?.content).toContain("Tensorgate, Ledgerline, Tarmacly");
  });

  it("keeps a late result as quiet context once a newer question has been answered", async () => {
    const h = harness();
    h.heard("Top three companies");
    h.delegation("dlg_1");
    h.advance(400);
    h.heard(" wait, what about the second one?");
    h.delegation("dlg_2");
    h.advance(400);
    expect(h.asked[1]?.request).toBe("wait, what about the second one?");
    h.pending.get("dlg_2")?.({ commentary: "Verified: B is second because…" });
    await h.settle();
    h.pending.get("dlg_1")?.({ commentary: "Verified list: A, B, C." });
    await h.settle();
    expect(h.sent.at(-1)).toMatchObject({
      type: "session.thinking.append",
      delegation_id: "dlg_1",
    });
    const spoken = h.sent.filter((e) => e.type === "session.commentary.append");
    expect(spoken.map((e) => e.delegation_id)).toEqual(["dlg_2"]);
  });

  it("does not speak what the server marked stale", async () => {
    const h = harness();
    h.heard("Top three");
    h.delegation("dlg_1");
    h.advance(400);
    h.pending.get("dlg_1")?.({ commentary: "Verified.", stale: true });
    await h.settle();
    expect(h.sent.every((e) => e.type !== "session.commentary.append")).toBe(
      true,
    );
  });

  it("says one natural progress line after about five seconds, never repeated", () => {
    const h = harness({ progressAfterMs: 5_000 });
    h.heard("Give me three good examples");
    h.delegation("dlg_1");
    h.advance(400);
    h.advance(4_000);
    expect(h.sent).toHaveLength(0);
    h.advance(30_000);
    const progress = h.sent.filter(
      (e) => e.type === "session.commentary.append",
    );
    expect(progress).toHaveLength(1);
    expect(progress[0]?.content).toContain("Give me three good examples");
    expect(progress[0]?.content).toContain("do not say this again");
  });

  it("sends typed words straight to Q Brain and speaks the answer", async () => {
    const h = harness();
    h.bridge.typed("Open Ajopot");
    expect(h.asked).toEqual([
      { delegationId: "typed_1", request: "Open Ajopot" },
    ]);
    h.pending.get("typed_1")?.({ commentary: "Verified: Ajopot is open." });
    await h.settle();
    expect(h.sent.at(-1)).toMatchObject({
      type: "session.commentary.append",
      delegation_id: null,
    });
  });

  it("opens with Q's own opening in hand: one instruction, no extra run", () => {
    const sent: Sent[] = [];
    const asked: string[] = [];
    const bridge = createLiveBridge({
      send: (event) => {
        sent.push(event);
      },
      delegate: (request) => {
        asked.push(request.request);
        return Promise.resolve({ commentary: null });
      },
      newEventId: () => "e",
      now: () => 0,
      opening: {
        greeting: "Greet Amaka.",
        content: "Nineteen things need your eyes. Spheros is waiting.",
      },
    });
    bridge.handle({ type: "session.started" });
    expect(asked).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("session.instructions.append");
    expect(sent[0]?.content).toContain("never repeat card or screen text");
    expect(sent[0]?.content).toContain("Spheros is waiting");
  });

  it("tells the voice nothing was cancelled until the server confirms", async () => {
    const h = harness();
    h.heard("Research Ajopot");
    h.delegation("dlg_1");
    h.advance(400);
    expect(await h.bridge.cancel("dlg_1")).toBe(true);
    expect(h.bridge.state().delegations[0]?.status).toBe("CANCELLED");
    h.pending.get("dlg_1")?.({ commentary: "Verified: too late." });
    await h.settle();
    expect(h.sent.some((e) => e.type === "session.commentary.append")).toBe(
      false,
    );
  });

  it("matches acknowledgements and refusals to its own events, and bounds content", async () => {
    const h = harness();
    h.heard("Top three");
    h.delegation("dlg_1");
    h.advance(400);
    h.pending.get("dlg_1")?.({ commentary: "x".repeat(5_000) });
    await h.settle();
    const event = h.sent[0];
    expect(event?.content.length).toBeLessThanOrEqual(LIVE_APPEND_MAX_CHARS);
    h.bridge.handle({
      type: "session.commentary.appended",
      client_event_id: "e0",
    });
    h.bridge.handle({
      type: "session.commentary.appended",
      client_event_id: "nope",
    });
    expect(h.bridge.state().acked).toBe(1);
  });

  it("opens with a greeting at once and speaks the briefing when Q Brain answers", async () => {
    const sent: Sent[] = [];
    const asked: string[] = [];
    let answer: (o: { commentary: string }) => void = () => undefined;
    const bridge = createLiveBridge({
      send: (event) => {
        sent.push(event);
      },
      delegate: (request) => {
        asked.push(request.request);
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
      newEventId: () => `e${String(sent.length)}`,
      now: () => 0,
      opening: { greeting: "Greet them now.", request: "Brief me." },
    });
    bridge.handle({
      type: "session.started",
      session: { model: "gpt-live-1" },
    });
    bridge.handle({
      type: "session.started",
      session: { model: "gpt-live-1" },
    });
    expect(sent[0]).toMatchObject({
      type: "session.instructions.append",
      delegation_id: null,
      content: "Greet them now.",
    });
    expect(asked).toEqual(["Brief me."]);
    answer({ commentary: "Verified: two companies tied at the top." });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      type: "session.commentary.append",
      delegation_id: null,
    });
  });

  it("ignores a delegation for another target", () => {
    const h = harness();
    h.heard("Top three");
    h.bridge.handle({
      type: "session.delegation.created",
      delegation: { id: "dlg_x", target: "responses" },
    });
    h.advance(400);
    expect(h.asked).toHaveLength(0);
  });
});

describe("the voice preview gate", () => {
  it("is open only in a local deployment with the explicit flag", () => {
    runtime.deploymentEnvironment = "local";
    expect(voicePreviewEnabled({ CQ_VOICE_PREVIEW: "on" })).toBe(true);
    expect(voicePreviewEnabled({})).toBe(false);
    expect(
      voicePreviewEnabled({ CQ_VOICE_PREVIEW: "on", NODE_ENV: "production" }),
    ).toBe(false);
    runtime.deploymentEnvironment = "production";
    expect(voicePreviewEnabled({ CQ_VOICE_PREVIEW: "on" })).toBe(false);
    runtime.deploymentEnvironment = "local";
  });

  it("answers 404 and never calls upstream when the gate is closed", async () => {
    const upstream = vi.fn<typeof fetch>();
    const response = await relayLive(
      new Request("http://web.test/api/q-voice-live/open", {
        method: "POST",
        body: JSON.stringify({ sdp: "v=0 offer sdp" }),
      }),
      { relay: "open" },
      { doFetch: upstream, enabled: () => false },
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("relays a valid delegation with the person's session when open", async () => {
    const upstream = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          delegationId: "dlg_1",
          commentary: "Verified.",
          stale: false,
          approvalPending: false,
          failed: false,
        }),
      ),
    );
    const id = "5f000000-0000-4000-8000-000000000001";
    const response = await relayLive(
      new Request(`http://web.test/api/q-voice-live/delegate/${id}`, {
        method: "POST",
        body: JSON.stringify({ delegationId: "dlg_1", request: "Top three" }),
      }),
      { relay: "delegate", voiceSessionId: id },
      { doFetch: upstream, enabled: () => true },
    );
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe(
      `http://q-api.test/v1/q/voice/live/sessions/${id}/delegations`,
    );
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer session-bearer",
    );
  });
});
