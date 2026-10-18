import type { TranscriptSegment } from "./control-channel.js";

/**
 * Short Q-to-Q rehearsal (blueprint §16.1 P8, §16.4). The narrator plays
 * the actor's side with owner-approved lines. The counterpart is the
 * existing rehearsal persona, answering through the existing rehearsal
 * session contracts (start → say → finish → read). There is no second
 * rehearsal engine and no new persona.
 *
 * - Every turn becomes a transcript segment tagged by who OWNS it: the
 *   narrator's side as NARRATOR_Q, the counterpart as REHEARSAL_COUNTERPART.
 *   Segments go to the tour's control gate as transcript only, so nothing
 *   either voice says can steer the tour.
 * - Bounded: about 30 s or the approved lines, whichever comes first. The
 *   session is ALWAYS ended explicitly (finish), including on interruption
 *   or error, so no paid session is left running.
 * - The outcome reports what really happened: the turns read back from the
 *   saved rehearsal, and whether its review is ready. Nothing is invented.
 */

export type RehearsalTurn = {
  readonly from: "THEM" | "YOU";
  readonly text: string;
};

export type RehearsalRead = {
  readonly rehearsalId: string;
  readonly status: "ACTIVE" | "FINISHED";
  readonly turns: readonly RehearsalTurn[];
  readonly reviewReady: boolean;
};

export type RehearsalPorts = {
  readonly start: () => Promise<RehearsalRead | null>;
  readonly say: (
    rehearsalId: string,
    text: string,
  ) => Promise<RehearsalRead | null>;
  readonly finish: (rehearsalId: string) => Promise<RehearsalRead | null>;
  readonly read: (rehearsalId: string) => Promise<RehearsalRead | null>;
  /** Milliseconds, monotonic. */
  readonly now: () => number;
  readonly wait: (ms: number) => Promise<void>;
  /**
   * Optional: speak new turns aloud, in order, before the next exchange
   * (owner 15 Oct: Q plays both sides in distinct voices). Resolves when
   * spoken or when `signal` aborts. Speech is never control: the segments
   * keep their owner tags.
   */
  readonly speakTurns?: (
    segments: readonly TranscriptSegment[],
    signal: AbortSignal,
  ) => Promise<void>;
};

export type ShortRehearsalPlan = {
  /** Approved lines for the narrator's side, spoken in order. */
  readonly narratorLines: readonly string[];
  /** Target length; clamped to 15–45 s. */
  readonly maxMs: number;
  /** How many reads to wait for the review after finishing. */
  readonly reviewReads: number;
  readonly reviewReadGapMs: number;
};

export type ShortRehearsalOutcome =
  | {
      readonly ok: true;
      readonly rehearsalId: string;
      readonly endedBy: "TIME" | "LINES" | "ABORTED";
      readonly turns: readonly RehearsalTurn[];
      readonly reviewReady: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "START_FAILED" | "TURN_FAILED" | "FINISH_FAILED";
      readonly rehearsalId: string | null;
    };

export const SHORT_REHEARSAL_MIN_MS = 15_000;
export const SHORT_REHEARSAL_MAX_MS = 45_000;

export async function runShortRehearsal(
  ports: RehearsalPorts,
  plan: ShortRehearsalPlan,
  signal: AbortSignal,
  onSegment: (segment: TranscriptSegment) => void,
): Promise<ShortRehearsalOutcome> {
  const maxMs = Math.min(
    SHORT_REHEARSAL_MAX_MS,
    Math.max(SHORT_REHEARSAL_MIN_MS, plan.maxMs),
  );
  let seen = 0;
  const publish = async (read: RehearsalRead) => {
    const fresh: TranscriptSegment[] = [];
    for (const [index, turn] of read.turns.entries()) {
      if (index < seen) continue;
      const text = turn.text.trim().slice(0, 2000);
      if (text.length === 0) continue;
      const segment: TranscriptSegment = {
        segmentId: `reh-${read.rehearsalId.slice(0, 36)}-${String(index)}`,
        source: turn.from === "THEM" ? "REHEARSAL_COUNTERPART" : "NARRATOR_Q",
        channelId: turn.from === "THEM" ? "rehearsal-counterpart" : "narrator",
        text,
        final: true,
      };
      onSegment(segment);
      fresh.push(segment);
    }
    seen = Math.max(seen, read.turns.length);
    if (fresh.length > 0 && !signal.aborted) {
      await ports.speakTurns?.(fresh, signal).catch(() => undefined);
    }
  };

  const started = await ports.start().catch(() => null);
  if (started === null) {
    return { ok: false, reason: "START_FAILED", rehearsalId: null };
  }
  const id = started.rehearsalId;
  // The budget is for the exchange, not for opening the session (production
  // 15 Oct: a start took 21 s, which used to leave no time for any turn).
  const begun = ports.now();
  await publish(started);

  let endedBy: "TIME" | "LINES" | "ABORTED" = "LINES";
  let turnFailed = false;
  for (const [index, line] of plan.narratorLines.entries()) {
    if (signal.aborted) {
      endedBy = "ABORTED";
      break;
    }
    // At least one exchange, so there is something to review.
    if (index > 0 && ports.now() - begun >= maxMs) {
      endedBy = "TIME";
      break;
    }
    const said = await ports.say(id, line).catch(() => null);
    if (said === null) {
      turnFailed = true;
      break;
    }
    await publish(said);
  }
  if (signal.aborted) endedBy = "ABORTED";

  // The explicit end, whatever happened above.
  const finished = await ports.finish(id).catch(() => null);
  if (finished === null) {
    return { ok: false, reason: "FINISH_FAILED", rehearsalId: id };
  }
  await publish(finished);
  if (turnFailed) return { ok: false, reason: "TURN_FAILED", rehearsalId: id };

  let latest = finished;
  for (
    let attempt = 0;
    !latest.reviewReady && attempt < plan.reviewReads && !signal.aborted;
    attempt += 1
  ) {
    await ports.wait(plan.reviewReadGapMs);
    const read = await ports.read(id).catch(() => null);
    if (read !== null) latest = read;
  }
  return {
    ok: true,
    rehearsalId: id,
    endedBy,
    turns: latest.turns,
    reviewReady: latest.reviewReady,
  };
}
