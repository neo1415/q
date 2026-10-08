// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QVoiceDuplexCredential,
  QVoiceDuplexHeardResult,
  QVoiceDuplexToolResult,
} from "@capital-q/contracts";

import {
  ANSWER_AUDIO_WATCHDOG_MS,
  ANSWER_NOT_SPOKEN_NOTICE,
  BARGE_CONFIRM_MS,
  DELIVERY_REPAIR,
  DuplexLine,
  IGNORED_NOTICE,
  THINKING_WATCHDOG_MS,
  TIMEOUT_REPAIR,
  type DuplexEnvironment,
  type DuplexLineEvents,
  type DuplexRelays,
  type DuplexTurnOutcome,
} from "../src/features/voice/provider/duplex-line";

/**
 * RECOVERY-2026-10, workstream A, in the browser: every accepted turn on
 * the duplex line ends in exactly one disposition, visibly (A4); a result
 * is never lost to a rejoin (A5) nor said after a newer turn (A6); a cough
 * never costs an answer and a short real word is never thrown away (A7);
 * the presence has real levels (A9). A fake RTCPeerConnection and data
 * channel: no network, no provider, no key.
 */

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
  creates() {
    return this.sent.filter((event) => event.type === "response.create");
  }
}

class FakePeer {
  channel: FakeChannel | null = null;
  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
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
    this.closed = true;
  }
  fail() {
    this.connectionState = "failed";
    this.onconnectionstatechange?.();
  }
}

const ROUTED: QVoiceDuplexCredential = {
  clientSecret: "ek_fake_secret",
  callsUrl: "https://realtime.invalid/v1/realtime/calls",
  expiresAt: "2099-01-01T00:00:00.000Z",
  maxSessionMs: 600_000,
  idleMs: 600_000,
  routeTurns: true,
};

const ANSWER: QVoiceDuplexHeardResult = {
  route: "ASK_Q",
  callId: "cq_1",
  arguments: JSON.stringify({ request: "Who fits?" }),
  output: JSON.stringify({ ok: true, say: "Three investors fit." }),
  approvalPending: false,
  disposition: "ANSWERED",
};

function harness(
  options: {
    readonly heard?: DuplexRelays["heard"];
    readonly tool?: () => Promise<QVoiceDuplexToolResult | null>;
    readonly rejoin?: DuplexRelays["rejoin"];
    readonly credential?: QVoiceDuplexCredential;
    readonly level?: number;
    readonly location?: string;
  } = {},
) {
  const peer = new FakePeer();
  const track = { enabled: true, stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const audio = { volume: 1, srcObject: null, autoplay: true };
  const environment: DuplexEnvironment = {
    createPeer: () => peer as unknown as RTCPeerConnection,
    getMicrophone: () => Promise.resolve(stream),
    fetch: () =>
      Promise.resolve(
        new Response("v=0 answer", {
          status: 201,
          headers:
            options.location === undefined
              ? {}
              : { location: options.location },
        }),
      ),
    createAudio: () => audio as unknown as HTMLAudioElement,
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    createLevelMeter: () => ({
      read: () => options.level ?? 0.1,
      close: () => undefined,
    }),
  };
  const outcomes: DuplexTurnOutcome[] = [];
  const relays = {
    tool: vi.fn<DuplexRelays["tool"]>(
      options.tool ??
        (() =>
          Promise.resolve({
            output: JSON.stringify({ ok: true, say: "Done." }),
            approvalPending: false,
            disposition: "ANSWERED" as const,
          })),
    ),
    usage: vi.fn<DuplexRelays["usage"]>(() =>
      Promise.resolve({ continue: true }),
    ),
    end: vi.fn<DuplexRelays["end"]>(() => Promise.resolve()),
    heard: vi.fn<NonNullable<DuplexRelays["heard"]>>(
      options.heard ?? (() => Promise.resolve(ANSWER)),
    ),
    said: vi.fn<NonNullable<DuplexRelays["said"]>>(() => Promise.resolve()),
    outcome: vi.fn<NonNullable<DuplexRelays["outcome"]>>(() =>
      Promise.resolve(),
    ),
    attach: vi.fn<NonNullable<DuplexRelays["attach"]>>(() => Promise.resolve()),
    ...(options.rejoin === undefined ? {} : { rejoin: options.rejoin }),
  };
  const events = {
    onState: vi.fn<DuplexLineEvents["onState"]>(),
    onLine: vi.fn<DuplexLineEvents["onLine"]>(),
    onInterrupted: vi.fn<DuplexLineEvents["onInterrupted"]>(),
    onFallback: vi.fn<DuplexLineEvents["onFallback"]>(),
    onEnded: vi.fn<DuplexLineEvents["onEnded"]>(),
    onTurnOutcome: (outcome: DuplexTurnOutcome) => {
      outcomes.push(outcome);
    },
  };
  const line = new DuplexLine({
    credential: options.credential ?? ROUTED,
    relays,
    events,
    environment,
  });
  const channel = () => {
    if (peer.channel === null) throw new Error("no channel");
    return peer.channel;
  };
  return { line, peer, channel, audio, relays, events, outcomes };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

type H = ReturnType<typeof harness>;

/** The person says something; the provider commits and transcribes it. */
function say(h: H, itemId: string, transcript: string | null) {
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
}

/** Q's answer is created and starts being heard. */
/** Q's answer is created and its audio starts (not yet confirmed said). */
function qStarts(h: H, responseId = "resp_a") {
  h.channel().emit({ type: "response.created", response: { id: responseId } });
  h.channel().emit({
    type: "response.output_item.added",
    item: { id: `item_${responseId}`, type: "message" },
  });
  h.channel().emit({
    type: "output_audio_buffer.started",
    response_id: responseId,
  });
}

/** ...and its transcript confirms it was said (INC-1). */
function qSpeaks(h: H, responseId = "resp_a", words = "Three investors fit.") {
  qStarts(h, responseId);
  h.channel().emit({
    type: "response.output_audio_transcript.done",
    response_id: responseId,
    transcript: words,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("A4: every accepted turn ends in one disposition", () => {
  it("ANSWERED when Q's answer is heard, with time to first audio and the relay's round trip", async () => {
    const h = harness();
    await h.line.open();
    say(h, "item_1", "Who fits my raise?");
    await settle();
    expect(h.outcomes).toEqual([]);
    vi.advanceTimersByTime(300);
    qStarts(h);
    // INC-1: audio alone is not "said"; the transcript confirms it.
    expect(h.outcomes).toEqual([]);
    vi.advanceTimersByTime(2_000);
    h.channel().emit({
      type: "response.output_audio_transcript.done",
      response_id: "resp_a",
      transcript: "Three investors fit.",
    });
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0]).toMatchObject({ disposition: "ANSWERED" });
    expect(h.outcomes[0]?.turnId).toMatch(/^turn_[A-Za-z0-9_-]{8,64}$/);
    expect(h.outcomes[0]?.firstAudioMs).toBeGreaterThanOrEqual(300);
    expect(h.outcomes[0]?.relayMs).toBeGreaterThanOrEqual(0);
    // And the server's per-turn log gets ids and milliseconds only.
    expect(h.relays.outcome).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: "ANSWERED" }),
    );
    expect(JSON.stringify(h.relays.outcome.mock.calls)).not.toContain(
      "Who fits",
    );
  });

  it("IGNORED, shown, and the voice is never asked to improvise when Q chose silence", async () => {
    const h = harness({
      heard: () =>
        Promise.resolve({
          ...ANSWER,
          output: JSON.stringify({ ok: true, say: "" }),
          silent: true,
          disposition: "IGNORED" as const,
        }),
    });
    await h.line.open();
    say(h, "item_1", "no, I was talking to Sam");
    await settle();
    expect(h.channel().creates()).toEqual([]);
    expect(h.outcomes).toEqual([
      expect.objectContaining({
        disposition: "IGNORED",
        notice: IGNORED_NOTICE,
      }),
    ]);
    expect(h.events.onState).toHaveBeenLastCalledWith("LISTENING");
  });

  it("IGNORED on a model-called ask_q too, with no response asked for", async () => {
    const h = harness({
      credential: { ...ROUTED, routeTurns: undefined },
      tool: () =>
        Promise.resolve({
          output: JSON.stringify({ ok: true, say: "" }),
          approvalPending: false,
          silent: true,
          disposition: "IGNORED" as const,
        }),
    });
    await h.line.open();
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_1",
      name: "ask_q",
      arguments: JSON.stringify({ request: "mm" }),
    });
    await settle();
    expect(h.channel().creates()).toEqual([]);
    expect(h.outcomes.at(-1)).toMatchObject({ disposition: "IGNORED" });
  });

  it("FAILED/RESULT_DELIVERY on a realtime error for the answer: said briefly and shown", async () => {
    const h = harness();
    await h.line.open();
    say(h, "item_1", "Who fits?");
    await settle();
    const create = h.channel().creates().at(-1);
    h.channel().emit({
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "some_failure",
        event_id: create?.event_id,
      },
    });
    expect(h.outcomes.at(-1)).toMatchObject({
      disposition: "FAILED",
      failure: "RESULT_DELIVERY",
      notice: DELIVERY_REPAIR,
    });
    // The repair line is out of band: it never enters the conversation.
    expect(h.channel().creates().at(-1)).toMatchObject({
      response: { conversation: "none" },
    });
    expect(JSON.stringify(h.channel().creates().at(-1))).toContain(
      "lost my words",
    );
  });

  it("asks again, rather than losing the answer, when another response was still running", async () => {
    const h = harness();
    await h.line.open();
    say(h, "item_1", "Who fits?");
    await settle();
    const create = h.channel().creates().at(-1);
    h.channel().emit({
      type: "error",
      error: {
        code: "conversation_already_has_active_response",
        event_id: create?.event_id,
      },
    });
    expect(h.outcomes).toEqual([]);
    const before = h.channel().creates().length;
    h.channel().emit({
      type: "response.done",
      response: { id: "resp_other", status: "completed", output: [] },
    });
    expect(h.channel().creates().length).toBe(before + 1);
    qSpeaks(h, "resp_retry");
    expect(h.outcomes.at(-1)).toMatchObject({ disposition: "ANSWERED" });
  });

  it("FAILED when the answer's response fails without a word", async () => {
    const h = harness();
    await h.line.open();
    say(h, "item_1", "Who fits?");
    await settle();
    h.channel().emit({ type: "response.created", response: { id: "resp_f" } });
    h.channel().emit({
      type: "response.done",
      response: {
        id: "resp_f",
        status: "failed",
        status_details: { reason: "server_error" },
        output: [],
      },
    });
    expect(h.outcomes.at(-1)).toMatchObject({
      disposition: "FAILED",
      failure: "RESULT_DELIVERY",
    });
    expect(h.events.onState).toHaveBeenLastCalledWith("LISTENING");
  });

  it("the Thinking watchdog: a turn whose relay never answers ends FAILED/TIMEOUT, out loud", async () => {
    const h = harness({ heard: () => new Promise(() => undefined) });
    await h.line.open();
    say(h, "item_1", "Build me a strategy.");
    await settle();
    vi.advanceTimersByTime(THINKING_WATCHDOG_MS - 1);
    expect(h.outcomes).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(h.outcomes.at(-1)).toMatchObject({
      disposition: "FAILED",
      failure: "TIMEOUT",
      notice: TIMEOUT_REPAIR,
    });
    expect(h.events.onState).toHaveBeenLastCalledWith("LISTENING");
  });

  it("an answer handed over but never said ends with ONE line: the code-built answer itself (INC-1)", async () => {
    const h = harness();
    await h.line.open();
    say(h, "item_1", "Who fits?");
    await settle();
    vi.advanceTimersByTime(ANSWER_AUDIO_WATCHDOG_MS + 1);
    expect(h.outcomes).toEqual([
      expect.objectContaining({
        disposition: "FAILED",
        failure: "RESULT_DELIVERY",
        notice: ANSWER_NOT_SPOKEN_NOTICE,
      }),
    ]);
    const fallback = h
      .channel()
      .creates()
      .filter((e) => JSON.stringify(e).includes("Three investors fit."));
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({ response: { conversation: "none" } });
    // Nothing loops: no further line, however long.
    vi.advanceTimersByTime(120_000);
    expect(h.outcomes).toHaveLength(1);
  });

  it("SUPERSEDED: a newer turn replaces one still working, and the older answer is not said", async () => {
    let first: (value: QVoiceDuplexHeardResult) => void = () => undefined;
    let calls = 0;
    const h = harness({
      heard: () => {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              first = resolve;
            })
          : new Promise(() => undefined);
      },
    });
    await h.line.open();
    say(h, "item_1", "Who fits?");
    await settle();
    say(h, "item_2", "Actually, open my deck.");
    await settle();
    expect(h.outcomes.at(-1)).toMatchObject({ disposition: "SUPERSEDED" });
    first(ANSWER);
    await settle();
    expect(h.channel().creates()).toEqual([]);
  });

  it("SMALLTALK: the voice may only reply to the pleasantry; MODEL: only through decide_card", async () => {
    const h = harness({ heard: () => Promise.resolve({ route: "SMALLTALK" }) });
    await h.line.open();
    say(h, "item_1", "Thanks!");
    await settle();
    expect(h.channel().creates().at(-1)).toMatchObject({
      response: { tool_choice: "none" },
    });
    expect(JSON.stringify(h.channel().creates().at(-1))).toContain(
      "No facts, figures, names, advice",
    );
    qSpeaks(h);
    expect(h.outcomes.at(-1)).toMatchObject({ disposition: "ANSWERED" });

    const card = harness({ heard: () => Promise.resolve({ route: "MODEL" }) });
    await card.line.open();
    say(card, "item_1", "send it");
    await settle();
    expect(card.channel().creates().at(-1)).toMatchObject({
      response: { tool_choice: { type: "function", name: "decide_card" } },
    });
  });
});

describe("A5 (C-04): a result after a rejoin is said, not dropped", () => {
  it("delivers a routed answer that arrives after the line rejoined", async () => {
    let answer: (value: QVoiceDuplexHeardResult) => void = () => undefined;
    const h = harness({
      heard: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      rejoin: () => Promise.resolve({ credential: ROUTED }),
    });
    await h.line.open();
    say(h, "item_1", "Who fits?");
    await settle();
    const firstChannel = h.channel();
    h.peer.connectionState = "connected";
    h.peer.fail();
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(h.channel()).not.toBe(firstChannel);
    answer(ANSWER);
    await settle();
    const sent = h.channel().sent;
    expect(JSON.stringify(sent)).toContain("Three investors fit.");
    expect(h.channel().creates().length).toBeGreaterThan(0);
    qSpeaks(h);
    expect(h.outcomes.at(-1)).toMatchObject({ disposition: "ANSWERED" });
  });
});

describe("A6 (C-05): a model-called answer is not said after a newer turn", () => {
  it("is kept on the line but not said, and the turn is SUPERSEDED", async () => {
    let finish: (value: QVoiceDuplexToolResult) => void = () => undefined;
    const h = harness({
      heard: () => Promise.resolve({ route: "SMALLTALK" }),
      tool: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await h.line.open();
    say(h, "item_1", "Thanks!");
    await settle();
    // The voice passed it to Q itself.
    h.channel().emit({
      type: "response.function_call_arguments.done",
      call_id: "call_old",
      name: "ask_q",
      arguments: JSON.stringify({ request: "thanks, and the deck?" }),
    });
    await settle();
    h.relays.heard.mockImplementation(() => new Promise(() => undefined));
    say(h, "item_2", "Open the data room instead.");
    await settle();
    const before = h.channel().creates().length;
    finish({
      output: JSON.stringify({ ok: true, say: "Old answer." }),
      approvalPending: false,
    });
    await settle();
    expect(h.channel().creates().length).toBe(before);
    expect(h.outcomes.some((o) => o.disposition === "SUPERSEDED")).toBe(true);
  });
});

describe("A7 (C-07, C-11): barge-in that keeps answers", () => {
  it("a cough while the answer is being generated does not cancel it", async () => {
    const h = harness();
    await h.line.open();
    say(h, "item_1", "Who fits?");
    await settle();
    h.channel().emit({ type: "response.created", response: { id: "resp_a" } });
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    vi.advanceTimersByTime(150);
    h.channel().emit({ type: "input_audio_buffer.speech_stopped" });
    vi.advanceTimersByTime(BARGE_CONFIRM_MS * 2);
    expect(h.channel().types()).not.toContain("response.cancel");
    expect(h.events.onInterrupted).not.toHaveBeenCalled();
  });

  it("a noise long enough to cut Q, that turns out to have no words, has Q carry on", async () => {
    const h = harness();
    await h.line.open();
    say(h, "item_1", "Who fits?");
    await settle();
    qSpeaks(h);
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    vi.advanceTimersByTime(BARGE_CONFIRM_MS + 1);
    expect(h.channel().types()).toContain("response.cancel");
    h.channel().emit({ type: "input_audio_buffer.speech_stopped" });
    h.channel().emit({
      type: "input_audio_buffer.committed",
      item_id: "noise",
    });
    const before = h.channel().creates().length;
    h.channel().emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "noise",
      transcript: "",
    });
    // The cancel lands after the transcript here: Q carries on once it has.
    expect(h.channel().creates().length).toBe(before);
    h.channel().emit({
      type: "response.done",
      response: { id: "resp_a", status: "cancelled", output: [] },
    });
    expect(h.channel().creates().length).toBe(before + 1);
    expect(JSON.stringify(h.channel().sent)).toContain(
      "A noise interrupted you",
    );
  });

  it("a short real word over Q is their turn, never deleted as a blip", async () => {
    const h = harness();
    await h.line.open();
    qSpeaks(h);
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    vi.advanceTimersByTime(200);
    h.channel().emit({ type: "input_audio_buffer.speech_stopped" });
    h.channel().emit({ type: "input_audio_buffer.committed", item_id: "no_1" });
    h.channel().emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "no_1",
      transcript: "No, stop.",
    });
    await settle();
    expect(h.channel().types()).not.toContain("conversation.item.delete");
    expect(h.channel().types()).toContain("response.cancel");
    expect(h.relays.heard).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "no_1", transcript: "No, stop." }),
    );
  });

  it("a hum over Q is still let go", async () => {
    const h = harness();
    await h.line.open();
    qSpeaks(h);
    h.channel().emit({ type: "input_audio_buffer.speech_started" });
    vi.advanceTimersByTime(200);
    h.channel().emit({ type: "input_audio_buffer.speech_stopped" });
    h.channel().emit({ type: "input_audio_buffer.committed", item_id: "hm_1" });
    vi.advanceTimersByTime(3_000);
    expect(h.channel().types()).toContain("conversation.item.delete");
    expect(h.relays.heard).not.toHaveBeenCalled();
  });
});

describe("A9 (C-09) and the sideband call id", () => {
  it("gives the presence real input and output levels", async () => {
    const h = harness({ level: 0.1 });
    await h.line.open();
    expect(h.line.inputLevel()).toBeGreaterThan(0);
    expect(h.line.outputLevel()).toBe(0);
    h.peer.ontrack?.({
      streams: [{} as MediaStream],
      receiver: {},
    } as unknown as RTCTrackEvent);
    qSpeaks(h);
    expect(h.line.outputLevel()).toBeGreaterThan(0);
    h.line.setMuted(true);
    expect(h.line.inputLevel()).toBe(0);
  });

  it("passes the call id from the SDP answer's Location to the server", async () => {
    const h = harness({ location: "/v1/realtime/calls/rtc_abc123" });
    await h.line.open();
    expect(h.relays.attach).toHaveBeenCalledWith("rtc_abc123");
  });
});

describe("A10 (C-17): natural delivery on the line", () => {
  it("opens in Q's own voice, never word for word", async () => {
    const h = harness();
    await h.line.open();
    h.line.speakFirst("Hi Ada. Three investors fit your raise.");
    const opening = JSON.stringify(h.channel().creates().at(-1));
    expect(opening).not.toMatch(/word for word|exactly this/i);
    expect(opening).toContain("Hi Ada. Three investors fit your raise.");
    expect(opening).toContain("Keep every name, fact");
  });
});
