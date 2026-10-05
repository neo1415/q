// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QVoiceDuplexCredential } from "@capital-q/contracts";

import { AgentSocket } from "../src/features/voice/provider/agent-socket";
import {
  DuplexLine,
  type DuplexEnvironment,
  type DuplexLineEvents,
} from "../src/features/voice/provider/duplex-line";
import {
  DISCONNECTED_GRACE_MS,
  HEALTH_SAMPLE_MS,
  LineHealth,
  sampleOf,
  WEAK_LINE_NOTICE,
  type RtcCounters,
} from "../src/features/voice/provider/line-health";

/**
 * Voice on a bad network (founder: "sometimes the voice starts to break
 * and it can't even hear me talk"). With fakes only -- no network, no
 * provider, no key: simulated packet loss hands the realtime line to the
 * standard voice with a calm sentence; a blip that heals is ridden out; a
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

  it("is weak only after consecutive bad samples, so one burst is ridden out", () => {
    const health = new LineHealth();
    expect(health.observe(counters({ received: 50 }))).toBe(false);
    expect(health.observe(counters({ received: 60, lost: 40 }))).toBe(false);
    expect(health.observe(counters({ received: 160, lost: 40 }))).toBe(false);
    expect(health.observe(counters({ received: 170, lost: 80 }))).toBe(false);
    expect(health.observe(counters({ received: 180, lost: 120 }))).toBe(true);
  });

  it("counts jitter, round trip and the provider's report of our audio", () => {
    expect(sampleOf(null, counters({ jitter: 0.3 })).bad).toBe(true);
    expect(sampleOf(null, counters({ rtt: 1.5 })).bad).toBe(true);
    expect(sampleOf(null, counters({ remoteFractionLost: 0.4 })).bad).toBe(
      true,
    );
    expect(sampleOf(null, counters()).bad).toBe(false);
  });
});

class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send() {
    return undefined;
  }
  close() {
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
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
    return undefined;
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

function duplex() {
  const peer = new FakePeer();
  const first = new FakeTrack();
  const fresh: FakeTrack[] = [];
  let deviceChange: (() => void) | null = null;
  const getMicrophone = vi.fn(() => {
    if (fresh.length === 0 && peer.sender.track === null) {
      return Promise.resolve(streamOf(first));
    }
    const track = new FakeTrack();
    fresh.push(track);
    return Promise.resolve(streamOf(track));
  });
  const environment: DuplexEnvironment = {
    createPeer: () => peer as unknown as RTCPeerConnection,
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
  };
  const line = new DuplexLine({
    credential: CREDENTIAL,
    relays: {
      tool: () => Promise.resolve(null),
      usage: () => Promise.resolve({ continue: true }),
      end: () => Promise.resolve(),
    },
    events,
    environment,
  });
  return {
    line,
    peer,
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

  it("switches to the standard voice, saying so, under sustained packet loss", async () => {
    const h = duplex();
    await h.line.open();
    let received = 0;
    let lost = 0;
    for (let i = 0; i < 4; i += 1) {
      h.peer.stats = inbound(received, lost);
      await vi.advanceTimersByTimeAsync(HEALTH_SAMPLE_MS);
      received += 30;
      lost += 20; // 40% loss in every window.
    }
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "NETWORK",
      notice: WEAK_LINE_NOTICE,
      connected: true,
    });
    // Within about three seconds of the line going bad.
    expect(h.events.onFallback).toHaveBeenCalledTimes(1);
  });

  it("stays on a clean line", async () => {
    const h = duplex();
    await h.line.open();
    for (let i = 0; i < 6; i += 1) {
      h.peer.stats = inbound(i * 50, 0);
      await vi.advanceTimersByTimeAsync(HEALTH_SAMPLE_MS);
    }
    expect(h.events.onFallback).not.toHaveBeenCalled();
    h.line.close();
  });

  it("rides out a disconnect that heals within the grace, and hands over one that does not", async () => {
    const h = duplex();
    await h.line.open();
    h.peer.setState("disconnected");
    await vi.advanceTimersByTimeAsync(1_000);
    h.peer.setState("connected");
    await vi.advanceTimersByTimeAsync(DISCONNECTED_GRACE_MS);
    expect(h.events.onFallback).not.toHaveBeenCalled();

    h.peer.setState("disconnected");
    await vi.advanceTimersByTimeAsync(DISCONNECTED_GRACE_MS + 10);
    expect(h.events.onFallback).toHaveBeenCalledWith({
      cause: "NETWORK",
      notice: WEAK_LINE_NOTICE,
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
