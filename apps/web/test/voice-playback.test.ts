// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSocket } from "../src/features/voice/provider/agent-socket";
import { PcmPlayer } from "../src/features/voice/provider/pcm-player";
import {
  Pcm16Decoder,
  PcmScheduler,
  type ScheduledBlock,
} from "../src/features/voice/provider/pcm-schedule";

/**
 * Q's voice without stutter (R22).
 *
 * The scheduler is driven by a fake audio clock (plain numbers), so every
 * assertion is about the timeline and nothing waits on real time. The
 * arrival pattern is the one measured from the live agent on 2026-09-26:
 * 20 ms frames, a short trickle, a stall of about a quarter of a second,
 * then seconds of audio at once.
 */

const RATE = 24_000;
const FRAME = 480; // 20 ms at 24 kHz

function frame(value = 0.1): Float32Array {
  return new Float32Array(FRAME).fill(value);
}

/**
 * The measured shape (live agent, ElevenLabs voice, 2026-09-26): eight
 * frames inside 12 ms, nothing until 277 ms, then bursts of about a second
 * of audio separated by ~250 ms stalls.
 */
function liveArrivals(): number[] {
  const times: number[] = [];
  for (let i = 0; i < 8; i += 1) times.push(i * 0.0015);
  let t = 0.277;
  for (let i = 0; i < 500; i += 1) {
    times.push(t);
    t += i % 50 === 49 ? 0.25 : 0.001;
  }
  return times;
}

/** The SDK player's policy: start each frame on arrival, at max(now, end). */
function scheduleOnArrival(arrivals: readonly number[]) {
  let end = 0;
  let underruns = 0;
  let gap = 0;
  for (const now of arrivals) {
    if (end > 0 && now > end) {
      underruns += 1;
      gap += now - end;
    }
    end = Math.max(now, end) + FRAME / RATE;
  }
  return { underruns, gapMs: Math.round(gap * 1000) };
}

/** Drive the scheduler over arrival times, honouring its wake-ups. */
function drive(scheduler: PcmScheduler, arrivals: readonly number[]) {
  const blocks: ScheduledBlock[] = [];
  for (const now of arrivals) {
    const wake = scheduler.wakeAt();
    if (wake !== null && wake <= now) blocks.push(...scheduler.tick(wake));
    blocks.push(...scheduler.push(frame(), now));
  }
  const last = arrivals.at(-1) ?? 0;
  blocks.push(...scheduler.flush(last));
  return blocks;
}

function assertGapless(blocks: readonly ScheduledBlock[]) {
  for (let i = 1; i < blocks.length; i += 1) {
    const previous = blocks[i - 1];
    const current = blocks[i];
    if (previous === undefined || current === undefined) continue;
    const end = previous.at + previous.samples.length / RATE;
    expect(current.at).toBeCloseTo(end, 9);
  }
}

describe("PcmScheduler", () => {
  it("holds a sentence until a little audio is in hand, then starts it as one block", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    const started: ScheduledBlock[] = [];
    for (let i = 0; i < 8; i += 1) {
      started.push(...scheduler.push(frame(), i * 0.02));
    }
    // 8 frames = 160 ms, under the 180 ms prebuffer, within the wait.
    expect(started).toHaveLength(0);
    const blocks = scheduler.push(frame(), 0.16);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.samples.length).toBe(9 * FRAME);
    expect(blocks[0]?.at).toBeCloseTo(0.16 + 0.025, 9);
  });

  it("starts with what it has once the first frame has waited long enough", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    for (let i = 0; i < 5; i += 1) {
      expect(scheduler.push(frame(), 1)).toHaveLength(0);
    }
    expect(scheduler.wakeAt()).toBeCloseTo(1.25, 9);
    const blocks = scheduler.tick(1.25);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.samples.length).toBe(5 * FRAME);
  });

  it("never starts a sentence on a lone frame: it waits for more, or for the reply's end (I1)", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    expect(scheduler.push(frame(), 1)).toHaveLength(0);
    // 20 ms in hand: no timer, the next frame decides.
    expect(scheduler.wakeAt()).toBeNull();
    expect(scheduler.tick(1.5)).toHaveLength(0);
    const blocks = scheduler.flush(1.6);
    expect(blocks).toHaveLength(1);
  });

  it("plays a short reply at once when the provider says it is complete", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    scheduler.push(frame(), 0);
    const blocks = scheduler.flush(0.01);
    expect(blocks).toHaveLength(1);
    expect(scheduler.wakeAt()).toBeNull();
  });

  it("places everything after the start end to end, sample-exact", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    const arrivals = Array.from({ length: 200 }, (_, i) => i * 0.01);
    const blocks = drive(scheduler, arrivals);
    expect(blocks.length).toBeGreaterThan(1);
    assertGapless(blocks);
    const samples = blocks.reduce((sum, b) => sum + b.samples.length, 0);
    expect(samples).toBe(200 * FRAME);
    expect(scheduler.stats.underruns).toBe(0);
  });

  it("gathers small frames into larger blocks while there is lead, and releases them before it runs low", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    // A second of audio at once: one start block with plenty of lead.
    for (let i = 0; i < 50; i += 1) scheduler.push(frame(), 0);
    scheduler.flush(0);
    const start = scheduler.remaining(0);
    expect(start).toBeGreaterThan(0.9);
    // Three more frames (60 ms, under the 100 ms block) are held...
    expect(scheduler.push(frame(), 0.1)).toHaveLength(0);
    expect(scheduler.push(frame(), 0.1)).toHaveLength(0);
    expect(scheduler.push(frame(), 0.1)).toHaveLength(0);
    // ...until the lead falls to the low-water mark.
    const wake = scheduler.wakeAt();
    expect(wake).not.toBeNull();
    const released = scheduler.tick(wake ?? 0);
    expect(released).toHaveLength(1);
    expect(released[0]?.samples.length).toBe(3 * FRAME);
    expect(released[0]?.at).toBeCloseTo(0.025 + 50 * 0.02, 9);
  });

  it("does not stutter on the measured live arrival pattern, where playing on arrival does", () => {
    const arrivals = liveArrivals();
    const onArrival = scheduleOnArrival(arrivals);
    expect(onArrival.underruns).toBeGreaterThanOrEqual(1);
    expect(onArrival.gapMs).toBeGreaterThanOrEqual(100);

    const scheduler = new PcmScheduler({ sampleRate: RATE });
    const blocks = drive(scheduler, arrivals);
    expect(scheduler.stats.underruns).toBe(0);
    expect(scheduler.stats.gapMs).toBe(0);
    assertGapless(blocks);
    // Far fewer, larger pieces than one source per 20 ms frame.
    expect(blocks.length).toBeLessThan(arrivals.length / 4);
  });

  it("counts a real gap, refills before playing on, and holds more for the rest of the session", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    for (let i = 0; i < 10; i += 1) scheduler.push(frame(), 0);
    const end = scheduler.remaining(0); // 25 ms + 200 ms
    // The next frame of the same reply lands 300 ms after the timeline ran dry.
    const late = end + 0.3;
    expect(scheduler.push(frame(), late)).toHaveLength(0);
    expect(scheduler.stats.underruns).toBe(1);
    expect(scheduler.stats.gapMs).toBe(300);
    expect(scheduler.stats.prebufferMs).toBe(360);
    // It buffers again rather than playing a lone 20 ms frame.
    expect(scheduler.wakeAt()).toBeNull();
    for (let i = 0; i < 4; i += 1) scheduler.push(frame(), late);
    expect(scheduler.wakeAt()).toBeCloseTo(late + 0.25, 9);
  });

  /*
   * A simulated bad network for Q's streamed speech (I1). The speech
   * service makes audio twice as fast as it plays; each frame then takes a
   * variable time to arrive, in order (one socket), so a slow frame holds
   * every frame behind it. Deterministic: a seeded generator, no clocks.
   */
  function networkArrivals(
    frames: number,
    delayOf: (index: number, sentAt: number) => number,
  ): number[] {
    const times: number[] = [];
    let last = 0;
    for (let i = 0; i < frames; i += 1) {
      const sentAt = i * 0.01;
      last = Math.max(last, sentAt + delayOf(i, sentAt));
      times.push(last);
    }
    return times;
  }
  function seeded(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  }

  it("network simulation: up to 300 ms of jitter costs at most one pause, then plays smoothly", () => {
    const random = seeded(7);
    const arrivals = networkArrivals(500, () => 0.08 + random() * 0.3);
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    const blocks = drive(scheduler, arrivals);
    assertGapless(blocks.slice(0, 1));
    expect(scheduler.stats.underruns).toBeLessThanOrEqual(1);
    // Ten seconds of speech, every sample played.
    const samples = blocks.reduce((sum, b) => sum + b.samples.length, 0);
    expect(samples).toBe(500 * FRAME);
  });

  it("network simulation: 10 % of frames late by up to 700 ms (RTT spikes) stay smooth after one refill", () => {
    const random = seeded(11);
    const arrivals = networkArrivals(500, () =>
      random() < 0.1 ? 0.1 + random() * 0.7 : 0.1,
    );
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    drive(scheduler, arrivals);
    expect(scheduler.stats.underruns).toBeLessThanOrEqual(2);
  });

  it("network simulation: a 2-second outage mid-reply is one pause, not a stutter", () => {
    // Frames sent between 1 s and 3 s arrive together when the line returns.
    const arrivals = networkArrivals(500, (_, sentAt) =>
      sentAt >= 1 && sentAt < 3 ? 3 - sentAt + 0.1 : 0.1,
    );
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    const blocks = drive(scheduler, arrivals);
    expect(scheduler.stats.underruns).toBe(1);
    const samples = blocks.reduce((sum, b) => sum + b.samples.length, 0);
    expect(samples).toBe(500 * FRAME);
  });

  it("network simulation: a clean line starts within 300 ms of the first frame", () => {
    const arrivals = networkArrivals(100, () => 0.05);
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    const blocks = drive(scheduler, arrivals);
    const first = blocks[0];
    expect(first).toBeDefined();
    expect((first?.at ?? 99) - (arrivals[0] ?? 0)).toBeLessThan(0.3);
    expect(scheduler.stats.underruns).toBe(0);
  });

  it("does not count the silence between two replies as a gap", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    scheduler.push(frame(), 0);
    scheduler.flush(0);
    scheduler.push(frame(), 5);
    expect(scheduler.stats.underruns).toBe(0);
  });

  it("forgets everything on reset (barge-in)", () => {
    const scheduler = new PcmScheduler({ sampleRate: RATE });
    for (let i = 0; i < 20; i += 1) scheduler.push(frame(), 0);
    scheduler.push(frame(), 0.01);
    scheduler.reset();
    expect(scheduler.remaining(0.01)).toBe(0);
    expect(scheduler.holding).toBe(false);
    expect(scheduler.wakeAt()).toBeNull();
    // The next reply starts fresh and is not a gap.
    scheduler.push(frame(), 3);
    expect(scheduler.stats.underruns).toBe(0);
  });
});

describe("Pcm16Decoder", () => {
  it("decodes little-endian signed PCM to [-1, 1]", () => {
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00]);
    const out = new Pcm16Decoder().decode(bytes.buffer);
    expect(Array.from(out)).toEqual([-1, 1, 0]);
  });

  it("carries a sample split across two frames instead of dropping the frame", () => {
    const decoder = new Pcm16Decoder();
    // 0x7fff split as [0xff] | [0x7f, 0x00, 0x80]
    const first = decoder.decode(new Uint8Array([0xff]).buffer);
    const second = decoder.decode(new Uint8Array([0x7f, 0x00, 0x80]).buffer);
    expect(first.length).toBe(0);
    expect(Array.from(second)).toEqual([1, -1]);
  });
});

class FakeSource {
  static all: FakeSource[] = [];
  buffer: { length: number } | null = null;
  startedAt: number | null = null;
  stopped = false;
  onended: (() => void) | null = null;
  constructor() {
    FakeSource.all.push(this);
  }
  connect() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
  start(at: number) {
    this.startedAt = at;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  currentTime = 0;
  state = "running";
  closed = false;
  readonly destination = {};
  constructor() {
    FakeAudioContext.last = this;
  }
  createGain() {
    return {
      gain: { value: 1, setTargetAtTime: () => undefined },
      connect: () => undefined,
    };
  }
  createAnalyser() {
    return {
      fftSize: 256,
      connect: () => undefined,
      getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
    };
  }
  createBuffer(_channels: number, length: number) {
    return { length, copyToChannel: () => undefined };
  }
  createBufferSource() {
    return new FakeSource();
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function pcmFrame(): ArrayBuffer {
  return new ArrayBuffer(FRAME * 2);
}

describe("PcmPlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSource.all = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("schedules the agent's frames end to end on one context", () => {
    const player = new PcmPlayer({ sampleRate: RATE });
    for (let i = 0; i < 20; i += 1) player.queue(pcmFrame());
    const ctx = FakeAudioContext.last;
    expect(ctx).not.toBeNull();
    if (ctx === null) return;
    ctx.currentTime = 0.3;
    for (let i = 0; i < 10; i += 1) player.queue(pcmFrame());
    player.flush();
    const starts = FakeSource.all.map((s) => ({
      at: s.startedAt ?? -1,
      length: s.buffer?.length ?? 0,
    }));
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < starts.length; i += 1) {
      const a = starts[i - 1];
      const b = starts[i];
      if (a === undefined || b === undefined) continue;
      expect(b.at).toBeCloseTo(a.at + a.length / RATE, 9);
    }
    expect(player.stats.underruns).toBe(0);
  });

  it("starts a held sentence on its own timer when nothing more arrives", () => {
    const player = new PcmPlayer({ sampleRate: RATE });
    // 100 ms in hand: enough to start on the timer (a lone frame waits).
    for (let i = 0; i < 5; i += 1) player.queue(pcmFrame());
    expect(FakeSource.all).toHaveLength(0);
    const ctx = FakeAudioContext.last;
    if (ctx === null) throw new Error("no context");
    ctx.currentTime = 0.25;
    vi.advanceTimersByTime(250);
    expect(FakeSource.all).toHaveLength(1);
  });

  it("stops at once on barge-in and keeps the context for the next reply", () => {
    const player = new PcmPlayer({ sampleRate: RATE });
    for (let i = 0; i < 20; i += 1) player.queue(pcmFrame());
    expect(player.getRemainingPlaybackTime()).toBeGreaterThan(0.3);
    player.interrupt();
    expect(FakeSource.all.every((s) => s.stopped)).toBe(true);
    expect(player.getRemainingPlaybackTime()).toBe(0);
    expect(FakeAudioContext.last?.closed).toBe(false);
    player.dispose();
    expect(FakeAudioContext.last?.closed).toBe(true);
  });
});

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  readonly url: string;
  readonly protocols: string[];
  binaryType = "blob";
  readyState = 0;
  readonly sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data });
  }
}

function socketUnderTest() {
  const socket = new AgentSocket({
    token: "grant",
    agent: { language: "en" },
    input: { encoding: "linear16", sampleRate: 16_000 },
    output: { encoding: "linear16", sampleRate: 24_000 },
    WebSocket: FakeWebSocket as unknown as typeof WebSocket,
  });
  return socket;
}

describe("AgentSocket", () => {
  it("delivers Q's audio synchronously as the ArrayBuffer it arrived as", async () => {
    const socket = socketUnderTest();
    const heard: ArrayBuffer[] = [];
    socket.on("audio", (chunk) => heard.push(chunk));
    const connecting = socket.connect();
    const ws = FakeWebSocket.last;
    if (ws === null) throw new Error("no socket");
    expect(ws.binaryType).toBe("arraybuffer");
    expect(ws.protocols).toEqual(["bearer", "grant"]);
    ws.open();
    await connecting;
    const chunk = new ArrayBuffer(960);
    ws.message(chunk);
    // No await in between: the frame is not routed through a Blob read.
    expect(heard).toEqual([chunk]);
  });

  it("sends the settings on Welcome and holds microphone frames until they apply", async () => {
    const socket = socketUnderTest();
    const connecting = socket.connect();
    const ws = FakeWebSocket.last;
    if (ws === null) throw new Error("no socket");
    ws.open();
    await connecting;
    const early = new ArrayBuffer(4);
    socket.sendAudio(early);
    expect(ws.sent).toHaveLength(0);
    ws.message(JSON.stringify({ type: "Welcome" }));
    const settings = JSON.parse(String(ws.sent[0])) as {
      type: string;
      agent: unknown;
      audio: { output: { sample_rate: number; container: string } };
    };
    expect(settings.type).toBe("Settings");
    expect(settings.agent).toEqual({ language: "en" });
    expect(settings.audio.output).toMatchObject({
      sample_rate: 24_000,
      container: "none",
    });
    ws.message(JSON.stringify({ type: "SettingsApplied" }));
    expect(ws.sent[1]).toBe(early);
    const later = new ArrayBuffer(4);
    socket.sendAudio(later);
    expect(ws.sent[2]).toBe(later);
    socket.disconnect();
  });

  it("validates server messages and ignores what it cannot read", async () => {
    const socket = socketUnderTest();
    const lines: string[] = [];
    socket.on("conversation-text", (m) => lines.push(m.content));
    const connecting = socket.connect();
    const ws = FakeWebSocket.last;
    if (ws === null) throw new Error("no socket");
    ws.open();
    await connecting;
    ws.message("not json");
    ws.message(JSON.stringify({ type: "ConversationText", role: "assistant" }));
    ws.message(
      JSON.stringify({
        type: "ConversationText",
        role: "assistant",
        content: "Hi",
      }),
    );
    expect(lines).toEqual(["Hi"]);
  });

  it("reports a drop from the other side, and not its own close", async () => {
    const socket = socketUnderTest();
    const dropped = vi.fn();
    socket.on("disconnected", dropped);
    let connecting = socket.connect();
    let ws = FakeWebSocket.last;
    if (ws === null) throw new Error("no socket");
    ws.open();
    await connecting;
    socket.disconnect();
    expect(dropped).not.toHaveBeenCalled();

    connecting = socket.connect();
    ws = FakeWebSocket.last;
    if (ws === null) throw new Error("no socket");
    ws.open();
    await connecting;
    ws.onclose?.({ code: 1011 });
    expect(dropped).toHaveBeenCalledOnce();
  });

  it("rejects a line that never opens", async () => {
    const socket = socketUnderTest();
    const connecting = socket.connect();
    FakeWebSocket.last?.onclose?.({ code: 1006 });
    await expect(connecting).rejects.toThrow();
  });
});
