/**
 * Is the voice line healthy enough to talk over? (founder, live: "the
 * voice starts to break and it can't even hear me talk".)
 *
 * Pure policy, no browser APIs, so it is testable against scripted stats.
 * The realtime line samples WebRTC's own statistics; the reading here
 * turns two consecutive samples into packet loss, jitter and round-trip
 * time, and a line is WEAK only after WEAK_AFTER_SAMPLES bad samples in a
 * row, so one lost burst never tears a working conversation down.
 *
 * The thresholds are where speech stops being followable, not where it
 * first degrades: Opus conceals a few percent of loss and the browser's
 * jitter buffer absorbs a hundred milliseconds or so.
 */

/** How often the realtime line samples its statistics. */
export const HEALTH_SAMPLE_MS = 1_000;
/** Bad samples in a row before the line counts as weak (~2-3 s). */
export const WEAK_AFTER_SAMPLES = 2;
/** A transient `disconnected` gets this long to come back on its own. */
export const DISCONNECTED_GRACE_MS = 2_500;
/** Fraction of packets lost, in either direction, that breaks speech. */
export const MAX_LOSS = 0.12;
/** Jitter that the receive buffer can no longer hide, in ms. */
export const MAX_JITTER_MS = 120;
/** Round trip at which turn-taking falls apart, in ms. */
export const MAX_RTT_MS = 900;
/** Fewer packets than this in a sample says nothing about loss. */
const MIN_PACKETS = 10;

/** What the person is told while the line is being repaired. */
export const RECONNECTING_NOTICE = "Reconnecting…";
export const WEAK_LINE_NOTICE = "Weak connection: switching to standard voice.";

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

/** Consecutive bad samples, and the verdict. */
export class LineHealth {
  #previous: RtcCounters | null = null;
  #badRun = 0;

  /** Feed one reading; true once the line has been weak long enough. */
  observe(counters: RtcCounters): boolean {
    const sample = sampleOf(this.#previous, counters);
    this.#previous = counters;
    this.#badRun = sample.bad ? this.#badRun + 1 : 0;
    return this.#badRun >= WEAK_AFTER_SAMPLES;
  }
}
