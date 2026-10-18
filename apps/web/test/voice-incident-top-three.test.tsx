// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QVoiceDuplexCredential,
  QVoiceDuplexHeardResult,
  QVoiceDuplexNarrationResult,
} from "@capital-q/contracts";

import {
  DuplexLine,
  type DuplexEnvironment,
  type DuplexLineEvents,
  type DuplexRelays,
  type DuplexTurnOutcome,
} from "../src/features/voice/provider/duplex-line";

/**
 * INC-1 (docs/recovery/evidence/incident-2026-10-08-top-three.md): the
 * "top three companies" turn lost on live duplex, replayed against the
 * browser line that ships now. Production's sequence:
 *
 *   heard (top three) -> narration x3 (two after the answer was ready)
 *   -> answer handed to the voice, never spoken -> heard (rank them)
 *   -> heard (attention) -> a stale "give me a moment" said 40 s late for
 *   the first question -> end, with no answer ever spoken.
 *
 * Asserted: at most one bridge per turn and none after the answer; one
 * terminal disposition per turn; the stale reply is neither heard, shown
 * nor relayed as said; ANSWERED only with the client's confirmation.
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
    return Promise.resolve({ type: "offer", sdp: "v=0" });
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

const CREDENTIAL: QVoiceDuplexCredential = {
  clientSecret: "ek_fake",
  callsUrl: "https://realtime.invalid/v1/realtime/calls",
  expiresAt: "2099-01-01T00:00:00.000Z",
  maxSessionMs: 3_600_000,
  idleMs: 3_600_000,
  routeTurns: true,
};

const TOP_THREE: QVoiceDuplexHeardResult = {
  route: "ASK_Q",
  callId: "cq_top3",
  arguments: JSON.stringify({ request: "top three" }),
  output: JSON.stringify({
    ok: true,
    speakInYourOwnWords: true,
    facts: { askedFor: 3 },
    mustSay: ["Halyard Security", "Clearwater Assurance", "Tensorgate"],
    example:
      "Your top three are Halyard Security, Clearwater Assurance and Tensorgate.",
  }),
  approvalPending: false,
  disposition: "ANSWERED",
};

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
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

describe("INC-1: the lost 'top three' turn, replayed", () => {
  it("no bridge, one disposition per turn, no stale said, nothing ANSWERED without confirmation", async () => {
    const peer = new FakePeer();
    const stream = {
      getTracks: () => [{ enabled: true, stop: () => undefined }],
      getAudioTracks: () => [{ enabled: true, stop: () => undefined }],
    } as unknown as MediaStream;
    const environment: DuplexEnvironment = {
      createPeer: () => peer as unknown as RTCPeerConnection,
      getMicrophone: () => Promise.resolve(stream),
      fetch: () => Promise.resolve(new Response("v=0", { status: 201 })),
      createAudio: () =>
        ({ volume: 1, srcObject: null }) as unknown as HTMLAudioElement,
      now: () => Date.now(),
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    };

    // Q's run for the first question takes 3 s (production: 2.5 s).
    let heardCalls = 0;
    const heard = vi.fn<NonNullable<DuplexRelays["heard"]>>(() => {
      heardCalls += 1;
      if (heardCalls === 1) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(TOP_THREE), 3_000);
        });
      }
      // The follow-ups are still working when the line ends.
      return new Promise(() => undefined);
    });
    // The server's ladder offers three bridge lines, two of them after
    // the answer was ready (production: 51.4 s, 54.2 s, 58.0 s).
    let polls = 0;
    const narration = vi.fn<NonNullable<DuplexRelays["narration"]>>(
      (): Promise<QVoiceDuplexNarrationResult> => {
        polls += 1;
        const beat = (n: number) => ({
          sequence: n,
          beat: { kind: "STAGE_LINE" as const, text: `Bridge ${String(n)}` },
        });
        return new Promise((resolve) => {
          setTimeout(
            () => resolve({ beats: [beat(polls)], idle: false }),
            polls === 1 ? 100 : 1_500,
          );
        });
      },
    );
    const said = vi.fn<NonNullable<DuplexRelays["said"]>>(() =>
      Promise.resolve(),
    );
    const relays: DuplexRelays = {
      heard,
      narration,
      said,
      tool: () => Promise.resolve(null),
      usage: () => Promise.resolve({ continue: true }),
      end: () => Promise.resolve(),
      outcome: () => Promise.resolve(),
    };
    const outcomes: DuplexTurnOutcome[] = [];
    const lines: [string, string][] = [];
    const events: DuplexLineEvents = {
      onState: () => undefined,
      onLine: (role, text) => {
        lines.push([role, text]);
      },
      onInterrupted: () => undefined,
      onFallback: () => undefined,
      onEnded: () => undefined,
      onTurnOutcome: (outcome) => {
        outcomes.push(outcome);
      },
    };
    const line = new DuplexLine({
      credential: CREDENTIAL,
      relays,
      events,
      environment,
    });
    const opening = line.open();
    await vi.advanceTimersByTimeAsync(10);
    expect(await opening).toBe(true);
    const channel = peer.channel;
    if (channel === null) throw new Error("no channel");
    const ask = (item: string, words: string) => {
      channel.emit({ type: "input_audio_buffer.speech_started" });
      channel.emit({ type: "input_audio_buffer.speech_stopped" });
      channel.emit({ type: "input_audio_buffer.committed", item_id: item });
      channel.emit({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: item,
        transcript: words,
      });
    };
    const bridges = () =>
      channel.sent.filter((event) => JSON.stringify(event).includes("Bridge "));

    // 19:14:50 heard: the top three.
    ask("item_1", "Give me the top three companies for my mandate.");
    await settle();
    // Founder 2026-10-09: nothing is said while Q works, though the
    // ladder offers lines; the answer lands at 3 s.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(bridges()).toHaveLength(0);
    expect(narration).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();
    // The answer is handed over once: the call, its output, one response.
    const answerCreates = channel.sent.filter(
      (event) =>
        event.type === "response.create" &&
        JSON.stringify(event).includes('"tool_choice":"none"') &&
        !JSON.stringify(event).includes('"conversation":"none"'),
    );
    expect(answerCreates).toHaveLength(1);
    // The answer is the first response asked for this turn.
    expect(
      channel.sent.filter((event) => event.type === "response.create"),
    ).toHaveLength(1);
    // The voice starts a response for the answer, then says nothing.
    channel.emit({ type: "response.created", response: { id: "resp_1" } });
    // Narration keeps offering lines after the answer (production #2, #3).
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bridges()).toHaveLength(0);
    // Not ANSWERED: nothing was confirmed said.
    expect(outcomes).toEqual([]);

    // 19:15:00 heard: "rank them"; 19:15:13 heard: attention.
    ask("item_2", "Rank them with pros and cons.");
    await settle();
    ask("item_3", "Find anything that needs my attention.");
    await settle();

    // 19:15:30: the stale reply for the first question, 40 s late.
    await vi.advanceTimersByTimeAsync(17_000);
    channel.emit({
      type: "output_audio_buffer.started",
      response_id: "resp_1",
    });
    channel.emit({
      type: "response.output_audio_transcript.done",
      response_id: "resp_1",
      transcript: "Let me find the top three for you, give me a moment.",
    });
    await settle();

    // 19:15:58: the line ends.
    line.close();
    await settle();

    // No bridge line for the whole exchange, and no narration poll.
    expect(bridges()).toHaveLength(0);
    expect(narration).not.toHaveBeenCalled();
    // The stale reply was cut, never shown and never relayed as said.
    expect(channel.sent).toContainEqual(
      expect.objectContaining({
        type: "response.cancel",
        response_id: "resp_1",
      }),
    );
    expect(lines.filter(([role]) => role === "q")).toEqual([]);
    expect(said).not.toHaveBeenCalled();
    // Exactly one terminal disposition per accepted turn.
    expect(outcomes).toHaveLength(3);
    expect(new Set(outcomes.map((o) => o.turnId)).size).toBe(3);
    // Turn 1: they spoke over the response the voice had started for it
    // (CANCELLED); turn 2: replaced by turn 3; turn 3: the line ended.
    expect(outcomes.map((o) => o.disposition)).toEqual([
      "CANCELLED",
      "SUPERSEDED",
      "CANCELLED",
    ]);
    // Nothing was ANSWERED: nothing was confirmed said.
    expect(outcomes.some((o) => o.disposition === "ANSWERED")).toBe(false);
  });

  it("the same answer, said: ANSWERED on the transcript of the turn's own response, with its turn id on `said`", async () => {
    const peer = new FakePeer();
    const stream = {
      getTracks: () => [{ enabled: true, stop: () => undefined }],
      getAudioTracks: () => [{ enabled: true, stop: () => undefined }],
    } as unknown as MediaStream;
    const said = vi.fn<NonNullable<DuplexRelays["said"]>>(() =>
      Promise.resolve(),
    );
    const outcomes: DuplexTurnOutcome[] = [];
    const line = new DuplexLine({
      credential: CREDENTIAL,
      relays: {
        heard: () => Promise.resolve(TOP_THREE),
        said,
        tool: () => Promise.resolve(null),
        usage: () => Promise.resolve({ continue: true }),
        end: () => Promise.resolve(),
      },
      events: {
        onState: () => undefined,
        onLine: () => undefined,
        onInterrupted: () => undefined,
        onFallback: () => undefined,
        onEnded: () => undefined,
        onTurnOutcome: (outcome) => {
          outcomes.push(outcome);
        },
      },
      environment: {
        createPeer: () => peer as unknown as RTCPeerConnection,
        getMicrophone: () => Promise.resolve(stream),
        fetch: () => Promise.resolve(new Response("v=0", { status: 201 })),
        createAudio: () =>
          ({ volume: 1, srcObject: null }) as unknown as HTMLAudioElement,
        now: () => Date.now(),
        setTimeout: (handler, ms) => setTimeout(handler, ms),
        clearTimeout: (handle) => {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        },
      },
    });
    const opening = line.open();
    await vi.advanceTimersByTimeAsync(10);
    await opening;
    const channel = peer.channel;
    if (channel === null) throw new Error("no channel");
    channel.emit({ type: "input_audio_buffer.speech_started" });
    channel.emit({ type: "input_audio_buffer.speech_stopped" });
    channel.emit({ type: "input_audio_buffer.committed", item_id: "i1" });
    channel.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "i1",
      transcript: "Top three companies for my mandate?",
    });
    await settle();
    channel.emit({ type: "response.created", response: { id: "resp_1" } });
    channel.emit({
      type: "output_audio_buffer.started",
      response_id: "resp_1",
    });
    expect(outcomes).toEqual([]);
    channel.emit({
      type: "response.output_audio_transcript.done",
      response_id: "resp_1",
      transcript: "Your top three are Halyard, Clearwater and Tensorgate.",
    });
    await settle();
    expect(outcomes).toEqual([
      expect.objectContaining({ disposition: "ANSWERED" }),
    ]);
    expect(said).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "resp_1",
        turnId: outcomes[0]?.turnId,
      }),
    );
    line.close();
  });

  it("a bridge for turn N that arrives after turns N+1 and N+2 is never said (A6)", async () => {
    const peer = new FakePeer();
    const stream = {
      getTracks: () => [{ enabled: true, stop: () => undefined }],
      getAudioTracks: () => [{ enabled: true, stop: () => undefined }],
    } as unknown as MediaStream;
    // Turn 1's narration poll answers late, after two newer turns.
    let release: (value: QVoiceDuplexNarrationResult) => void = () => undefined;
    let first = true;
    const narration = vi.fn<NonNullable<DuplexRelays["narration"]>>(() => {
      if (!first) return new Promise(() => undefined);
      first = false;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const line = new DuplexLine({
      credential: CREDENTIAL,
      relays: {
        heard: () => new Promise(() => undefined),
        narration,
        tool: () => Promise.resolve(null),
        usage: () => Promise.resolve({ continue: true }),
        end: () => Promise.resolve(),
      },
      events: {
        onState: () => undefined,
        onLine: () => undefined,
        onInterrupted: () => undefined,
        onFallback: () => undefined,
        onEnded: () => undefined,
      },
      environment: {
        createPeer: () => peer as unknown as RTCPeerConnection,
        getMicrophone: () => Promise.resolve(stream),
        fetch: () => Promise.resolve(new Response("v=0", { status: 201 })),
        createAudio: () =>
          ({ volume: 1, srcObject: null }) as unknown as HTMLAudioElement,
        now: () => Date.now(),
        setTimeout: (handler, ms) => setTimeout(handler, ms),
        clearTimeout: (handle) => {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        },
      },
    });
    const opening = line.open();
    await vi.advanceTimersByTimeAsync(10);
    await opening;
    const channel = peer.channel;
    if (channel === null) throw new Error("no channel");
    const ask = (item: string, words: string) => {
      channel.emit({ type: "input_audio_buffer.speech_started" });
      channel.emit({ type: "input_audio_buffer.speech_stopped" });
      channel.emit({ type: "input_audio_buffer.committed", item_id: item });
      channel.emit({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: item,
        transcript: words,
      });
    };
    ask("i1", "Top three companies for my mandate?");
    await vi.advanceTimersByTimeAsync(700);
    ask("i2", "Rank them.");
    await settle();
    ask("i3", "Anything that needs my attention?");
    await settle();
    release({
      beats: [
        {
          sequence: 1,
          beat: { kind: "STAGE_LINE", text: "Finding the top three" },
        },
      ],
      idle: false,
    });
    await settle();
    expect(JSON.stringify(channel.sent)).not.toContain("Finding the top three");
    line.close();
  });
});
