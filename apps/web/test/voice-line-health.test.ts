// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QVoiceDuplexCredential,
  QVoiceDuplexRejoinResult,
} from "@capital-q/contracts";

import { AgentSocket } from "../src/features/voice/provider/agent-socket";
import {
  DuplexLine,
  MAX_REJOINS,
  PLAYOUT_BUFFER_MS,
  WEAK_PLAYOUT_BUFFER_MS,
  type DuplexEnvironment,
  type DuplexLineEvents,
  type DuplexRelays,
} from "../src/features/voice/provider/duplex-line";
import {
  DISCONNECTED_GRACE_MS,
  HEALTH_SAMPLE_MS,
  LINE_LOST_NOTICE,
  LineHealth,
  RECONNECTING_NOTICE,
  sampleOf,
  WEAK_LINE_NOTICE,
  type RtcCounters,
} from "../src/features/voice/provider/line-health";

/**
 * Voice on a bad network (founder: "sometimes the voice starts to break
 * and it can't even hear me talk"; I1, Dubai 2026-10-05: "even if it has
 * a bad network, it still needs to work"). With fakes only -- no network,
 * no provider, no key -- a simulated network: packet loss, jitter and
 * round-trip spikes keep the realtime line (a calm note and a deeper
 * playout buffer, never the standard voice); a 2-second outage heals on
 * its own; a dead transport rejoins the same line on a fresh call and
 * replays the conversation; only the cap or repeated drops hand over. A
 * microphone track that ends, or a device change, gets a fresh microphone
 * on the same line; a stalled socket is dropped so the interview
 * reconnects.
 */

const counters = (over: Partial<RtcCounters> = {}): RtcCounters => ({
  received: 0,
  lost: 0,
  jitter: 0.01,
  remoteFractionLost: null,
  rtt: 0.08,
  ...over,
});

describe("line health policy", () => {
  it("measures loss between two readings, and ignores a sample with too few packets", () => {
    const loss = sampleOf(
      counters({ received: 100, lost: 0 }),
      counters({ received: 170, lost: 30 }),
    );
    expect(loss.loss).toBeCloseTo(0.3);
    expect(loss.bad).toBe(true);
    const thin = sampleOf(
      counters({ received: 100, lost: 0 }),
      counters({ received: 102, lost: 1 }),
    );
    expect(thin.loss).toBeNull();
    expect(thin.bad).toBe(false);
  });

  it("is weak only after three bad samples in a row, and recovers after two good ones", () => {
    const health = new LineHealth();
    expect(health.observe(counters({ received: 50 }))).toBe("GOOD");
    expect(health.observe(counters({ received: 60, lost: 40 }))).toBe("GOOD");
    expect(health.observe(counters({ received: 160, lost: 40 }))).toBe("GOOD");
    expect(health.observe(counters({ received: 170, lost: 80 }))).toBe("GOOD");
    expect(health.observe(counters({ received: 180, lost: 120 }))).toBe("GOOD");
    expect(health.observe(counters({ received: 190, lost: 160 }))).toBe("WEAK");
    expect(health.observe(counters({ received: 290, lost: 160 }))).toBe("WEAK");
    expect(health.observe(counters({ received: 390, lost: 160 }))).toBe("GOOD");
    expect(health.worst.lossPct).toBeCloseTo(80);
  });

  it("counts jitter, round trip and the provider's report of our audio, at tolerant thresholds", () => {
    // What tore lines down in Dubai is now ordinary: Opus and the jitter
    // buffer carry it (I1).
    expect(sampleOf(null, counters({ jitter: 0.2 })).bad).toBe(false);
    expect(sampleOf(null, counters({ rtt: 1.5 })).bad).toBe(false);
    expect(sampleOf(null, counters({ remoteFractionLost: 0.15 })).bad).toBe(
      false,
    );
    expect(sampleOf(null, counters({ jitter: 0.3 })).bad).toBe(true);
    expect(sampleOf(null, counters({ rtt: 2.5 })).bad).toBe(true);
    expect(sampleOf(null, counters({ remoteFractionLost: 0.4 })).bad).toBe(
      true,
    );
    expect(sampleOf(null, counters()).bad).toBe(false);
  });
});

class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  readonly sent: Record<string, unknown>[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
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

class FakeTrack extends EventTarget {
  readonly kind = "audio";
  enabled = true;
  readyState: MediaStreamTrackState = "live";
  readonly stop = vi.fn(() => {
    this.readyState = "ended";
  });
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

function streamOf(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

class FakePeer {
  channel: FakeChannel | null = null;
  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  stats: Record<string, unknown>[] = [];
  closed = false;
  readonly receiver = { jitterBufferTarget: null as number | null };
  readonly sender = {
    track: null as FakeTrack | null,
    replaceTrack: vi.fn((track: FakeTrack) => {
      this.sender.track = track;
      return Promise.resolve();
    }),
  };
  addTrack(track: FakeTrack) {
    this.sender.track = track;
    return this.sender;
  }
  createDataChannel() {
    this.channel = new FakeChannel();
    return this.channel;
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "v=0 offer" });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription() {
    queueMicrotask(() => this.channel?.open());
    return Promise.resolve();
  }
  getStats() {
    const stats = this.stats;
    return Promise.resolve({
      forEach: (visit: (value: unknown) => void) => {
        stats.forEach((stat) => {
          visit(stat);
        });
      },
    });
  }
  close() {
    this.closed = true;
  }
  /** The provider's audio track arrives. */
  track() {
    this.ontrack?.({
      streams: [{}],
      receiver: this.receiver,
    } as unknown as RTCTrackEvent);
  }
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

const CREDENTIAL: QVoiceDuplexCredential = {
  clientSecret: "ek_fake_secret",
  callsUrl: "https://realtime.invalid/v1/realtime/calls",
  expiresAt: "2099-01-01T00:00:00.000Z",
  maxSessionMs: 600_000,
  idleMs: 300_000,
};

function duplex(
  options: {
    readonly rejoin?: DuplexRelays["rejoin"];
    readonly tool?: DuplexRelays["tool"];
    readonly usage?: DuplexRelays["usage"];
  } = {},
) {
  const peers: FakePeer[] = [];
  const first = new FakeTrack();
  const fresh: FakeTrack[] = [];
  let firstGiven = false;
  let deviceChange: (() => void) | null = null;
  const getMicrophone = vi.fn(() => {
    if (!firstGiven) {
      firstGiven = true;
      return Promise.resolve(streamOf(first));
    }
    const track = new FakeTrack();
    fresh.push(track);
    return Promise.resolve(streamOf(track));
  });
  const environment: DuplexEnvironment = {
    createPeer: () => {
      const created = new FakePeer();
      peers.push(created);
      return created as unknown as RTCPeerConnection;
    },
    getMicrophone,
    fetch: () => Promise.resolve(new Response("v=0 answer", { status: 201 })),
    createAudio: () =>
      ({ volume: 1, srcObject: null }) as unknown as HTMLAudioElement,
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    onDeviceChange: (handler) => {
      deviceChange = handler;
      return () => {
        deviceChange = null;
      };
    },
  };
  const events = {
    onState: vi.fn<DuplexLineEvents["onState"]>(),
    onLine: vi.fn<DuplexLineEvents["onLine"]>(),
    onInterrupted: vi.fn<DuplexLineEvents["onInterrupted"]>(),
    onFallback: vi.fn<DuplexLineEvents["onFallback"]>(),
    onEnded: vi.fn<DuplexLineEvents["onEnded"]>(),
    onLinkStatus: vi.fn<NonNullable<DuplexLineEvents["onLinkStatus"]>>(),
  };
  const relays = {
    tool: vi.fn<DuplexRelays["tool"]>(
      options.tool ?? (() => Promise.resolve(null)),
    ),
    usage: vi.fn<DuplexRelays["usage"]>(
      options.usage ?? (() => Promise.resolve({ continue: true })),
    ),
    end: vi.fn<DuplexRelays["end"]>(() => Promise.resolve()),
    ...(options.rejoin === undefined
      ? {}
      : { rejoin: vi.fn<NonNullable<DuplexRelays["rejoin"]>>(options.rejoin) }),
  };
  const line = new DuplexLine({
    credential: CREDENTIAL,
    relays,
    events,
    environment,
  });
  const latest = () => {
    const peer = peers.at(-1);
    if (peer === undefined) throw new Error("no peer");
    return peer;
  };
  return {
    line,
    get peer() {
      return latest();
    },
    peers,
    relays,
    channel: () => {
      const channel = latest().channel;
      if (channel === null) throw new Error("no channel");
      return channel;
    },
    first,
    fresh,
    events,
    getMicrophone,
    changeDevice: () => deviceChange?.(),
  };
}

function inbound(received: number, lost: number) {
  return [
    {
      type: "inbound-rtp",
      kind: "audio",
      packetsReceived: received,
      packetsLost: lost,
      jitter: 0.02,
    },
  ];
}

describe("the realtime line on a bad network", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the realtime line under sustained packet loss, saying so calmly and deepening the playout buffer", async () => {
    const h = duplex();
    await h.line.open();
    h.peer.track();
    expect(h.peer.receiver.jitterBufferTarget).toBe(PLAYOUT_BUFFER_MS);
    let received = 0;
    let lost = 0;
    for (let i = 0; i < 10; i += 1) {
      h.peer.stats = inbound(received, lost);
      await vi.advanceTimersByTimeAsync(HEALTH_SAMPLE_MS);
      received += 30;
      lost += 20; // 40% loss in every window, for ten seconds.
    }
    expect(h.events.onFallback).not.toHaveBeenCalled();
    expect(h.events.onLinkStatus).toHaveBeenCalledWith(WEAK_LINE_NOTICE);
    expect(h.peer.receiver.jitterBufferTarget).toBe(WEAK_PLAYOUT_BUFFER_MS);
    // The loss stops: the note goes and the buffer comes back down.
    for (let i = 0; i < 3; i += 1) {
      h.peer.stats = inbound(received, lost);
      await vi.advanceTimersByTimeAsync(HEALTH_SAMPLE_MS);
      received += 50;
    }
    expect(h.events.onLinkStatus).toHaveBeenLastCalledWith(null);
    expect(h.peer.receiver.jitterBufferTarget).toBe(PLAYOUT_BUFFER_MS);
    h.line.close();
  });

  it("stays on a clean line", async () => {
    const h = duplex();
    await h.line.open();
    for (let i = 0; i < 6; i += 1) {
      h.peer.stats = inbound(i * 50, 0);
      await vi.advanceTimersByTimeAsync(HEALTH_SAMPLE_MS);
    }
    expect(h.events.onFallback).not.toHaveBeenCalled();
    expect(h.events.onLinkStatus).not.toHaveBeenCalled();
    h.line.close();
  });

  it("rides out jitter of 200 ms and round-trip spikes of 1.8 s without a word", async () => {
    const h = duplex();
    await h.line.open();
    for (let i = 0; i < 12; i += 1) {
      const spike = i % 3 === 0;
      h.peer.stats = [
        {
          type: "inbound-rtp",
          kind: "audio",
          packetsReceived: i * 50,
          packetsLost: i * 2, // ~4% loss: Opus FEC territory.
          jitter: spike ? 0.2 : 0.06,
        },
        {
          type: "candidate-pair",
          nominated: true,
          state: "succeeded",
          currentRoundTripTime: spike ? 1.8 : 0.35,
        },
      ];
      await vi.advanceTimersByTimeAsync(HEALTH_SAMPLE_MS);
    }
    expect(h.events.onFallback).not.toHaveBeenCalled();
    expect(h.events.onLinkStatus).not.toHaveBeenCalled();
    h.line.close();
  });

  it("rides out a 2-second outage on the same call: no rejoin, no standard voice", async () => {
    const rejoin = vi.fn(() =>
      Promise.resolve<QVoiceDuplexRejoinResult>({ credential: CREDENTIAL }),
    );
    const h = duplex({ rejoin });
    await h.line.open();
    h.peer.setState("disconnected");
    expect(h.events.onLinkStatus).toHaveBeenCalledWith(RECONNECTING_NOTICE);
    await vi.advanceTimersByTimeAsync(2_000);
    h.peer.setState("connected");
    await vi.advanceTimersByTimeAsync(DISCONNECTED_GRACE_MS);
    expect(rejoin).not.toHaveBeenCalled();
    expect(h.peers).toHaveLength(1);
    expect(h.events.onFallback).not.toHaveBeenCalled();
    expect(h.events.onLinkStatus).toHaveBeenLastCalledWith(null);
    h.line.close();
  });

  it("hands over with a plain sentence when a dead line cannot rejoin", async () => {
    const h = duplex();
    await h.line.open();
    h.peer.setState("disconnected");
    await vi.advanceTimersByTimeAsync(DISCONNECTED_GRACE_MS + 10);
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "NETWORK",
      notice: LINE_LOST_NOTICE,
      connected: true,
    });
  });

  it("replaces a microphone track that ends, on the same line, keeping mute", async () => {
    const h = duplex();
    await h.line.open();
    h.line.setMuted(true);
    h.first.end();
    await vi.advanceTimersByTimeAsync(0);
    const [replacement] = h.fresh;
    expect(replacement).toBeDefined();
    expect(h.peer.sender.replaceTrack).toHaveBeenCalledWith(replacement);
    expect(replacement?.enabled).toBe(false);
    expect(h.events.onFallback).not.toHaveBeenCalled();
    h.line.close();
  });

  it("takes the new microphone when a device is plugged in or out", async () => {
    const h = duplex();
    await h.line.open();
    h.changeDevice();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.peer.sender.replaceTrack).toHaveBeenCalledTimes(1);
    expect(h.first.stop).toHaveBeenCalled();
    h.line.close();
  });
});

describe("the realtime line rejoining after a drop (I1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const fresh = (): Promise<QVoiceDuplexRejoinResult> =>
    Promise.resolve({
      credential: { ...CREDENTIAL, clientSecret: "ek_fresh_secret" },
    });

  it("rejoins a dead transport on a fresh call, keeping the microphone and replaying the conversation", async () => {
    const h = duplex({ rejoin: fresh });
    await h.line.open();
    h.channel().emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_1",
      transcript: "How is the raise going?",
    });
    h.channel().emit({
      type: "response.output_audio_transcript.done",
      transcript: "Two term sheets are in.",
    });
    const before = h.peer;
    before.setState("failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.relays.rejoin).toHaveBeenCalledWith("NETWORK");
    expect(h.peers).toHaveLength(2);
    expect(before.closed).toBe(true);
    // The same microphone track rides on the new call.
    expect(h.peer.sender.track).toBe(h.first);
    expect(h.first.stop).not.toHaveBeenCalled();
    const replayed = JSON.stringify(h.channel().sent);
    expect(replayed).toContain("How is the raise going?");
    expect(replayed).toContain("Two term sheets are in.");
    expect(replayed).toContain("do not greet");
    expect(h.events.onFallback).not.toHaveBeenCalled();
    expect(h.events.onLinkStatus).toHaveBeenCalledWith(RECONNECTING_NOTICE);
    expect(h.events.onLinkStatus).toHaveBeenLastCalledWith(null);
    h.line.close();
    expect(h.relays.end).toHaveBeenCalledWith(
      "ENDED",
      expect.objectContaining({
        stats: expect.objectContaining({ rejoins: 1 }) as unknown,
      }),
    );
  });

  it("keeps trying through an outage longer than the grace, then carries on", async () => {
    let calls = 0;
    const h = duplex({
      rejoin: () => {
        calls += 1;
        // The first two requests do not get through: still offline.
        return calls <= 2 ? Promise.reject(new Error("offline")) : fresh();
      },
    });
    await h.line.open();
    h.peer.setState("disconnected");
    await vi.advanceTimersByTimeAsync(DISCONNECTED_GRACE_MS + 10);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(3);
    expect(h.peers).toHaveLength(2);
    expect(h.events.onFallback).not.toHaveBeenCalled();
    h.line.close();
  });

  it("says a tool result that came back during the drop on the new call", async () => {
    let finish: (value: { output: string; approvalPending: boolean }) => void =
      () => undefined;
    const h = duplex({
      rejoin: fresh,
      tool: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_1",
      name: "ask_q",
      arguments: '{"request":"Who led the round?"}',
    });
    h.peer.setState("failed");
    await vi.advanceTimersByTimeAsync(0);
    finish({
      output: JSON.stringify({ ok: true, say: "Northwind led it." }),
      approvalPending: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    const sent = h.channel().sent;
    expect(JSON.stringify(sent)).toContain("Northwind led it.");
    expect(sent.some((event) => event.type === "response.create")).toBe(true);
    // Never a function_call_output the new call has no call for.
    expect(JSON.stringify(sent)).not.toContain("function_call_output");
    h.line.close();
  });

  it("renews the call at its length silently, on the same voice", async () => {
    const h = duplex({ rejoin: fresh });
    await h.line.open();
    for (let at = 0; at < CREDENTIAL.maxSessionMs; at += 20_000) {
      h.channel().emit({ type: "input_audio_buffer.speech_started" });
      await vi.advanceTimersByTimeAsync(20_000);
    }
    expect(h.relays.rejoin).toHaveBeenCalledWith("MAX_LENGTH");
    expect(h.events.onFallback).not.toHaveBeenCalled();
    expect(h.events.onLinkStatus).not.toHaveBeenCalledWith(RECONNECTING_NOTICE);
    h.line.close();
  });

  it("hands over with the cap's sentence when the server refuses a rejoin", async () => {
    const notice =
      "I've reached today's limit for live voice, so I'm switching to my standard voice.";
    const h = duplex({ rejoin: () => Promise.resolve({ notice }) });
    await h.line.open();
    h.peer.setState("failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "CAP",
      notice,
      connected: true,
    });
    expect(h.relays.end).toHaveBeenCalledWith(
      "FALLBACK",
      expect.objectContaining({ cause: "CAP" }),
    );
  });

  it("retries a usage report that did not get through instead of leaving", async () => {
    let calls = 0;
    const h = duplex({
      rejoin: fresh,
      usage: () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? null : { continue: true });
      },
    });
    await h.line.open();
    h.channel().emit({
      type: "response.done",
      response: { id: "resp_1", usage: {} },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toBe(2);
    expect(h.relays.rejoin).not.toHaveBeenCalled();
    expect(h.events.onFallback).not.toHaveBeenCalled();
    h.line.close();
  });

  it("gives up only after repeated drops, with a plain sentence", async () => {
    const h = duplex({ rejoin: fresh });
    await h.line.open();
    for (let i = 0; i <= MAX_REJOINS; i += 1) {
      h.peer.setState("failed");
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(h.relays.rejoin).toHaveBeenCalledTimes(MAX_REJOINS);
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "NETWORK",
      notice: LINE_LOST_NOTICE,
      connected: true,
    });
  });

  it("measures the time from the end of the person's turn to Q's first audio", async () => {
    const h = duplex();
    await h.line.open();
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    h.channel().emit({ type: "input_audio_buffer.speech_stopped" });
    await vi.advanceTimersByTimeAsync(420);
    h.channel().emit({ type: "output_audio_buffer.started" });
    h.line.close();
    expect(h.relays.end).toHaveBeenCalledWith(
      "ENDED",
      expect.objectContaining({
        stats: expect.objectContaining({
          firstAudioMsP50: 420,
          firstAudioMsMax: 420,
          turns: 1,
        }) as unknown,
      }),
    );
  });
});

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly sent: unknown[] = [];
  constructor() {
    FakeSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("the standard voice's socket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops a line whose audio stops draining and reports it, so the interview reconnects", async () => {
    const socket = new AgentSocket({
      token: "t",
      agent: {},
      input: { encoding: "linear16", sampleRate: 16_000 },
      output: { encoding: "linear16", sampleRate: 24_000 },
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    const dropped = vi.fn();
    socket.on("disconnected", dropped);
    const opened = socket.connect();
    const fake = FakeSocket.last;
    if (fake === null) throw new Error("no socket");
    fake.open();
    await opened;
    fake.message({ type: "Welcome" });
    fake.message({ type: "SettingsApplied" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dropped).not.toHaveBeenCalled();
    // The network goes quiet: three seconds of the person's audio pile up.
    fake.bufferedAmount = 16_000 * 2 * 3;
    await vi.advanceTimersByTimeAsync(600);
    expect(dropped).toHaveBeenCalledWith("stalled");
    expect(fake.readyState).toBe(3);
    expect(socket.open).toBe(false);
  });
});
