import { Q_VOICE_LIVE_TRIAL_MAX_SECONDS } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * The GPT-Live trial (owner directive 2026-10-12).
 *
 * A named person may use the live voice for a cumulative allowance of
 * ACTIVE SPEECH: their words plus Q's, with idle silence excluded. The
 * grant is server configuration (CQ_VOICE_LIVE_TRIAL, a JSON object of
 * user id -> seconds); what has been used is in Postgres
 * (q_runtime.voice_live_trial_usage, 20261222160000), so it survives
 * reconnects, refreshes, other devices and restarts.
 *
 * Speech is measured here, from the provider's own events on the server's
 * sideband (input speech started/stopped, output audio started/stopped,
 * and the transcript deltas of both sides), never from a number the
 * browser asserts. The browser may report a bounded hint, which can only
 * consume allowance (never add any): see `withHint`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Who has a trial and how many seconds, from CQ_VOICE_LIVE_TRIAL
 * (`{"<user id>": 300}`). Anything malformed grants nothing: a typo never
 * opens a paid line to anyone, and never lifts an allowance past the hard
 * bound.
 */
export function liveTrialGrantsFrom(
  raw: string | undefined,
): ReadonlyMap<string, number> {
  const grants = new Map<string, number>();
  if (raw === undefined || raw.trim().length === 0) return grants;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return grants;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return grants;
  for (const [key, value] of Object.entries(parsed)) {
    const id = key.trim().toLowerCase();
    if (!UUID.test(id)) continue;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > Q_VOICE_LIVE_TRIAL_MAX_SECONDS
    )
      continue;
    grants.set(id, value);
  }
  return grants;
}

// --- Measuring speech -----------------------------------------------------

export type SpeechSide = "user" | "q";

export type SpeechSignal =
  | { readonly kind: "start"; readonly side: SpeechSide }
  | { readonly kind: "stop"; readonly side: SpeechSide }
  /** Words or audio arriving: someone is speaking at this moment. */
  | { readonly kind: "pulse"; readonly side: SpeechSide }
  /** The session closed: nobody speaks any more. */
  | { readonly kind: "closed" };

const SIGNALS: Readonly<Record<string, SpeechSignal>> = {
  "input_audio_buffer.speech_started": { kind: "start", side: "user" },
  "input_audio_buffer.speech_stopped": { kind: "stop", side: "user" },
  "session.input_transcript.delta": { kind: "pulse", side: "user" },
  "conversation.item.input_audio_transcription.delta": {
    kind: "pulse",
    side: "user",
  },
  "output_audio_buffer.started": { kind: "start", side: "q" },
  "output_audio_buffer.stopped": { kind: "stop", side: "q" },
  "output_audio_buffer.cleared": { kind: "stop", side: "q" },
  "session.output_transcript.delta": { kind: "pulse", side: "q" },
  "response.output_audio.delta": { kind: "pulse", side: "q" },
  "response.output_audio_transcript.delta": { kind: "pulse", side: "q" },
  "response.audio.delta": { kind: "pulse", side: "q" },
  "session.closed": { kind: "closed" },
};

/** The speech signal a provider event carries, or null (most carry none). */
export function speechSignalOf(event: unknown): SpeechSignal | null {
  if (typeof event !== "object" || event === null) return null;
  const type: unknown = Reflect.get(event, "type");
  if (typeof type !== "string") return null;
  return Object.hasOwn(SIGNALS, type) ? (SIGNALS[type] ?? null) : null;
}

/** Consecutive pulses closer than this are one stretch of speech. */
export const SPEECH_GAP_MS = 1_500;
/** A lone pulse (one word) counts this much. */
export const SPEECH_PULSE_MS = 400;
/**
 * An open stretch (started, no stop) with no further signal from that
 * side counts at most this long: a lost `stopped` event never turns
 * silence into speech for longer than this.
 */
export const SPEECH_OPEN_STALE_MS = 15_000;

export type SpeechMeter = {
  readonly signal: (signal: SpeechSignal, at: number) => void;
  /** Active speech so far, ms: the union of both sides (overlap once). */
  readonly measuredMs: (at: number) => number;
};

/**
 * Active speech from a stream of signals, as the union of the time either
 * side was speaking. Gaps longer than SPEECH_GAP_MS between pulses, and
 * any time between a stop and the next start, are silence and never count.
 * Signals arrive in time order (server receive time).
 */
export function createSpeechMeter(): SpeechMeter {
  /** Closed stretches, merged and sorted; folded into `folded` when old. */
  let stretches: [number, number][] = [];
  let folded = 0;
  let foldedUntil = Number.NEGATIVE_INFINITY;
  const open: Record<SpeechSide, number | null> = { user: null, q: null };
  const lastSignal: Record<SpeechSide, number | null> = {
    user: null,
    q: null,
  };
  const lastPulse: Record<SpeechSide, number | null> = { user: null, q: null };

  const add = (from: number, to: number) => {
    const a = Math.max(from, foldedUntil);
    if (!(to > a)) return;
    const merged: [number, number][] = [];
    let next: [number, number] = [a, to];
    for (const stretch of stretches) {
      if (stretch[1] < next[0] || stretch[0] > next[1]) merged.push(stretch);
      else
        next = [Math.min(stretch[0], next[0]), Math.max(stretch[1], next[1])];
    }
    merged.push(next);
    merged.sort((x, y) => x[0] - y[0]);
    stretches = merged;
    // Stretches that ended long ago can no longer merge with anything new.
    const horizon = to - 60_000;
    while (stretches.length > 1) {
      const first = stretches[0];
      if (first === undefined || first[1] >= horizon) break;
      folded += first[1] - first[0];
      foldedUntil = first[1];
      stretches.shift();
    }
  };

  /** Where an open stretch on this side ends if nothing more arrives. */
  const openEnd = (side: SpeechSide, at: number): number => {
    const last = lastSignal[side] ?? at;
    return Math.min(at, last + SPEECH_OPEN_STALE_MS);
  };

  const close = (side: SpeechSide, at: number) => {
    const started = open[side];
    if (started === null) return;
    add(started, openEnd(side, at));
    open[side] = null;
  };

  return {
    signal: (signal, at) => {
      if (signal.kind === "closed") {
        close("user", at);
        close("q", at);
        return;
      }
      const { side } = signal;
      if (signal.kind === "start") {
        // A start while already open (a missed stop) closes the old one
        // where its last signal left it.
        if (open[side] !== null) close(side, at);
        open[side] = at;
      } else if (signal.kind === "stop") {
        close(side, at);
      } else {
        const previous = lastPulse[side];
        const from =
          previous !== null && at - previous <= SPEECH_GAP_MS
            ? previous
            : at - SPEECH_PULSE_MS;
        add(from, at);
        lastPulse[side] = at;
      }
      lastSignal[side] = at;
    },
    measuredMs: (at) => {
      let total = folded;
      for (const stretch of stretches) total += stretch[1] - stretch[0];
      // Open stretches count to now, minus what is already counted.
      let extra: [number, number][] = [];
      for (const side of ["user", "q"] as const) {
        const started = open[side];
        if (started === null) continue;
        const end = openEnd(side, at);
        if (end > started) extra.push([Math.max(started, foldedUntil), end]);
      }
      if (extra.length === 0) return total;
      // Union of the open stretches with each other and the closed ones.
      extra = extra.sort((x, y) => x[0] - y[0]);
      const merged: [number, number][] = [];
      for (const piece of extra) {
        const last = merged[merged.length - 1];
        if (last !== undefined && piece[0] <= last[1])
          last[1] = Math.max(last[1], piece[1]);
        else merged.push([piece[0], piece[1]]);
      }
      for (const [from, to] of merged) {
        let uncovered = to - from;
        for (const stretch of stretches) {
          const overlap = Math.min(to, stretch[1]) - Math.max(from, stretch[0]);
          if (overlap > 0) uncovered -= overlap;
        }
        total += Math.max(0, uncovered);
      }
      return total;
    },
  };
}

/**
 * The seconds to charge for a session: the server's measure, raised (never
 * lowered) by the browser's hint, and the hint itself never past the
 * session's wall-clock length. A hint can only consume allowance.
 */
export function withHint(
  measuredSeconds: number,
  hintSeconds: number | undefined,
  wallClockSeconds: number,
): number {
  if (hintSeconds === undefined || !Number.isFinite(hintSeconds))
    return measuredSeconds;
  const bounded = Math.min(
    Math.max(0, hintSeconds),
    Math.max(0, wallClockSeconds),
  );
  return Math.max(measuredSeconds, bounded);
}

// --- Persisted use --------------------------------------------------------

export type LiveTrialUsageStore = {
  /** Seconds this person has used, every session summed. */
  readonly usedSeconds: (actor: ActorContext) => Promise<number>;
  /**
   * Raise one provider session's count to `seconds` (never lowers it).
   * Returns the person's new total.
   */
  readonly record: (input: {
    readonly actor: ActorContext;
    readonly providerSessionId: string;
    readonly voiceSessionId: string;
    readonly seconds: number;
  }) => Promise<number>;
};

const SESSION_ID = /^[A-Za-z0-9_-]{1,200}$/u;
const VOICE_SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_SESSION_SECONDS = 86_400;

/** Two decimals, bounded: what the numeric(9,2) column holds. */
const asStored = (seconds: number) =>
  Math.round(Math.min(MAX_SESSION_SECONDS, Math.max(0, seconds)) * 100) / 100;

/**
 * q_runtime.voice_live_trial_usage, read and written only as the person on
 * the line: every statement names their tenant and user.
 */
export function createPostgresLiveTrialUsage(
  sql: DatabaseExecutor,
): LiveTrialUsageStore {
  const usedSeconds = async (actor: ActorContext) => {
    const rows = await sql<{ seconds: string }[]>`
      select coalesce(sum(speech_seconds), 0)::text as seconds
        from q_runtime.voice_live_trial_usage
       where tenant_id = ${actor.tenantId}
         and user_id = ${actor.userId}`;
    const seconds = Number(rows[0]?.seconds ?? "0");
    if (!Number.isFinite(seconds)) throw new Error("unreadable trial usage");
    return seconds;
  };
  return {
    usedSeconds,
    record: async ({ actor, providerSessionId, voiceSessionId, seconds }) => {
      if (
        !SESSION_ID.test(providerSessionId) ||
        !VOICE_SESSION_ID.test(voiceSessionId)
      ) {
        throw new Error("trial usage for an unrecognisable session");
      }
      const value = asStored(seconds);
      await sql`
        insert into q_runtime.voice_live_trial_usage
          (tenant_id, user_id, provider_session_id, voice_session_id, speech_seconds)
        values (${actor.tenantId}, ${actor.userId}, ${providerSessionId},
                ${voiceSessionId}, ${value})
        on conflict (tenant_id, user_id, provider_session_id) do update
          set speech_seconds = greatest(
                q_runtime.voice_live_trial_usage.speech_seconds,
                excluded.speech_seconds)`;
      return usedSeconds(actor);
    },
  };
}
