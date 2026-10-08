// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CreateQVoiceSessionResponse,
  QVoiceDuplexCredential,
  QVoiceDuplexToolResult,
  QVoiceDuplexUsageResult,
} from "@capital-q/contracts";

import {
  BARGE_CONFIRM_MS,
  BARGE_DUCK_GAIN,
  DuplexLine,
  usageReportOf,
  type DuplexEnvironment,
  type DuplexLineEvents,
  type DuplexRelays,
} from "../src/features/voice/provider/duplex-line";
import { LINE_LOST_NOTICE } from "../src/features/voice/provider/line-health";

/**
 * DUPLEX in the browser, with a fake RTCPeerConnection and data channel:
 * no network, no provider, no key. Barge-in silences Q at once and cancels
 * and truncates what was not heard; every failure falls back; a tool call
 * goes to the server relay and nothing else; idle ends the line.
 */

class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  readonly sent: Record<string, unknown>[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly label: string;
  constructor(label: string) {
    this.label = label;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  emit(event: Record<string, unknown>) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(event) }),
    );
  }
  types() {
    return this.sent.map((event) => event.type);
  }
}

class FakePeer {
  channel: FakeChannel | null = null;
  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
  readonly tracks: unknown[] = [];
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  createDataChannel(label: string) {
    this.channel = new FakeChannel(label);
    return this.channel;
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "v=0 offer" });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription() {
    // The provider's side opens the events channel once it has answered.
    queueMicrotask(() => this.channel?.open());
    return Promise.resolve();
  }
  close() {
    this.closed = true;
  }
  fail() {
    this.connectionState = "failed";
    this.onconnectionstatechange?.();
  }
}

const CREDENTIAL: QVoiceDuplexCredential = {
  clientSecret: "ek_fake_secret",
  callsUrl: "https://realtime.invalid/v1/realtime/calls",
  expiresAt: "2099-01-01T00:00:00.000Z",
  maxSessionMs: 600_000,
  idleMs: 30_000,
};

function harness(
  options: {
    readonly answer?: () => Promise<Response>;
    readonly tool?: () => Promise<QVoiceDuplexToolResult | null>;
    readonly usage?: () => Promise<QVoiceDuplexUsageResult | null>;
    readonly microphone?: () => Promise<MediaStream>;
    readonly narration?: DuplexRelays["narration"];
    readonly env?: Partial<DuplexEnvironment>;
    readonly credential?: QVoiceDuplexCredential;
    readonly heard?: DuplexRelays["heard"];
    readonly cardInFocus?: () => boolean;
  } = {},
) {
  const peer = new FakePeer();
  const track = { enabled: true, stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const audio = { volume: 1, srcObject: null, autoplay: true };
  const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];
  const environment: DuplexEnvironment = {
    createPeer: () => peer as unknown as RTCPeerConnection,
    getMicrophone: options.microphone ?? (() => Promise.resolve(stream)),
    fetch: (input, init) => {
      fetchCalls.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        init,
      });
      return (
        options.answer?.() ??
        Promise.resolve(new Response("v=0 answer", { status: 201 }))
      );
    },
    createAudio: () => audio as unknown as HTMLAudioElement,
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    ...options.env,
  };
  const relays = {
    tool: vi.fn<DuplexRelays["tool"]>(
      options.tool ??
        (() =>
          Promise.resolve({
            output: JSON.stringify({
              ok: true,
              say: "Your raise is on track.",
            }),
            approvalPending: false,
          })),
    ),
    usage: vi.fn<DuplexRelays["usage"]>(
      options.usage ?? (() => Promise.resolve({ continue: true })),
    ),
    end: vi.fn<DuplexRelays["end"]>(() => Promise.resolve()),
    ...(options.narration === undefined
      ? {}
      : { narration: options.narration }),
    ...(options.heard === undefined
      ? {}
      : {
          heard: vi.fn<NonNullable<DuplexRelays["heard"]>>(options.heard),
          said: vi.fn<NonNullable<DuplexRelays["said"]>>(() =>
            Promise.resolve(),
          ),
        }),
  };
  const events = {
    onState: vi.fn<DuplexLineEvents["onState"]>(),
    onLine: vi.fn<DuplexLineEvents["onLine"]>(),
    onInterrupted: vi.fn<DuplexLineEvents["onInterrupted"]>(),
    onFallback: vi.fn<DuplexLineEvents["onFallback"]>(),
    onEnded: vi.fn<DuplexLineEvents["onEnded"]>(),
    ...(options.cardInFocus === undefined
      ? {}
      : { cardInFocus: options.cardInFocus }),
  };
  const line = new DuplexLine({
    credential: options.credential ?? CREDENTIAL,
    relays,
    events,
    environment,
  });
  const channel = () => {
    if (peer.channel === null) throw new Error("no channel");
    return peer.channel;
  };
  return { line, peer, channel, audio, track, relays, events, fetchCalls };
}

/** Let promise chains (the relay, the answer) settle. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("opening the duplex line", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers to the provider with the minted secret only, on the events channel", async () => {
    const h = harness();
    expect(await h.line.open()).toBe(true);
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]?.url).toBe(CREDENTIAL.callsUrl);
    expect(
      (h.fetchCalls[0]?.init?.headers as Record<string, string>).authorization,
    ).toBe("Bearer ek_fake_secret");
    expect(h.channel().label).toBe("oai-events");
    expect(h.events.onState).toHaveBeenLastCalledWith("LISTENING");
  });

  it("falls back before it came up when the offer is refused, and lets the microphone go", async () => {
    const h = harness({
      answer: () => Promise.resolve(new Response("no", { status: 401 })),
    });
    expect(await h.line.open()).toBe(false);
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "CONNECT",
      notice: null,
      connected: false,
    });
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.peer.closed).toBe(true);
  });

  it("falls back when there is no microphone", async () => {
    const h = harness({
      microphone: () => Promise.reject(new Error("NotAllowedError")),
    });
    expect(await h.line.open()).toBe(false);
    expect(h.events.onFallback).toHaveBeenCalledTimes(1);
  });
});

describe("Q speaks first, and never over a reply (founder live 2026-10-05)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the opening as its own turn the moment the line is up", async () => {
    const h = harness();
    await h.line.open();
    const channel = h.channel();
    const before = channel.sent.length;
    h.line.speakFirst("What is your company called?");
    const sent = channel.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "response.create",
      response: { tool_choice: "none" },
    });
    expect(JSON.stringify(sent[0])).toContain("What is your company called?");
    expect(h.events.onState).toHaveBeenLastCalledWith("THINKING");
  });

  it("does not start an opening over a reply already in flight", async () => {
    const h = harness();
    await h.line.open();
    const channel = h.channel();
    channel.emit({ type: "response.created", response: { id: "resp_1" } });
    const before = channel.sent.length;
    h.line.speakFirst("What is your company called?");
    expect(channel.sent.length).toBe(before);
  });

  it("cuts Q's reply before a typed turn, rather than starting a second response on top", async () => {
    const h = harness();
    await h.line.open();
    const channel = h.channel();
    channel.emit({ type: "response.created", response: { id: "resp_1" } });
    channel.emit({ type: "output_audio_buffer.started" });
    const before = channel.sent.length;
    h.line.sendText("Actually, we're pre-seed.");
    const types = channel.types().slice(before);
    expect(types.indexOf("response.cancel")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("response.cancel")).toBeLessThan(
      types.lastIndexOf("response.create"),
    );
    expect(types.filter((type) => type === "response.create")).toHaveLength(1);
  });
});

describe("barge-in", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("silences Q once speech over it lasts, cancels the response and truncates to what was heard", async () => {
    const h = harness();
    await h.line.open();
    const channel = h.channel();
    channel.emit({ type: "response.created", response: { id: "resp_1" } });
    channel.emit({
      type: "response.output_item.added",
      item: { id: "item_1", type: "message" },
    });
    channel.emit({ type: "output_audio_buffer.started" });
    vi.advanceTimersByTime(800);
    channel.emit({ type: "input_audio_buffer.speech_started" });
    // Listening first: Q dips, nothing is cancelled yet.
    expect(h.audio.volume).toBeCloseTo(BARGE_DUCK_GAIN);
    expect(channel.sent).toEqual([]);
    vi.advanceTimersByTime(BARGE_CONFIRM_MS);

    expect(h.audio.volume).toBe(0);
    expect(h.events.onInterrupted).toHaveBeenCalledTimes(1);
    expect(channel.types()).toEqual([
      "response.cancel",
      "output_audio_buffer.clear",
      "conversation.item.truncate",
    ]);
    expect(channel.sent[2]).toMatchObject({
      item_id: "item_1",
      content_index: 0,
      audio_end_ms: 1_250,
    });
    // Q's next reply is heard again.
    channel.emit({ type: "response.created", response: { id: "resp_2" } });
    expect(h.audio.volume).toBe(1);
  });

  it("rides through a blip over Q: no cut, volume back, and the blip is never answered (founder live 2026-10-07)", async () => {
    const h = harness();
    await h.line.open();
    const channel = h.channel();
    channel.emit({ type: "response.created", response: { id: "resp_1" } });
    channel.emit({
      type: "response.output_item.added",
      item: { id: "item_1", type: "message" },
    });
    channel.emit({ type: "output_audio_buffer.started" });
    vi.advanceTimersByTime(600);
    channel.emit({ type: "input_audio_buffer.speech_started" });
    vi.advanceTimersByTime(200);
    channel.emit({ type: "input_audio_buffer.speech_stopped" });
    channel.emit({ type: "input_audio_buffer.committed", item_id: "blip_1" });
    vi.advanceTimersByTime(BARGE_CONFIRM_MS * 2);

    expect(h.events.onInterrupted).not.toHaveBeenCalled();
    expect(h.audio.volume).toBe(1);
    // C-11: the blip waits for its words; a cough has none and is let go.
    channel.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "blip_1",
      transcript: "",
    });
    expect(channel.types()).toEqual(["conversation.item.delete"]);
    expect(channel.sent[0]).toMatchObject({ item_id: "blip_1" });
  });

  it("is only listening when the person speaks while Q is quiet", async () => {
    const h = harness();
    await h.line.open();
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    expect(h.channel().sent).toEqual([]);
    expect(h.events.onInterrupted).not.toHaveBeenCalled();
  });
});

describe("tool calls and usage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a function call to the server relay and returns its output to the model", async () => {
    const h = harness();
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_1",
      name: "ask_q",
      arguments: JSON.stringify({ request: "How is my raise going?" }),
    });
    await settle();
    expect(h.relays.tool).toHaveBeenCalledWith({
      callId: "call_1",
      name: "ask_q",
      arguments: JSON.stringify({ request: "How is my raise going?" }),
    });
    expect(h.events.onLine).toHaveBeenCalledWith(
      "user",
      "How is my raise going?",
    );
    expect(h.channel().types()).toEqual([
      "conversation.item.create",
      "response.create",
    ]);
    expect(h.channel().sent[0]).toMatchObject({
      item: { type: "function_call_output", call_id: "call_1" },
    });
  });

  it("voices the silence ladder's beats out of band while ask_q works (ADR 0062)", async () => {
    let finish: () => void = () => undefined;
    const narration = vi.fn<NonNullable<DuplexRelays["narration"]>>((after) =>
      Promise.resolve(
        after === 0
          ? {
              beats: [
                { sequence: 1, beat: { kind: "TONE" } },
                {
                  sequence: 2,
                  beat: { kind: "STAGE_LINE", text: "Looking at the deck…" },
                },
              ],
              idle: false,
            }
          : { beats: [], idle: true },
      ),
    );
    const h = harness({
      narration,
      tool: () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({
              output: JSON.stringify({ ok: true, say: "Done." }),
              approvalPending: false,
            });
          };
        }),
    });
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_n",
      name: "ask_q",
      arguments: JSON.stringify({ request: "Look at the deck." }),
    });
    await settle();
    expect(narration).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    await settle();
    expect(narration).toHaveBeenCalledWith(0);
    const spoken = h
      .channel()
      .sent.filter(
        (event) =>
          (event as { type?: string }).type === "response.create" &&
          JSON.stringify(event).includes("Looking at the deck"),
      );
    expect(spoken).toHaveLength(1);
    // Out of band, no tools: nothing it says enters the conversation.
    expect(spoken[0]).toMatchObject({
      response: { conversation: "none", tools: [], tool_choice: "none" },
    });
    // W4b: what the beat said comes back as a transcript; it is never a
    // line of the visible (or saved) conversation.
    const metadata = (spoken[0] as { response: { metadata: unknown } }).response
      .metadata;
    h.channel().emit({
      type: "response.created",
      response: { id: "resp_beat", metadata },
    });
    h.channel().emit({
      type: "response.output_audio_transcript.done",
      response_id: "resp_beat",
      transcript: "Looking at the deck…",
    });
    h.channel().emit({
      type: "response.done",
      response: { id: "resp_beat", status: "completed", metadata },
    });
    await settle();
    expect(
      h.events.onLine.mock.calls.some(
        ([role, said]) => role === "q" && said.includes("Looking at the deck"),
      ),
    ).toBe(false);
    finish();
    await settle();
  });

  it("reconnects the narration poll after a dropped connection, and says one bridge for the turn (R9, INC-1)", async () => {
    let finish: () => void = () => undefined;
    const beat = (sequence: number, text: string) => ({
      sequence,
      beat: { kind: "STAGE_LINE" as const, text },
    });
    let calls = 0;
    const narration = vi.fn<NonNullable<DuplexRelays["narration"]>>(() => {
      calls += 1;
      // The network drops: once as nothing, once as a throw.
      if (calls === 1) return Promise.resolve(null);
      if (calls === 2) return Promise.reject(new TypeError("Failed to fetch"));
      // Back: two beats are waiting; one bridge per turn is said (INC-1).
      return Promise.resolve({
        beats: [beat(1, "Reading the deck…"), beat(2, "Checking the numbers…")],
        idle: false,
      });
    });
    const h = harness({
      narration,
      tool: () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({
              output: JSON.stringify({ ok: true, say: "Done." }),
              approvalPending: false,
            });
          };
        }),
    });
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_r",
      name: "ask_q",
      arguments: JSON.stringify({ request: "Look at the deck." }),
    });
    const said = (words: string) =>
      h
        .channel()
        .sent.filter(
          (event) =>
            (event as { type?: string }).type === "response.create" &&
            JSON.stringify(event).includes(words),
        ).length;
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(narration.mock.calls.map(([after]) => after)).toEqual([0, 0, 0]);
    expect(said("Reading the deck")).toBe(1);
    expect(said("Checking the numbers")).toBe(0);
    // And no more polls for this turn: its one bridge is said.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(narration).toHaveBeenCalledTimes(3);
    finish();
    await settle();
  });

  it("offline, the narration poll waits for the connection instead of going quiet (W7)", async () => {
    let finish: () => void = () => undefined;
    const beat = (sequence: number, text: string) => ({
      sequence,
      beat: { kind: "STAGE_LINE" as const, text },
    });
    let online = false;
    const listeners = new Set<() => void>();
    const narration = vi.fn<NonNullable<DuplexRelays["narration"]>>(() => {
      if (!online) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({
        beats: [beat(1, "Reading the deck…"), beat(2, "Checking the numbers…")],
        idle: true,
      });
    });
    const h = harness({
      narration,
      env: {
        isOnline: () => online,
        onOnline: (handler) => {
          listeners.add(handler);
          return () => {
            listeners.delete(handler);
          };
        },
      },
      tool: () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({
              output: JSON.stringify({ ok: true, say: "Done." }),
              approvalPending: false,
            });
          };
        }),
    });
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_o",
      name: "ask_q",
      arguments: JSON.stringify({ request: "Look at the deck." }),
    });
    const said = (words: string) =>
      h
        .channel()
        .sent.filter(
          (event) =>
            (event as { type?: string }).type === "response.create" &&
            JSON.stringify(event).includes(words),
        ).length;
    // Well past the old ~5.6 s give-up: one failed poll, then it waits.
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(narration).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    // Back online: it polls again at once.
    online = true;
    for (const listener of [...listeners]) listener();
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(narration).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(0);
    expect(said("Reading the deck")).toBe(1);
    expect(said("Checking the numbers")).toBe(0);
    finish();
    await settle();
  });

  it("offline wait ends with the ask_q: no poll after the answer (W7)", async () => {
    let finish: () => void = () => undefined;
    let calls = 0;
    const narration = vi.fn<NonNullable<DuplexRelays["narration"]>>(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({ beats: [], idle: true });
    });
    const listeners = new Set<() => void>();
    let online = false;
    const h = harness({
      narration,
      env: {
        isOnline: () => online,
        onOnline: (handler) => {
          listeners.add(handler);
          return () => {
            listeners.delete(handler);
          };
        },
      },
      tool: () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({
              output: JSON.stringify({ ok: true, say: "Done." }),
              approvalPending: false,
            });
          };
        }),
    });
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_p",
      name: "ask_q",
      arguments: JSON.stringify({ request: "Look." }),
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(narration).toHaveBeenCalledTimes(1);
    finish();
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(listeners.size).toBe(0);
    online = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(narration).toHaveBeenCalledTimes(1);
  });

  it("does not speak a tool result the person talked over", async () => {
    let finish: (value: QVoiceDuplexToolResult) => void = () => undefined;
    const h = harness({
      tool: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await h.line.open();
    h.channel().emit({ type: "response.created", response: { id: "r" } });
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_2",
      name: "ask_q",
      arguments: '{"request":"x"}',
    });
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    finish({ output: '{"ok":true}', approvalPending: false });
    await settle();
    expect(h.channel().types()).not.toContain("response.create");
  });

  it("keeps the line when a tool relay does not get through, and has Q say so (I1)", async () => {
    const h = harness({ tool: () => Promise.resolve(null) });
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_3",
      name: "get_thing",
      arguments: "{}",
    });
    await settle();
    expect(h.events.onFallback).not.toHaveBeenCalled();
    const output = h
      .channel()
      .sent.find(
        (event) =>
          (event.item as { type?: string } | undefined)?.type ===
          "function_call_output",
      );
    expect(JSON.stringify(output)).toContain("did not get through");
    expect(h.channel().types()).toContain("response.create");
  });

  it("reports each response's usage and falls back with the cap's sentence", async () => {
    const notice =
      "I've reached today's limit for live voice, so I'm switching to my standard voice.";
    const h = harness({
      usage: () => Promise.resolve({ continue: false, notice }),
    });
    await h.line.open();
    h.channel().emit({
      type: "response.done",
      response: {
        id: "resp_9",
        usage: {
          input_token_details: {
            text_tokens: 900,
            audio_tokens: 300,
            cached_tokens_details: { text_tokens: 800, audio_tokens: 0 },
          },
          output_token_details: { text_tokens: 40, audio_tokens: 500 },
        },
      },
    });
    await settle();
    expect(h.relays.usage).toHaveBeenCalledWith({
      responseId: "resp_9",
      inputTextTokens: 900,
      inputAudioTokens: 300,
      cachedTextTokens: 800,
      cachedAudioTokens: 0,
      outputTextTokens: 40,
      outputAudioTokens: 500,
    });
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "CAP",
      notice,
      connected: true,
    });
  });

  it("maps an empty or hostile usage block to zero counts", () => {
    expect(
      usageReportOf("r", { input_token_details: { text_tokens: -3 } }),
    ).toEqual({
      responseId: "r",
      inputTextTokens: 0,
      inputAudioTokens: 0,
      cachedTextTokens: 0,
      cachedAudioTokens: 0,
      outputTextTokens: 0,
      outputAudioTokens: 0,
    });
  });
});

describe("the line's own limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends after the idle window of silence", async () => {
    const h = harness();
    await h.line.open();
    vi.advanceTimersByTime(CREDENTIAL.idleMs + 10);
    expect(h.events.onEnded).toHaveBeenCalledWith("IDLE");
    expect(h.relays.end).toHaveBeenCalledWith(
      "IDLE",
      expect.objectContaining({ stats: expect.any(Object) as unknown }),
    );
    expect(h.track.stop).toHaveBeenCalled();
  });

  it("does not end idle while Q is still working on a request", async () => {
    let answer: (value: QVoiceDuplexToolResult | null) => void = () => {};
    const h = harness({
      tool: () =>
        new Promise<QVoiceDuplexToolResult | null>((resolve) => {
          answer = resolve;
        }),
    });
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_slow",
      name: "ask_q",
      arguments: JSON.stringify({ request: "Compare the two companies" }),
    });
    await settle();
    vi.advanceTimersByTime(CREDENTIAL.idleMs * 2);
    expect(h.events.onEnded).not.toHaveBeenCalled();
    answer({ output: JSON.stringify({ ok: true }), approvalPending: false });
    await settle();
    vi.advanceTimersByTime(CREDENTIAL.idleMs * 2);
    expect(h.events.onEnded).toHaveBeenCalledWith("IDLE");
  });

  it("hands over at its maximum length when it cannot rejoin", async () => {
    const h = harness();
    await h.line.open();
    // Keep it busy so idle does not end it first.
    for (let at = 0; at < CREDENTIAL.maxSessionMs; at += 20_000) {
      h.channel().emit({ type: "input_audio_buffer.speech_started" });
      vi.advanceTimersByTime(20_000);
    }
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "MAX_LENGTH",
      notice: null,
      connected: true,
    });
    expect(h.relays.end).toHaveBeenCalledWith(
      "MAX_LENGTH",
      expect.objectContaining({ cause: "MAX_LENGTH" }),
    );
  });

  it("falls back when the network drops and it cannot rejoin", async () => {
    const h = harness();
    await h.line.open();
    h.peer.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "NETWORK",
      notice: LINE_LOST_NOTICE,
      connected: true,
    });
  });
});

// The hook: a duplex credential that does not come up is the standard line
// on the same credential, at once.
const deepgramStart = vi.fn(() => Promise.resolve());
const duplexStart = vi.fn(() => Promise.resolve(false));
const fake = (start: (...args: unknown[]) => Promise<unknown>) => ({
  state: "IDLE" as const,
  connected: false,
  muted: false,
  transcript: [],
  start,
  end: () => Promise.resolve(),
  sendText: () => undefined,
  setMuted: () => undefined,
  setVolume: () => undefined,
  inputLevel: () => 0,
  outputLevel: () => 0,
});
vi.mock("../src/features/voice/provider/deepgram-session", () => ({
  useDeepgramVoiceSession: () => fake(deepgramStart),
}));
vi.mock("../src/features/voice/provider/elevenlabs-session", () => ({
  useElevenLabsVoiceSession: () => fake(() => Promise.resolve()),
}));
vi.mock("../src/features/voice/provider/duplex-session", () => ({
  useDuplexVoiceSession: () => fake(duplexStart),
}));

const { useVoiceSession } =
  await import("../src/features/voice/use-voice-session");

const STANDARD: CreateQVoiceSessionResponse = {
  voiceSessionId: "5f000000-0000-4000-8000-000000000001",
  providerConversationId: "dg_5f000000-0000-4000-8000-000000000001",
  token: "dg_fake",
  voice: "FEMALE",
  expiresAt: "2099-01-01T00:00:00.000Z",
  provider: "deepgram",
  deepgram: { agent: {}, audio: {} },
};

describe("choosing the line", () => {
  beforeEach(() => {
    deepgramStart.mockClear();
    duplexStart.mockClear();
  });

  it("opens the standard line on the same credential when duplex does not come up", async () => {
    const { result } = renderHook(() => useVoiceSession());
    await act(async () => {
      await result.current.start({
        credential: { ...STANDARD, duplex: CREDENTIAL },
      });
    });
    expect(duplexStart).toHaveBeenCalledTimes(1);
    expect(deepgramStart).toHaveBeenCalledTimes(1);
  });

  it("never tries duplex without a duplex credential", async () => {
    const { result } = renderHook(() => useVoiceSession());
    await act(async () => {
      await result.current.start({ credential: STANDARD });
    });
    expect(duplexStart).not.toHaveBeenCalled();
    expect(deepgramStart).toHaveBeenCalledTimes(1);
  });

  it("stays on duplex when it comes up", async () => {
    duplexStart.mockImplementationOnce(() => Promise.resolve(true));
    const { result } = renderHook(() => useVoiceSession());
    await act(async () => {
      await result.current.start({
        credential: { ...STANDARD, duplex: CREDENTIAL },
      });
    });
    expect(deepgramStart).not.toHaveBeenCalled();
  });
});

/**
 * VOICE-BRAIN (founder live 2026-10-08): on a routed line the realtime
 * model never answers a turn by itself. Each finished turn's transcript
 * goes to the server, which runs Q for a substantive one; the voice only
 * says the result.
 */
describe("the server decides who answers each turn (VOICE-BRAIN)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const ROUTED: QVoiceDuplexCredential = { ...CREDENTIAL, routeTurns: true };
  const finish = (
    h: ReturnType<typeof harness>,
    itemId: string,
    transcript: string | null,
  ) => {
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    h.channel().emit({ type: "input_audio_buffer.speech_stopped" });
    h.channel().emit({ type: "input_audio_buffer.committed", item_id: itemId });
    if (transcript !== null) {
      h.channel().emit({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: itemId,
        transcript,
      });
    }
  };

  it("hands a substantive turn to Q even though the model never called ask_q, then has the voice say Q's answer", async () => {
    const h = harness({
      credential: ROUTED,
      heard: () =>
        Promise.resolve({
          route: "ASK_Q" as const,
          callId: "cq_1",
          arguments: JSON.stringify({ request: "Open my pitch deck." }),
          output: JSON.stringify({
            ok: true,
            say: "It's open on your screen.",
          }),
          approvalPending: false,
        }),
    });
    await h.line.open();
    finish(h, "item_1", "Open my pitch deck.");
    await settle();
    expect(h.relays.heard).toHaveBeenCalledWith({
      itemId: "item_1",
      transcript: "Open my pitch deck.",
      // INC-1: the turn's id, which its `said` confirmation echoes.
      turnId: expect.stringMatching(/^turn_/u) as unknown,
    });
    expect(h.events.onLine).toHaveBeenCalledWith(
      "user",
      "Open my pitch deck.",
      expect.stringMatching(/^turn_/u),
    );
    const sent = h.channel().sent;
    expect(sent.map((e) => (e as { type: string }).type)).toEqual([
      "conversation.item.create",
      "conversation.item.create",
      "response.create",
    ]);
    expect(sent[0]).toMatchObject({
      item: { type: "function_call", call_id: "cq_1", name: "ask_q" },
    });
    expect(sent[1]).toMatchObject({
      item: { type: "function_call_output", call_id: "cq_1" },
    });
    // The voice only says it: it may not call anything for this reply.
    expect(sent[2]).toMatchObject({ response: { tool_choice: "none" } });
    // And what it said goes to the line's transcript.
    h.channel().emit({
      type: "response.output_audio_transcript.done",
      response_id: "resp_1",
      transcript: "It's open on your screen.",
    });
    await settle();
    expect(h.relays.said).toHaveBeenCalledWith({
      responseId: "resp_1",
      text: "It's open on your screen.",
    });
  });

  it("lets the voice answer small talk itself", async () => {
    const h = harness({
      credential: ROUTED,
      heard: () => Promise.resolve({ route: "SMALLTALK" as const }),
    });
    await h.line.open();
    finish(h, "item_1", "Thanks!");
    await settle();
    expect(h.channel().types()).toEqual(["response.create"]);
    expect(h.relays.tool).not.toHaveBeenCalled();
  });

  it("says nothing to a turn transcribed as nothing (noise)", async () => {
    const h = harness({
      credential: ROUTED,
      heard: () => Promise.resolve({ route: "SMALLTALK" as const }),
    });
    await h.line.open();
    finish(h, "item_noise", "");
    await settle();
    expect(h.relays.heard).not.toHaveBeenCalled();
    expect(h.channel().types()).toEqual([]);
  });

  it("without the transcript, the voice can only pass the turn to Q", async () => {
    const h = harness({
      credential: ROUTED,
      heard: () => Promise.resolve({ route: "SMALLTALK" as const }),
    });
    await h.line.open();
    finish(h, "item_1", null);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.relays.heard).not.toHaveBeenCalled();
    expect(h.channel().sent.at(-1)).toMatchObject({
      type: "response.create",
      response: { tool_choice: { type: "function", name: "ask_q" } },
    });
  });

  it("a relay that did not get through still sends the turn to Q, never to the voice alone", async () => {
    const h = harness({
      credential: ROUTED,
      heard: () => Promise.resolve(null),
    });
    await h.line.open();
    finish(h, "item_1", "How should I approach Zino?");
    await settle();
    expect(h.channel().sent.at(-1)).toMatchObject({
      response: { tool_choice: { type: "function", name: "ask_q" } },
    });
  });

  it("tells the server when a card is in focus, and routes a typed turn too", async () => {
    const h = harness({
      credential: ROUTED,
      heard: () => Promise.resolve({ route: "MODEL" as const }),
      cardInFocus: () => true,
    });
    await h.line.open();
    h.line.sendText("send it");
    await settle();
    expect(h.relays.heard).toHaveBeenCalledWith({
      itemId: null,
      transcript: "send it",
      typed: true,
      cardInFocus: true,
      turnId: expect.stringMatching(/^turn_/u) as unknown,
    });
    expect(h.channel().types()).toEqual([
      "conversation.item.create",
      "response.create",
    ]);
  });

  it("an unrouted line answers as before", async () => {
    const h = harness({
      heard: () => Promise.resolve({ route: "SMALLTALK" as const }),
    });
    await h.line.open();
    finish(h, "item_1", "Open my pitch deck.");
    await settle();
    expect(h.relays.heard).not.toHaveBeenCalled();
  });
});
