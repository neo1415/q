// @vitest-environment jsdom
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QVoiceDuplexCredential,
  QVoiceDuplexHeardResult,
  QVoiceDuplexRejoinResult,
  QTurnDisposition,
} from "@capital-q/contracts";

import {
  DuplexLine,
  type DuplexEnvironment,
  type DuplexRelays,
  type DuplexTurnOutcome,
} from "../src/features/voice/provider/duplex-line";

/**
 * RECOVERY A8 (C-08): the voice-transport measurement harness, MOCK mode.
 *
 * Founder 2026-10-08: no billable live calls; decide sideband vs relay on
 * mock evidence and say plainly what still needs a live confirmation.
 *
 * The real `DuplexLine` (the browser code that ships) runs against a
 * simulated realtime provider (WebRTC data channel events with
 * configurable, seeded timings) and simulated relays, in fake time. Three
 * transports are compared:
 *
 * - ACTION_QUEUE: the baseline at fe5579c3. Relays were Next.js server
 *   actions, which run one at a time per tab: `heard` (held for the whole
 *   ask_q) queued behind and in front of the 1.5 s turn poll, usage
 *   reports and `said`.
 * - ROUTE: relays are fetches through one route handler, side by side,
 *   each with a deadline (what ships by default now).
 * - SIDEBAND: the server is attached to the call and puts Q's answer on
 *   it the moment ask_q finishes; the browser is only told.
 *
 * What it measures is our own code's overhead and failure handling, per
 * turn: turn end -> first audio; turn end -> answer delivered to the
 * provider; turns reaching a terminal disposition (and drops); recovery
 * from a forced reconnect and turns lost across it; and cost per turn
 * from the gateway's price tables. The provider's own latencies are
 * inputs here, not results: they need a live run to confirm.
 *
 * `VOICE_HARNESS_WRITE=1` writes docs/recovery/evidence/voice-transport.md.
 */

type Mode = "ACTION_QUEUE" | "ROUTE" | "SIDEBAND";

/**
 * USD per million tokens: the gateway's own tables
 * (`OPENAI_REALTIME_MINI_PRICES`, `OPENAI_TRANSCRIBE_PRICES` in
 * packages/model-gateway/src/realtime/openai.ts, 2026-10-04/08). Copied:
 * the web app does not depend on the gateway. The q-api test
 * `duplex-voice-recovery.test.ts` fails if these drift from the gateway.
 */
const HARNESS_REALTIME_PRICES = {
  textInput: 0.6,
  cachedTextInput: 0.06,
  textOutput: 2.4,
  audioInput: 10,
  cachedAudioInput: 0.3,
  audioOutput: 20,
} as const;
const HARNESS_TRANSCRIBE_PRICES = {
  textInput: 2.5,
  cachedTextInput: 2.5,
  textOutput: 10,
  audioInput: 6,
  cachedAudioInput: 6,
  audioOutput: 0,
} as const;
const OPENAI_REALTIME_MINI_PRICES = HARNESS_REALTIME_PRICES;
const OPENAI_TRANSCRIBE_PRICES = HARNESS_TRANSCRIBE_PRICES;

type Timings = {
  /** Browser <-> web <-> Q API round trip for a relay, ms. */
  readonly relayRttMs: number;
  /** Q API <-> provider one way (sideband), ms. */
  readonly serverToProviderMs: number;
  /** Browser <-> provider one way over the data channel, ms. */
  readonly browserToProviderMs: number;
  /** Turn end to transcript, ms (gpt-4o-transcribe). */
  readonly transcriptionMs: readonly [number, number];
  /** ask_q (Q's run) duration, ms, and a slow tail. */
  readonly askQMs: readonly [number, number];
  readonly slowAskQRate: number;
  readonly slowAskQMs: number;
  /** response.create to first audio, ms. */
  readonly modelFirstAudioMs: readonly [number, number];
  /** Length of a spoken answer, s. */
  readonly answerSeconds: readonly [number, number];
  /** Length of the person's turn, s. */
  readonly speechSeconds: readonly [number, number];
  /** The turn poll (a server action at baseline). */
  readonly pollEveryMs: number;
  readonly pollWorkMs: number;
  /** Failure injection. */
  readonly providerErrorRate: number;
  readonly responseFailRate: number;
  readonly relayLossRate: number;
  readonly gapBetweenTurnsMs: number;
};

/** Defaults: plausible values, to be replaced by live measurements. */
export const DEFAULT_TIMINGS: Timings = {
  relayRttMs: 120,
  serverToProviderMs: 40,
  browserToProviderMs: 40,
  transcriptionMs: [250, 700],
  askQMs: [1_500, 6_000],
  slowAskQRate: 0.05,
  slowAskQMs: 24_000,
  modelFirstAudioMs: [450, 900],
  answerSeconds: [4, 12],
  speechSeconds: [1.5, 5],
  pollEveryMs: 1_500,
  pollWorkMs: 150,
  providerErrorRate: 0.02,
  responseFailRate: 0.01,
  relayLossRate: 0.01,
  gapBetweenTurnsMs: 1_500,
};

/** Seeded, so a run is reproducible. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Tokens per second of audio, from OpenAI's realtime pricing notes
 * (approximate: input ~10/s, output ~20/s). An assumption, flagged in the
 * report; usage events on a live call replace it.
 */
const AUDIO_IN_TOKENS_PER_S = 10;
const AUDIO_OUT_TOKENS_PER_S = 20;
/** The minted instructions (charter + conduct), cached after the first. */
const INSTRUCTION_TOKENS = 3_200;
const HISTORY_TOKENS_PER_TURN = 220;

function costPerTurnUsd(
  turnIndex: number,
  speechSeconds: number,
  answerSeconds: number,
  answerChars: number,
): number {
  const p = OPENAI_REALTIME_MINI_PRICES;
  const t = OPENAI_TRANSCRIBE_PRICES;
  const million = 1_000_000;
  const audioIn = speechSeconds * AUDIO_IN_TOKENS_PER_S;
  // The conversation's audio so far is re-read on each response.
  const historyAudio = turnIndex * 6 * AUDIO_IN_TOKENS_PER_S;
  const text =
    INSTRUCTION_TOKENS +
    turnIndex * HISTORY_TOKENS_PER_TURN +
    Math.ceil(answerChars / 4);
  const cachedText = turnIndex === 0 ? 0 : INSTRUCTION_TOKENS;
  const response =
    ((text - cachedText) * p.textInput +
      cachedText * p.cachedTextInput +
      (audioIn + historyAudio) * p.audioInput +
      answerSeconds * AUDIO_OUT_TOKENS_PER_S * p.audioOutput +
      Math.ceil(answerChars / 4) * p.textOutput) /
    million;
  const transcription = (audioIn * t.audioInput + 20 * t.textOutput) / million;
  return response + transcription;
}

type TurnRecord = {
  readonly index: number;
  readonly endedAt: number;
  deliveredAt: number | null;
  outcome: DuplexTurnOutcome | null;
  readonly speechSeconds: number;
  readonly answerSeconds: number;
};

type RunResult = {
  readonly mode: Mode;
  readonly turns: readonly TurnRecord[];
  readonly reconnect: {
    readonly recoveredMs: number | null;
    readonly lostTurns: number;
  } | null;
};

class SimChannel {
  readyState: RTCDataChannelState = "connecting";
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly #onSend: (event: Record<string, unknown>) => void;
  constructor(onSend: (event: Record<string, unknown>) => void) {
    this.#onSend = onSend;
  }
  send(data: string) {
    this.#onSend(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  emit(event: Record<string, unknown>) {
    if (this.readyState !== "open") return;
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(event) }),
    );
  }
}

class SimPeer {
  channel: SimChannel | null = null;
  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly #onSend: (event: Record<string, unknown>) => void;
  constructor(onSend: (event: Record<string, unknown>) => void) {
    this.#onSend = onSend;
  }
  addTrack() {
    return undefined;
  }
  createDataChannel() {
    this.channel = new SimChannel(this.#onSend);
    return this.channel;
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "v=0" });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription() {
    this.connectionState = "connected";
    setTimeout(() => this.channel?.open(), 30);
    return Promise.resolve();
  }
  close() {
    this.connectionState = "closed";
  }
  fail() {
    this.connectionState = "failed";
    this.onconnectionstatechange?.();
  }
}

async function run(
  mode: Mode,
  options: {
    readonly turns: number;
    readonly seed: number;
    readonly timings?: Partial<Timings>;
    /** Drop the call while this turn's ask_q runs. */
    readonly dropDuringTurn?: number;
  },
): Promise<RunResult> {
  const timings = { ...DEFAULT_TIMINGS, ...options.timings };
  const rand = random(options.seed);
  const between = ([min, max]: readonly [number, number]) =>
    min + (max - min) * rand();
  const records: TurnRecord[] = [];
  let current: TurnRecord | null = null;
  let responses = 0;
  let calls = 0;
  let peer: SimPeer | null = null;
  const currentPeer = (): SimPeer | null => peer;
  /** SIDEBAND: the call the server is attached to. */
  let attachedCall: number | null = null;
  let call = 0;
  let speakingUntil = 0;

  const channel = () => peer?.channel ?? null;
  const toBrowser = (event: Record<string, unknown>, delay: number) => {
    const target = channel();
    setTimeout(() => target?.emit(event), delay);
  };

  /** The simulated provider: answers response.create like the real one. */
  const provider = (event: Record<string, unknown>, delay: number) => {
    if (event.type !== "response.create") return;
    const response = (event.response ?? {}) as Record<string, unknown>;
    const outOfBand = response.conversation === "none";
    responses += 1;
    const id = `resp_${String(responses)}`;
    if (!outOfBand && current !== null && current.deliveredAt === null) {
      current.deliveredAt = Date.now() + delay;
    }
    if (outOfBand) {
      const metadata = response.metadata;
      toBrowser(
        { type: "response.created", response: { id, metadata } },
        delay + 50,
      );
      toBrowser(
        {
          type: "response.done",
          response: { id, status: "completed", metadata, output: [] },
        },
        delay + 300,
      );
      return;
    }
    if (rand() < timings.providerErrorRate) {
      toBrowser(
        {
          type: "error",
          error: {
            type: "server_error",
            code: "server_error",
            event_id: event.event_id,
          },
        },
        delay + 80,
      );
      return;
    }
    const firstAudio = delay + between(timings.modelFirstAudioMs);
    toBrowser({ type: "response.created", response: { id } }, delay + 60);
    if (rand() < timings.responseFailRate) {
      toBrowser(
        {
          type: "response.done",
          response: {
            id,
            status: "failed",
            status_details: { reason: "server_error" },
            output: [],
          },
        },
        firstAudio,
      );
      return;
    }
    const seconds = current?.answerSeconds ?? 2;
    toBrowser(
      {
        type: "response.output_item.added",
        item: { id: `item_${id}`, type: "message" },
      },
      firstAudio - 20,
    );
    toBrowser({ type: "output_audio_buffer.started" }, firstAudio);
    speakingUntil = Date.now() + firstAudio + seconds * 1_000;
    toBrowser(
      {
        type: "response.done",
        response: { id, status: "completed", output: [{ type: "message" }] },
      },
      firstAudio + 400,
    );
    toBrowser(
      { type: "output_audio_buffer.stopped" },
      firstAudio + seconds * 1_000,
    );
  };

  // Next.js server actions: one at a time per tab (ACTION_QUEUE only).
  let queue: Promise<unknown> = Promise.resolve();
  const viaQueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  const wait = (ms: number) =>
    new Promise<void>((done) => {
      setTimeout(done, ms);
    });
  const relayed = <T>(work: () => Promise<T>): Promise<T> =>
    mode === "ACTION_QUEUE" ? viaQueue(work) : work();

  // The 1.5 s turn poll (cards, navigation) that shared the queue.
  let polling = true;
  const poll = async () => {
    while (polling) {
      await wait(timings.pollEveryMs);
      if (!polling) break;
      await relayed(() => wait(timings.relayRttMs + timings.pollWorkMs));
    }
  };

  const heard: NonNullable<DuplexRelays["heard"]> = (input) =>
    relayed(async () => {
      calls += 1;
      const askMs =
        rand() < timings.slowAskQRate
          ? timings.slowAskQMs
          : between(timings.askQMs);
      await wait(timings.relayRttMs / 2 + askMs);
      if (rand() < timings.relayLossRate) {
        await wait(timings.relayRttMs / 2);
        return null;
      }
      const result: QVoiceDuplexHeardResult = {
        route: "ASK_Q",
        callId: `cq_${String(calls)}`,
        arguments: JSON.stringify({ request: input.transcript }),
        output: JSON.stringify({ ok: true, say: "An answer." }),
        approvalPending: false,
        disposition: "ANSWERED",
      };
      if (mode === "SIDEBAND" && attachedCall === call) {
        // The server puts it on the call itself.
        provider(
          { type: "response.create", response: { tool_choice: "none" } },
          timings.serverToProviderMs,
        );
        await wait(timings.relayRttMs / 2);
        return { ...result, delivered: "SERVER" as const };
      }
      await wait(timings.relayRttMs / 2);
      return result;
    });

  const relays: DuplexRelays = {
    heard,
    tool: () =>
      relayed(async () => {
        await wait(timings.relayRttMs + between(timings.askQMs));
        return {
          output: JSON.stringify({ ok: true, say: "An answer." }),
          approvalPending: false,
          disposition: "ANSWERED" as const,
        };
      }),
    usage: () =>
      relayed(async () => {
        await wait(timings.relayRttMs);
        return { continue: true };
      }),
    said: () => relayed(() => wait(timings.relayRttMs)),
    end: () => Promise.resolve(),
    outcome: () => Promise.resolve(),
    rejoin: (): Promise<QVoiceDuplexRejoinResult | null> =>
      relayed(async () => {
        await wait(timings.relayRttMs + 300);
        return { credential: CREDENTIAL };
      }),
    attach: () =>
      relayed(async () => {
        const attaching = call;
        await wait(timings.relayRttMs / 2 + timings.serverToProviderMs * 2);
        if (mode === "SIDEBAND") attachedCall = attaching;
      }),
  };

  const environment: DuplexEnvironment = {
    createPeer: () => {
      call += 1;
      peer = new SimPeer((event) => {
        provider(event, timings.browserToProviderMs);
      });
      return peer as unknown as RTCPeerConnection;
    },
    getMicrophone: () =>
      Promise.resolve({
        getTracks: () => [{ enabled: true, stop: () => undefined }],
        getAudioTracks: () => [{ enabled: true, stop: () => undefined }],
      } as unknown as MediaStream),
    // The SDP answer names the call, as OpenAI's does (Location header).
    fetch: () =>
      Promise.resolve(
        new Response("v=0", {
          status: 201,
          headers: { location: `/v1/realtime/calls/rtc_sim${String(call)}` },
        }),
      ),
    createAudio: () =>
      ({
        volume: 1,
        srcObject: null,
        autoplay: true,
      }) as unknown as HTMLAudioElement,
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };

  const recovery: { value: RunResult["reconnect"] } = { value: null };
  let droppedAt: number | null = null;
  const line = new DuplexLine({
    credential: CREDENTIAL,
    relays,
    environment,
    events: {
      onState: (state) => {
        if (
          state === "LISTENING" &&
          droppedAt !== null &&
          recovery.value === null
        ) {
          recovery.value = {
            recoveredMs: Date.now() - droppedAt,
            lostTurns: 0,
          };
        }
      },
      onLine: () => undefined,
      onInterrupted: () => undefined,
      onFallback: () => undefined,
      onEnded: () => undefined,
      onTurnOutcome: (outcome) => {
        if (current !== null && current.outcome === null) {
          current.outcome = outcome;
        }
      },
    },
  });
  const opening = line.open();
  await vi.advanceTimersByTimeAsync(500);
  expect(await opening).toBe(true);
  void poll();

  for (let index = 0; index < options.turns; index += 1) {
    const speechSeconds = between(timings.speechSeconds);
    const answerSeconds = between(timings.answerSeconds);
    const ch = channel();
    if (ch === null) throw new Error("no channel");
    ch.emit({ type: "input_audio_buffer.speech_started" });
    await vi.advanceTimersByTimeAsync(speechSeconds * 1_000);
    const record: TurnRecord = {
      index,
      endedAt: Date.now(),
      deliveredAt: null,
      outcome: null,
      speechSeconds,
      answerSeconds,
    };
    records.push(record);
    current = record;
    const item = `item_${String(index)}`;
    channel()?.emit({ type: "input_audio_buffer.speech_stopped" });
    channel()?.emit({ type: "input_audio_buffer.committed", item_id: item });
    toBrowser(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: item,
        transcript: `Question number ${String(index)} about my raise?`,
      },
      between(timings.transcriptionMs),
    );
    if (options.dropDuringTurn === index) {
      await vi.advanceTimersByTimeAsync(1_000);
      droppedAt = Date.now();
      // Assigned in createPeer (a closure), so read through a function.
      currentPeer()?.fail();
    }
    // Until the turn ends, at most a minute of simulated time.
    for (
      let waited = 0;
      waited < 60_000 && record.outcome === null;
      waited += 250
    ) {
      await vi.advanceTimersByTimeAsync(250);
    }
    // Let Q finish speaking, then a pause before the next turn.
    const rest = Math.max(0, speakingUntil - Date.now());
    await vi.advanceTimersByTimeAsync(rest + timings.gapBetweenTurnsMs);
  }
  polling = false;
  line.close();
  await vi.advanceTimersByTimeAsync(5_000);
  const reconnect = recovery.value;
  if (reconnect !== null && options.dropDuringTurn !== undefined) {
    const lost = records.filter(
      (r) =>
        r.index === options.dropDuringTurn &&
        r.outcome?.disposition !== "ANSWERED",
    ).length;
    recovery.value = { ...reconnect, lostTurns: lost };
  }
  return { mode, turns: records, reconnect: recovery.value };
}

const CREDENTIAL: QVoiceDuplexCredential = {
  clientSecret: "ek_simulated",
  callsUrl: "https://realtime.invalid/v1/realtime/calls",
  expiresAt: "2099-01-01T00:00:00.000Z",
  maxSessionMs: 3_600_000,
  idleMs: 3_600_000,
  routeTurns: true,
};

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null
  );
}

type Summary = {
  readonly mode: Mode;
  readonly turns: number;
  readonly terminal: number;
  readonly byDisposition: Readonly<Partial<Record<QTurnDisposition, number>>>;
  readonly firstAudioP50: number | null;
  readonly firstAudioP95: number | null;
  readonly deliveredP50: number | null;
  readonly deliveredP95: number | null;
  readonly costPerTurnUsd: number;
};

function summarise(result: RunResult): Summary {
  const by: Partial<Record<QTurnDisposition, number>> = {};
  for (const turn of result.turns) {
    const d = turn.outcome?.disposition;
    if (d !== undefined) by[d] = (by[d] ?? 0) + 1;
  }
  const firstAudio = result.turns.flatMap((t) =>
    t.outcome?.firstAudioMs === undefined ? [] : [t.outcome.firstAudioMs],
  );
  const delivered = result.turns.flatMap((t) =>
    t.deliveredAt === null ? [] : [t.deliveredAt - t.endedAt],
  );
  const cost =
    result.turns.reduce(
      (sum, t) =>
        sum +
        costPerTurnUsd(
          t.index,
          t.speechSeconds,
          t.answerSeconds,
          t.answerSeconds * 15,
        ),
      0,
    ) / Math.max(1, result.turns.length);
  return {
    mode: result.mode,
    turns: result.turns.length,
    terminal: result.turns.filter((t) => t.outcome !== null).length,
    byDisposition: by,
    firstAudioP50: percentile(firstAudio, 0.5),
    firstAudioP95: percentile(firstAudio, 0.95),
    deliveredP50: percentile(delivered, 0.5),
    deliveredP95: percentile(delivered, 0.95),
    costPerTurnUsd: cost,
  };
}

const MODES: readonly Mode[] = ["ACTION_QUEUE", "ROUTE", "SIDEBAND"];
const TURNS = 60;
const SEED = 20261008;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("voice transport harness (mock mode)", () => {
  const summaries = new Map<Mode, Summary>();
  const reconnects = new Map<Mode, RunResult["reconnect"]>();
  const queueContention = new Map<Mode, Summary>();

  it.each(MODES)(
    "%s: every accepted turn reaches a terminal disposition, with failures injected",
    async (mode) => {
      const result = await run(mode, { turns: TURNS, seed: SEED });
      const summary = summarise(result);
      summaries.set(mode, summary);
      expect(summary.terminal).toBe(summary.turns);
    },
    120_000,
  );

  it.each(MODES)(
    "%s: a call dropped mid-answer recovers, and the turn is not lost silently",
    async (mode) => {
      const result = await run(mode, {
        turns: 4,
        seed: SEED + 1,
        dropDuringTurn: 1,
        timings: {
          providerErrorRate: 0,
          responseFailRate: 0,
          relayLossRate: 0,
          askQMs: [4_000, 4_000],
          slowAskQRate: 0,
        },
      });
      reconnects.set(mode, result.reconnect);
      expect(result.turns.every((t) => t.outcome !== null)).toBe(true);
      expect(result.reconnect?.recoveredMs ?? null).not.toBeNull();
    },
    120_000,
  );

  it.each(MODES)(
    "%s: with a busy page (poll every 500 ms, slow relay)",
    async (mode) => {
      const result = await run(mode, {
        turns: 20,
        seed: SEED + 2,
        timings: {
          pollEveryMs: 500,
          pollWorkMs: 400,
          relayRttMs: 250,
          providerErrorRate: 0,
          responseFailRate: 0,
          relayLossRate: 0,
        },
      });
      const summary = summarise(result);
      queueContention.set(mode, summary);
      expect(summary.terminal).toBe(summary.turns);
    },
    120_000,
  );

  it("the server delivering the answer is never slower than the browser relaying it", () => {
    const route = summaries.get("ROUTE");
    const sideband = summaries.get("SIDEBAND");
    const baseline = summaries.get("ACTION_QUEUE");
    expect(route?.deliveredP50).not.toBeNull();
    expect(sideband?.deliveredP50 ?? 0).toBeLessThanOrEqual(
      route?.deliveredP50 ?? 0,
    );
    expect(route?.deliveredP50 ?? 0).toBeLessThanOrEqual(
      baseline?.deliveredP50 ?? 0,
    );
    if (process.env.VOICE_HARNESS_WRITE === "1") {
      writeReport(summaries, reconnects, queueContention);
    }
  });
});

function ms(value: number | null): string {
  return value === null ? "n/a" : `${String(Math.round(value))}`;
}

function writeReport(
  summaries: ReadonlyMap<Mode, Summary>,
  reconnects: ReadonlyMap<Mode, RunResult["reconnect"]>,
  contention: ReadonlyMap<Mode, Summary>,
): void {
  const row = (s: Summary | undefined) =>
    s === undefined
      ? "| n/a |"
      : `| ${s.mode} | ${String(s.terminal)}/${String(s.turns)} | ${Object.entries(
          s.byDisposition,
        )
          .map(([k, v]) => `${k} ${String(v)}`)
          .join(
            ", ",
          )} | ${ms(s.deliveredP50)} / ${ms(s.deliveredP95)} | ${ms(s.firstAudioP50)} / ${ms(s.firstAudioP95)} | ${s.costPerTurnUsd.toFixed(4)} |`;
  const lines = [
    "# Voice transport: sideband vs relay (MOCK measurements)",
    "",
    `Generated by \`apps/web/test/voice-transport-harness.test.ts\` (seed ${String(SEED)}, ${String(TURNS)} turns per mode) with \`VOICE_HARNESS_WRITE=1\`. The shipped browser line (\`DuplexLine\`) runs against a simulated provider and simulated relays in fake time. **No live provider call was made.** Provider latencies are inputs (defaults in the harness's \`DEFAULT_TIMINGS\`), so these numbers measure Capital Q's own overhead and failure handling, not OpenAI's.`,
    "",
    "## Injected: 2% realtime errors on the answer, 1% failed responses, 1% lost relays, 5% slow ask_q (24 s)",
    "",
    "| Transport | Terminal turns | Dispositions | Turn end -> answer delivered p50 / p95 (ms) | Turn end -> first audio p50 / p95 (ms) | Cost per turn (USD, price tables) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...MODES.map((m) => row(summaries.get(m))),
    "",
    "## Busy page: poll every 500 ms taking 400 ms, relay RTT 250 ms, no failures",
    "",
    "| Transport | Terminal turns | Dispositions | Delivered p50 / p95 (ms) | First audio p50 / p95 (ms) | Cost per turn (USD) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...MODES.map((m) => row(contention.get(m))),
    "",
    "## Forced reconnect (the call fails 1 s into a 4 s ask_q)",
    "",
    "| Transport | Recovered (drop -> listening, ms) | Turns lost across it |",
    "| --- | --- | --- |",
    ...MODES.map((m) => {
      const r = reconnects.get(m);
      return `| ${m} | ${ms(r?.recoveredMs ?? null)} | ${String(r?.lostTurns ?? "n/a")} |`;
    }),
    "",
  ];
  writeFileSync(
    resolve(
      __dirname,
      "../../../docs/recovery/evidence/voice-transport.generated.md",
    ),
    `${lines.join("\n")}\n`,
  );
}
