/**
 * Is the voice line healthy enough to talk over? (founder, live: "the
 * voice starts to break and it can't even hear me talk".)
 *
 * Pure policy, no browser APIs, so it is testable against scripted stats.
 * The realtime line samples WebRTC's own statistics; the reading here
 * turns two consecutive samples into packet loss, jitter and round-trip
 * time, and a line is WEAK only after WEAK_AFTER_SAMPLES bad samples in a
 * row, so one lost burst never registers. WEAK is a notice and a deeper
 * playout buffer, never the end of the line.
 */

/** How often the realtime line samples its statistics. */
export const HEALTH_SAMPLE_MS = 1_000;
/** Bad samples in a row before the line counts as weak (~3 s). */
export const WEAK_AFTER_SAMPLES = 3;
/** Good samples in a row before a weak line counts as recovered. */
export const RECOVERED_AFTER_SAMPLES = 2;
/**
 * A `disconnected` line gets this long to come back on its own (ICE
 * consent checks repair most outages of a few seconds) before it rejoins.
 * I1 (Dubai demo 2026-10-05): at 2.5 s, a 2-3 s outage ended the line.
 */
export const DISCONNECTED_GRACE_MS = 5_000;
/*
 * Thresholds for a WEAK line. Weak never ends the line any more (I1: the
 * founder's "even if it has a bad network, it still needs to work"): Opus
 * in-band FEC and the jitter buffer conceal far more than a person
 * notices, and the old 12 % / 120 ms / 900 ms thresholds tore working
 * conversations down to the slower standard voice. Weak deepens the
 * playout buffer and shows a calm notice; only a dead transport rejoins.
 */
/** Fraction of packets lost, in either direction, that breaks speech. */
export const MAX_LOSS = 0.2;
/** Jitter that the receive buffer can no longer hide, in ms. */
export const MAX_JITTER_MS = 250;
/** Round trip at which turn-taking falls apart, in ms. */
export const MAX_RTT_MS = 2_000;
/** Fewer packets than this in a sample says nothing about loss. */
const MIN_PACKETS = 10;

/** What the person is told while the line is being repaired. */
export const RECONNECTING_NOTICE = "Reconnecting…";
export const WEAK_LINE_NOTICE = "Weak connection. Staying on the line.";
/** Said only when the live voice truly cannot continue. */
export const LINE_LOST_NOTICE =
  "The connection keeps dropping, so I'm switching to my standard voice.";

/** The few counters read from an RTCStatsReport. */
export type RtcCounters = {
  /** Q's audio reaching us. */
  readonly received: number;
  readonly lost: number;
  /** Seconds, as WebRTC reports it. */
  readonly jitter: number | null;
  /** Our audio reaching the provider, as the provider reported it. */
  readonly remoteFractionLost: number | null;
  /** Seconds. */
  readonly rtt: number | null;
};

export type HealthSample = {
  readonly loss: number | null;
  readonly jitterMs: number | null;
  readonly rttMs: number | null;
  readonly bad: boolean;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The counters in a stats report: inbound audio, the provider's report
 * of our outbound audio, and the selected candidate pair's round trip.
 * Untrusted shape: anything missing is null, never zero.
 */
export function countersOf(report: {
  readonly forEach: (visit: (value: unknown) => void) => void;
}): RtcCounters {
  let received = 0;
  let lost = 0;
  let jitter: number | null = null;
  let remoteFractionLost: number | null = null;
  let rtt: number | null = null;
  const visit = (raw: unknown) => {
    if (raw === null || typeof raw !== "object") return;
    const stat = raw as Record<string, unknown>;
    const kind = stat.kind ?? stat.mediaType;
    if (stat.type === "inbound-rtp" && kind === "audio") {
      received += num(stat.packetsReceived) ?? 0;
      lost += Math.max(0, num(stat.packetsLost) ?? 0);
      jitter = num(stat.jitter) ?? jitter;
    } else if (stat.type === "remote-inbound-rtp" && kind === "audio") {
      remoteFractionLost = num(stat.fractionLost) ?? remoteFractionLost;
      rtt = num(stat.roundTripTime) ?? rtt;
    } else if (
      stat.type === "candidate-pair" &&
      (stat.nominated === true || stat.selected === true) &&
      stat.state === "succeeded"
    ) {
      rtt = num(stat.currentRoundTripTime) ?? rtt;
    }
  };
  report.forEach(visit);
  return { received, lost, jitter, remoteFractionLost, rtt };
}

/** One sample from two consecutive readings. */
export function sampleOf(
  previous: RtcCounters | null,
  current: RtcCounters,
): HealthSample {
  let loss: number | null = null;
  if (previous !== null) {
    const received = current.received - previous.received;
    const lost = current.lost - previous.lost;
    if (received + lost >= MIN_PACKETS && lost >= 0) {
      loss = lost / (received + lost);
    }
  }
  const outbound = current.remoteFractionLost;
  const worstLoss =
    loss === null
      ? outbound
      : outbound === null
        ? loss
        : Math.max(loss, outbound);
  const jitterMs = current.jitter === null ? null : current.jitter * 1000;
  const rttMs = current.rtt === null ? null : current.rtt * 1000;
  const bad =
    (worstLoss !== null && worstLoss > MAX_LOSS) ||
    (jitterMs !== null && jitterMs > MAX_JITTER_MS) ||
    (rttMs !== null && rttMs > MAX_RTT_MS);
  return { loss: worstLoss, jitterMs, rttMs, bad };
}

export type LineVerdict = "GOOD" | "WEAK";

/** Worst values seen, for the end-of-line report. */
export type LineWorst = {
  readonly lossPct: number | null;
  readonly jitterMs: number | null;
  readonly rttMs: number | null;
  readonly weakSamples: number;
};

const worse = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

/**
 * Consecutive bad samples, and the verdict, with hysteresis: WEAK after
 * WEAK_AFTER_SAMPLES bad samples, GOOD again after RECOVERED_AFTER_SAMPLES
 * good ones, so the notice never flickers.
 */
export class LineHealth {
  #previous: RtcCounters | null = null;
  #badRun = 0;
  #goodRun = 0;
  #verdict: LineVerdict = "GOOD";
  #worst: LineWorst = {
    lossPct: null,
    jitterMs: null,
    rttMs: null,
    weakSamples: 0,
  };

  get verdict(): LineVerdict {
    return this.#verdict;
  }

  get worst(): LineWorst {
    return this.#worst;
  }

  /** Feed one reading; returns the verdict after it. */
  observe(counters: RtcCounters): LineVerdict {
    const sample = sampleOf(this.#previous, counters);
    this.#previous = counters;
    this.#badRun = sample.bad ? this.#badRun + 1 : 0;
    this.#goodRun = sample.bad ? 0 : this.#goodRun + 1;
    if (this.#badRun >= WEAK_AFTER_SAMPLES) this.#verdict = "WEAK";
    else if (this.#goodRun >= RECOVERED_AFTER_SAMPLES) this.#verdict = "GOOD";
    this.#worst = {
      lossPct: worse(
        this.#worst.lossPct,
        sample.loss === null ? null : Math.round(sample.loss * 1000) / 10,
      ),
      jitterMs: worse(
        this.#worst.jitterMs,
        sample.jitterMs === null ? null : Math.round(sample.jitterMs),
      ),
      rttMs: worse(
        this.#worst.rttMs,
        sample.rttMs === null ? null : Math.round(sample.rttMs),
      ),
      weakSamples:
        this.#worst.weakSamples + (this.#verdict === "WEAK" ? 1 : 0),
    };
    return this.#verdict;
  }

  /** A new transport: readings start again; the worst values are kept. */
  restart(): void {
    this.#previous = null;
    this.#badRun = 0;
    this.#goodRun = 0;
    this.#verdict = "GOOD";
  }
}
