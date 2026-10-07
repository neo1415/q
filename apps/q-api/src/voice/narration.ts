import {
  nextSilenceBeat,
  Q_SILENCE_LADDER,
  Q_SILENCE_START,
  type QSilenceBeat,
  type QSilenceFocus,
  type QSilenceState,
  type QSilenceThread,
  type QVisibleStage,
} from "@capital-q/contracts";

/**
 * The silence ladder on a voice turn (ADR 0062; Q room R7).
 *
 * Wraps the stream of the answer's sentences. Until the first sentence
 * arrives, the ladder decides what fills the wait, from the run's real
 * stage (`live`, updated by the turn as stage events arrive), the subject
 * code resolved for the person (`focus`), and at most one of their own
 * remembered small-talk threads (`thread`). Once the answer starts, the
 * ladder is done and every sentence passes through untouched.
 *
 * Where a beat goes depends on the line: the standard voice speaks it as
 * part of the stream (it is never recorded as the answer: the caller's tap
 * sits inside, on the answer's own sentences); the duplex line takes it
 * through `narrate` and voices it out of band. The tone is the browser's,
 * so it is never spoken here.
 */

export type SilenceLive = {
  stage: QVisibleStage | null;
  approvalWaiting: boolean;
};

export type SilenceLadderOptions = {
  readonly live: SilenceLive;
  /** The subject, resolved for the person; started at the tone, used if ready. */
  readonly focus?: (() => Promise<QSilenceFocus | null>) | undefined;
  /** One of their own small-talk threads, unused this session; asked for once. */
  readonly thread?: (() => Promise<QSilenceThread | null>) | undefined;
  /** Called when a thread was said, so the session never repeats it. */
  readonly onThread?: ((memoryItemId: string) => void) | undefined;
  /** Out of band (duplex): the beat is handed here instead of yielded. */
  readonly narrate?: ((beat: QSilenceBeat) => void) | undefined;
  readonly seed: number;
  readonly signal?: AbortSignal | undefined;
  readonly now?: (() => number) | undefined;
  /** False: this turn gets no ladder (a look-up, an interview step). */
  readonly enabled?: boolean | undefined;
  /**
   * The answer's text is not heard as it streams (a deferred speaker):
   * the ladder runs until the source ends, not until its first part.
   */
  readonly untilDone?: boolean | undefined;
};

const TIMEOUT = Symbol("timeout");
/** How long one beat waits for the subject before using generic words. */
const FOCUS_WAIT_MS = 30;

type Settled<T> = { value: () => T | undefined; done: () => boolean };

function settled<T>(promise: Promise<T>): Settled<T> {
  let value: T | undefined;
  let done = false;
  void promise.then(
    (resolved) => {
      value = resolved;
      done = true;
    },
    () => {
      done = true;
    },
  );
  return { value: () => value, done: () => done };
}

export async function* withSilenceLadder(
  source: AsyncIterable<string>,
  options: SilenceLadderOptions,
): AsyncGenerator<string> {
  const now = options.now ?? (() => Date.now());
  const iterator = source[Symbol.asyncIterator]();
  const started = now();
  let state: QSilenceState = Q_SILENCE_START;
  let focus: Settled<QSilenceFocus | null> | null = null;
  let thread: Settled<QSilenceThread | null> | null = null;
  let ladder = options.enabled !== false;
  let pending = iterator.next();
  for (;;) {
    if (!ladder || options.signal?.aborted === true) {
      const step = await pending;
      if (step.done === true) return;
      yield step.value;
      pending = iterator.next();
      continue;
    }
    const elapsed = now() - started;
    // Reads begin only once the wait is real: a quick answer costs nothing.
    // The subject is asked again while unknown: the run's tools may name
    // it only after the first beat (W4b: read from the run's own calls).
    if (
      elapsed >= Q_SILENCE_LADDER.toneAtMs &&
      (focus === null || (focus.done() && (focus.value() ?? null) === null))
    ) {
      const asked = options.focus?.() ?? Promise.resolve(null);
      focus = settled(asked);
      // A ready answer is used for this beat; a slow one waits for the next.
      await Promise.race([
        asked.catch(() => null),
        new Promise<void>((resolve) => {
          setTimeout(resolve, FOCUS_WAIT_MS);
        }),
      ]);
    }
    if (thread === null && elapsed >= Q_SILENCE_LADDER.progressAtMs) {
      thread = settled(options.thread?.() ?? Promise.resolve(null));
    }
    const step = nextSilenceBeat(state, {
      elapsedMs: elapsed,
      stage: options.live.stage,
      focus: focus?.value() ?? null,
      hushed: false,
      approvalWaiting: options.live.approvalWaiting,
      thread: thread?.value() ?? null,
      seed: options.seed,
    });
    state = step.state;
    const beat = step.beat;
    if (beat !== null && beat.kind !== "TONE") {
      if (beat.kind === "THREAD") options.onThread?.(beat.memoryItemId);
      if (options.narrate !== undefined) options.narrate(beat);
      else yield beat.text;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait =
      step.nextAtMs === null
        ? null
        : Math.max(0, step.nextAtMs - (now() - started));
    const outcome = await Promise.race([
      pending,
      wait === null
        ? new Promise<never>(() => undefined)
        : new Promise<typeof TIMEOUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMEOUT), wait);
          }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (outcome === TIMEOUT) continue;
    if (outcome.done === true) return;
    // The answer has started: the ladder is done for this turn -- unless
    // nothing is heard until the whole answer is in.
    if (options.untilDone !== true) ladder = false;
    yield outcome.value;
    pending = iterator.next();
  }
}
