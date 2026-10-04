// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QVoiceDuplexCredential,
  QVoiceDuplexToolResult,
  QVoiceListeningLevel,
} from "@capital-q/contracts";

import {
  BackchannelPolicy,
  overlongReaction,
  PauseDetector,
  resolveListeningLevel,
} from "../src/features/voice/provider/backchannel";
import {
  BACKCHANNEL_GAIN,
  BRIDGE_AFTER_MS,
  DuplexLine,
  type DuplexEnvironment,
  type DuplexLineEvents,
  type DuplexRelays,
} from "../src/features/voice/provider/duplex-line";

/**
 * BACKCHANNEL: Q listening like a person, deterministically. The policy
 * with simulated pauses and turns; the line with a fake microphone level,
 * a fake data channel and fake timers. No network, no provider, no key:
 * every "provider" event here is emitted by the test.
 */

// ---------------------------------------------------------------------------
// The policy, on its own
// ---------------------------------------------------------------------------

/** Speak for `ms`, then pause; returns the time the pause began. */
function talk(policy: BackchannelPolicy, from: number, ms: number): number {
  policy.voiceStarted(from);
  policy.pauseStarted(from + ms);
  return from + ms;
}

describe("when Q may react (the policy)", () => {
  it("never reacts while the person is voiced: only in a pause", () => {
    const policy = new BackchannelPolicy("NATURAL");
    policy.turnStarted(0);
    policy.voiceStarted(0);
    for (let at = 0; at <= 10_000; at += 50) {
      expect(policy.due(at)).toBe(false);
    }
    policy.pauseStarted(10_000);
    // A gap between words is not a pause.
    expect(policy.due(10_200)).toBe(false);
    expect(policy.due(10_400)).toBe(true);
  });

  it("never reacts to a quick command, at any level", () => {
    for (const level of ["SUBTLE", "NATURAL"] as const) {
      const policy = new BackchannelPolicy(level);
      policy.turnStarted(0);
      const paused = talk(policy, 0, 1_800);
      expect(policy.due(paused + 500)).toBe(false);
    }
  });

  it("never reacts when it is off", () => {
    const policy = new BackchannelPolicy("OFF");
    policy.turnStarted(0);
    const paused = talk(policy, 0, 30_000);
    expect(policy.due(paused + 500)).toBe(false);
  });

  it("subtle is sparser than natural for the same speech", () => {
    const count = (level: QVoiceListeningLevel) => {
      const policy = new BackchannelPolicy(level);
      policy.turnStarted(0);
      let at = 0;
      let fired = 0;
      // A 40-second story in 3-second phrases with half-second pauses.
      for (let i = 0; i < 12; i += 1) {
        const paused = talk(policy, at, 3_000);
        if (policy.due(paused + 500)) {
          policy.fired(paused + 500);
          policy.landed("mm-hm");
          fired += 1;
        }
        at = paused + 500;
      }
      return fired;
    };
    const subtle = count("SUBTLE");
    const natural = count("NATURAL");
    expect(subtle).toBeGreaterThanOrEqual(1);
    expect(subtle).toBeLessThanOrEqual(2);
    expect(natural).toBeGreaterThan(subtle);
    expect(natural).toBeLessThanOrEqual(5);
  });

  it("never reacts twice in quick succession", () => {
    const policy = new BackchannelPolicy("NATURAL");
    policy.turnStarted(0);
    let paused = talk(policy, 0, 4_000);
    expect(policy.due(paused + 400)).toBe(true);
    policy.fired(paused + 400);
    policy.landed("yeah");
    // Speech since, but not enough time or speech: quiet.
    paused = talk(policy, paused + 450, 1_500);
    expect(policy.due(paused + 400)).toBe(false);
    // Enough of both: it may react again.
    paused = talk(policy, paused + 450, 4_000);
    expect(policy.due(paused + 400)).toBe(true);
  });

  it("waits out a pause too long to be mid-turn: the turn is probably over", () => {
    const policy = new BackchannelPolicy("NATURAL");
    policy.turnStarted(0);
    const paused = talk(policy, 0, 5_000);
    expect(policy.due(paused + 950)).toBe(false);
    // And that pause is spent: no late reaction.
    expect(policy.due(paused + 400)).toBe(false);
  });

  it("is quiet while Q is speaking, answering or working", () => {
    const policy = new BackchannelPolicy("NATURAL");
    policy.turnStarted(0);
    policy.setBusy(true);
    const paused = talk(policy, 0, 5_000);
    expect(policy.due(paused + 400)).toBe(false);
  });

  it("backs off when talked over and relaxes when a reaction lands", () => {
    const policy = new BackchannelPolicy("NATURAL");
    expect(policy.backoff).toBe(1);
    policy.cut();
    policy.cut();
    expect(policy.backoff).toBeCloseTo(2.25);
    policy.cut();
    policy.cut();
    expect(policy.backoff).toBe(3);
    policy.landed("mm");
    expect(policy.backoff).toBeLessThan(3);
  });

  it("adapts the pause it waits for to how this person pauses", () => {
    const policy = new BackchannelPolicy("NATURAL");
    policy.turnStarted(0);
    expect(policy.triggerMs()).toBe(350);
    let at = 0;
    for (let i = 0; i < 6; i += 1) {
      const paused = talk(policy, at, 1_000);
      at = paused + 700;
      policy.voiceStarted(at);
    }
    expect(policy.triggerMs()).toBeGreaterThan(500);
    expect(policy.triggerMs()).toBeLessThanOrEqual(650);
  });

  it("treats speech resuming right after an 'end' as the same turn", () => {
    const policy = new BackchannelPolicy("SUBTLE");
    expect(policy.turnStarted(0)).toBe(true);
    policy.turnEnded(3_000);
    expect(policy.turnStarted(3_800)).toBe(false);
    policy.turnEnded(9_000);
    expect(policy.turnStarted(20_000)).toBe(true);
  });

  it("hears voice and pauses against the noise floor, with hysteresis", () => {
    const detector = new PauseDetector();
    for (let i = 0; i < 20; i += 1) expect(detector.feed(0.004)).toBeNull();
    // A one-frame click is not a voice.
    expect(detector.feed(0.3)).toBeNull();
    expect(detector.feed(0.004)).toBeNull();
    expect(detector.feed(0.2)).toBeNull();
    expect(detector.feed(0.2)).toBe("VOICE");
    expect(detector.feed(0.2)).toBeNull();
    expect(detector.feed(0.003)).toBe("PAUSE");
  });

  it("cuts a 'reaction' that is really a sentence or a number", () => {
    expect(overlongReaction("oh no", 4)).toBe(false);
    expect(overlongReaction("wow, really?", 4)).toBe(false);
    expect(overlongReaction("your revenue is up this quarter", 4)).toBe(true);
    expect(overlongReaction("about 40", 4)).toBe(true);
  });

  it("uses whichever level was set last: this device's toggle or the person's voice", () => {
    expect(
      resolveListeningLevel(
        { level: "OFF", setAt: "2026-10-04T10:00:00Z" },
        null,
      ),
    ).toBe("OFF");
    expect(
      resolveListeningLevel(
        { level: "OFF", setAt: "2026-10-04T10:00:00Z" },
        { level: "NATURAL", setAt: "2026-10-04T11:00:00Z" },
      ),
    ).toBe("NATURAL");
    expect(
      resolveListeningLevel(
        { level: "OFF", setAt: "2026-10-04T12:00:00Z" },
        { level: "NATURAL", setAt: "2026-10-04T11:00:00Z" },
      ),
    ).toBe("OFF");
    expect(
      resolveListeningLevel(
        { level: "SUBTLE", setAt: null },
        { level: "OFF", setAt: "2026-10-01T11:00:00Z" },
      ),
    ).toBe("OFF");
  });
});

// ---------------------------------------------------------------------------
// The line, with a fake microphone level and provider events
// ---------------------------------------------------------------------------

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
  ofType(type: string) {
    return this.sent.filter((event) => event.type === type);
  }
}

class FakePeer {
  channel: FakeChannel | null = null;
  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTrack() {
    return undefined;
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
  close() {
    return undefined;
  }
}

const LISTENING = {
  level: "SUBTLE" as const,
  setAt: null,
  backchannelInstructions: "REACTION RULES",
  bridgeInstructions: "BRIDGE RULES",
};

function lineHarness(
  options: {
    readonly level?: QVoiceListeningLevel;
    readonly tool?: () => Promise<QVoiceDuplexToolResult | null>;
  } = {},
) {
  const peer = new FakePeer();
  const track = { enabled: true, stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const audio = { volume: 1, srcObject: null, autoplay: true };
  const mic = { rms: 0.003 };
  const credential: QVoiceDuplexCredential = {
    clientSecret: "ek_fake_secret",
    callsUrl: "https://realtime.invalid/v1/realtime/calls",
    expiresAt: "2099-01-01T00:00:00.000Z",
    maxSessionMs: 600_000,
    idleMs: 120_000,
    listening: LISTENING,
  };
  const environment: DuplexEnvironment = {
    createPeer: () => peer as unknown as RTCPeerConnection,
    getMicrophone: () => Promise.resolve(stream),
    fetch: () => Promise.resolve(new Response("v=0 answer", { status: 201 })),
    createAudio: () => audio as unknown as HTMLAudioElement,
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    createLevelMeter: () => ({ read: () => mic.rms, close: vi.fn() }),
  };
  const relays = {
    tool: vi.fn<DuplexRelays["tool"]>(
      options.tool ??
        (() =>
          Promise.resolve({
            output: JSON.stringify({ ok: true, say: "Done." }),
            approvalPending: false,
          })),
    ),
    usage: vi.fn<DuplexRelays["usage"]>(() =>
      Promise.resolve({ continue: true }),
    ),
    end: vi.fn<DuplexRelays["end"]>(() => Promise.resolve()),
  };
  const events = {
    onState: vi.fn<DuplexLineEvents["onState"]>(),
    onLine: vi.fn<DuplexLineEvents["onLine"]>(),
    onInterrupted: vi.fn<DuplexLineEvents["onInterrupted"]>(),
    onFallback: vi.fn<DuplexLineEvents["onFallback"]>(),
    onEnded: vi.fn<DuplexLineEvents["onEnded"]>(),
    onListening: vi.fn<NonNullable<DuplexLineEvents["onListening"]>>(),
  };
  const line = new DuplexLine({
    credential,
    relays,
    events,
    environment,
    listening: options.level ?? "SUBTLE",
  });
  const channel = () => {
    if (peer.channel === null) throw new Error("no channel");
    return peer.channel;
  };
  const speak = async (ms: number) => {
    mic.rms = 0.2;
    await vi.advanceTimersByTimeAsync(ms);
  };
  const pause = async (ms: number) => {
    mic.rms = 0.003;
    await vi.advanceTimersByTimeAsync(ms);
  };
  /** The out-of-band response.create events (reactions and bridges). */
  const outOfBand = () =>
    channel()
      .ofType("response.create")
      .map((event) => event.response as Record<string, unknown> | undefined)
      .filter((response) => response?.conversation === "none");
  return {
    line,
    channel,
    audio,
    relays,
    events,
    speak,
    pause,
    outOfBand,
  };
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/** The person talks for a while, then pauses mid-turn, until Q reacts. */
async function storyUntilReaction(h: ReturnType<typeof lineHarness>) {
  h.channel().emit({ type: "input_audio_buffer.speech_started" });
  await h.speak(6_000);
  await h.pause(500);
  expect(h.channel().ofType("input_audio_buffer.commit")).toHaveLength(1);
  h.channel().emit({ type: "input_audio_buffer.committed", item_id: "item_1" });
  const [reaction] = h.outOfBand();
  if (reaction === undefined) throw new Error("no reaction asked for");
  const metadata = reaction.metadata as { cq_id: string };
  return { reaction, id: metadata.cq_id };
}

describe("Q reacting on the line", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for one tiny, audio-only, tool-less, out-of-band reaction at a mid-turn pause", async () => {
    const h = lineHarness();
    expect(await h.line.open()).toBe(true);
    const { reaction } = await storyUntilReaction(h);
    expect(reaction).toMatchObject({
      conversation: "none",
      output_modalities: ["audio"],
      instructions: "REACTION RULES",
      max_output_tokens: 40,
      tools: [],
      tool_choice: "none",
    });
    // It hears this turn's audio, by reference, and nothing older.
    expect(JSON.stringify(reaction.input)).toContain(
      '{"type":"item_reference","id":"item_1"}',
    );
    h.line.close();
  });

  it("never reacts while the person is still talking", async () => {
    const h = lineHarness({ level: "NATURAL" });
    await h.line.open();
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    await h.speak(20_000);
    expect(h.channel().ofType("input_audio_buffer.commit")).toHaveLength(0);
    expect(h.outOfBand()).toHaveLength(0);
    h.line.close();
  });

  it("is silent when off, however long the story", async () => {
    const h = lineHarness({ level: "OFF" });
    await h.line.open();
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    for (let i = 0; i < 8; i += 1) {
      await h.speak(4_000);
      await h.pause(500);
    }
    expect(h.channel().ofType("input_audio_buffer.commit")).toHaveLength(0);
    h.line.close();
  });

  it("plays quieter, is never a line or Q's turn, and is reported for the cap", async () => {
    const h = lineHarness();
    await h.line.open();
    const { id } = await storyUntilReaction(h);
    const ch = h.channel();
    ch.emit({
      type: "response.created",
      response: {
        id: "resp_bc",
        metadata: { cq_kind: "BACKCHANNEL", cq_id: id },
      },
    });
    ch.emit({ type: "output_audio_buffer.started", response_id: "resp_bc" });
    expect(h.audio.volume).toBeCloseTo(BACKCHANNEL_GAIN);
    ch.emit({
      type: "response.output_audio_transcript.done",
      response_id: "resp_bc",
      transcript: "Oh no.",
    });
    ch.emit({
      type: "response.done",
      response: {
        id: "resp_bc",
        status: "completed",
        usage: {
          input_token_details: { text_tokens: 400, audio_tokens: 90 },
          output_token_details: { text_tokens: 3, audio_tokens: 14 },
        },
      },
    });
    ch.emit({ type: "output_audio_buffer.stopped", response_id: "resp_bc" });
    await settle();
    expect(h.audio.volume).toBe(1);
    expect(h.events.onLine).not.toHaveBeenCalled();
    expect(h.events.onState).not.toHaveBeenCalledWith("Q_SPEAKING");
    expect(h.relays.usage).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "resp_bc",
        kind: "BACKCHANNEL",
        outputAudioTokens: 14,
      }),
    );
    // The person carrying on is not a barge-in on Q.
    ch.emit({ type: "input_audio_buffer.speech_started" });
    expect(h.events.onInterrupted).not.toHaveBeenCalled();
    expect(ch.ofType("conversation.item.truncate")).toHaveLength(0);
    h.line.close();
  });

  it("is cut the instant the person resumes", async () => {
    const h = lineHarness();
    await h.line.open();
    const { id } = await storyUntilReaction(h);
    const ch = h.channel();
    ch.emit({
      type: "response.created",
      response: {
        id: "resp_bc",
        metadata: { cq_kind: "BACKCHANNEL", cq_id: id },
      },
    });
    ch.emit({ type: "output_audio_buffer.started", response_id: "resp_bc" });
    await h.speak(150);
    expect(ch.ofType("response.cancel")).toContainEqual({
      type: "response.cancel",
      response_id: "resp_bc",
    });
    expect(ch.ofType("output_audio_buffer.clear")).toHaveLength(1);
    expect(h.audio.volume).toBe(0);
    h.line.close();
  });

  it("is never asked for when the person resumed before the commit came back", async () => {
    const h = lineHarness();
    await h.line.open();
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    await h.speak(6_000);
    await h.pause(500);
    expect(h.channel().ofType("input_audio_buffer.commit")).toHaveLength(1);
    await h.speak(150);
    h.channel().emit({
      type: "input_audio_buffer.committed",
      item_id: "item_1",
    });
    expect(h.outOfBand()).toHaveLength(0);
    h.line.close();
  });

  it("cuts a reaction that turns into a sentence or a number", async () => {
    const h = lineHarness();
    await h.line.open();
    const { id } = await storyUntilReaction(h);
    const ch = h.channel();
    ch.emit({
      type: "response.created",
      response: {
        id: "resp_bc",
        metadata: { cq_kind: "BACKCHANNEL", cq_id: id },
      },
    });
    ch.emit({
      type: "response.output_audio_transcript.delta",
      response_id: "resp_bc",
      delta: "Your revenue grew 40",
    });
    expect(ch.ofType("response.cancel")).toHaveLength(1);
    h.line.close();
  });

  it("ignores any function call a reaction proposes", async () => {
    const h = lineHarness();
    await h.line.open();
    const { id } = await storyUntilReaction(h);
    const ch = h.channel();
    ch.emit({
      type: "response.created",
      response: {
        id: "resp_bc",
        metadata: { cq_kind: "BACKCHANNEL", cq_id: id },
      },
    });
    ch.emit({
      type: "response.function_call_arguments.done",
      response_id: "resp_bc",
      call_id: "call_x",
      name: "ask_q",
      arguments: '{"request":"do it"}',
    });
    await settle();
    expect(h.relays.tool).not.toHaveBeenCalled();
    h.line.close();
  });

  it("reports the transcriber's usage in the same ledger", async () => {
    const h = lineHarness();
    await h.line.open();
    h.channel().emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_9",
      transcript: "so the raise is going slowly",
      usage: {
        type: "tokens",
        input_tokens: 60,
        output_tokens: 9,
        input_token_details: { text_tokens: 0, audio_tokens: 60 },
      },
    });
    await settle();
    expect(h.relays.usage).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "tx_item_9",
        kind: "TRANSCRIPTION",
        inputAudioTokens: 60,
        outputTextTokens: 9,
      }),
    );
    h.line.close();
  });
});

describe("changing it by voice and in Settings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("'stop doing that' relays the person's transcribed words, applies OFF at once, and tells the device", async () => {
    const h = lineHarness({
      tool: () =>
        Promise.resolve({
          output: JSON.stringify({ ok: true, level: "OFF", remembered: true }),
          approvalPending: false,
          listening: "OFF",
        }),
    });
    await h.line.open();
    h.channel().emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_2",
      transcript: "Q, stop doing that.",
    });
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_listen",
      name: "set_listening",
      arguments: '{"change":"OFF","quote":"stop doing that"}',
    });
    await settle();
    expect(h.relays.tool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "set_listening",
        heard: ["Q, stop doing that."],
        listening: "SUBTLE",
      }),
    );
    expect(h.line.listening).toBe("OFF");
    expect(h.events.onListening).toHaveBeenCalledWith("OFF");
    // The turn detector answers sooner again: nothing listens for pauses.
    expect(JSON.stringify(h.channel().ofType("session.update"))).toContain(
      '"eagerness":"high"',
    );
    // Q then confirms once, in its own turn.
    expect(h.channel().ofType("response.create").at(-1)).toEqual({
      type: "response.create",
    });
    // And it stays quiet afterwards.
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    for (let i = 0; i < 6; i += 1) {
      await h.speak(4_000);
      await h.pause(500);
    }
    expect(h.channel().ofType("input_audio_buffer.commit")).toHaveLength(0);
    h.line.close();
  });

  it("follows the Settings toggle on an open line", async () => {
    const h = lineHarness({ level: "OFF" });
    await h.line.open();
    h.line.setListening("NATURAL");
    expect(h.line.listening).toBe("NATURAL");
    expect(JSON.stringify(h.channel().ofType("session.update"))).toContain(
      '"eagerness":"auto"',
    );
    h.line.close();
  });
});

describe("bridging a slow answer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const askQ = {
    type: "response.function_call_arguments.done",
    call_id: "call_1",
    name: "ask_q",
    arguments: '{"request":"How are Kazikit\'s numbers looking?"}',
  };

  it("says nothing when the answer is fast", async () => {
    const h = lineHarness();
    await h.line.open();
    h.channel().emit(askQ);
    await settle();
    await vi.advanceTimersByTimeAsync(BRIDGE_AFTER_MS + 100);
    expect(h.outOfBand()).toHaveLength(0);
    h.line.close();
  });

  it("asks for one line from their own request when it is slow, and holds the answer until it is said", async () => {
    let answer: (value: QVoiceDuplexToolResult) => void = () => undefined;
    const h = lineHarness({
      tool: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await h.line.open();
    const ch = h.channel();
    ch.emit(askQ);
    await vi.advanceTimersByTimeAsync(BRIDGE_AFTER_MS + 50);
    const bridges = h.outOfBand();
    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({
      instructions: "BRIDGE RULES",
      tools: [],
      tool_choice: "none",
    });
    expect(JSON.stringify(bridges[0]?.input)).toContain("Kazikit");
    const id = (bridges[0]?.metadata as { cq_id: string }).cq_id;
    ch.emit({
      type: "response.created",
      response: { id: "resp_br", metadata: { cq_kind: "BRIDGE", cq_id: id } },
    });
    ch.emit({ type: "output_audio_buffer.started", response_id: "resp_br" });
    // The answer arrives while the bridge is still being said.
    answer({
      output: JSON.stringify({ ok: true, say: "They grew." }),
      approvalPending: false,
    });
    await settle();
    const mainCreates = () =>
      ch
        .ofType("response.create")
        .filter((event) => event.response === undefined);
    expect(mainCreates()).toHaveLength(0);
    ch.emit({
      type: "response.done",
      response: { id: "resp_br", status: "completed", usage: {} },
    });
    ch.emit({ type: "output_audio_buffer.stopped", response_id: "resp_br" });
    await settle();
    expect(mainCreates()).toHaveLength(1);
    expect(h.relays.usage).toHaveBeenCalledWith(
      expect.objectContaining({ responseId: "resp_br", kind: "BRIDGE" }),
    );
    h.line.close();
  });

  it("does not bridge when listening is off", async () => {
    const h = lineHarness({
      level: "OFF",
      tool: () => new Promise(() => undefined),
    });
    await h.line.open();
    h.channel().emit(askQ);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.outOfBand()).toHaveLength(0);
    h.line.close();
  });
});
