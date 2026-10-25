/**
 * A client poll that costs nothing while nobody is looking (egress review,
 * 2026-10-24: the project hit its egress quota). Every poll on the web goes
 * through this:
 *
 * - it never reads while the tab is hidden, and reads at once when the
 *   person comes back;
 * - it backs off while nothing changes (1.2 s, 1.9 s, 3.1 s ... up to the
 *   ceiling) and returns to the first pace as soon as something does;
 * - one read at a time: a slow read is never overlapped by the next.
 *
 * Where a run has an event stream, the stream is the signal and this is
 * only the fallback (see usePrepared).
 */

export type PollPace = {
  /** The pace after a change, and the first pace. */
  readonly firstMs: number;
  /** The slowest it gets while nothing changes. */
  readonly maxMs: number;
  /** How much slower each unchanged read makes the next; 1 keeps it fixed. */
  readonly factor?: number | undefined;
};

/** What one read found: something new, nothing new, or the end. */
export type PollOutcome = "changed" | "same" | "done";

const DEFAULT_FACTOR = 1.6;

export function nextPollDelay(
  current: number,
  outcome: Exclude<PollOutcome, "done">,
  pace: PollPace,
): number {
  if (outcome === "changed") return pace.firstMs;
  return Math.min(
    pace.maxMs,
    Math.max(
      pace.firstMs,
      Math.round(current * (pace.factor ?? DEFAULT_FACTOR)),
    ),
  );
}

export type PacedPoll = {
  /** Read now (an event said something moved) and return to the first pace. */
  readonly now: () => void;
  readonly stop: () => void;
};

/**
 * Starts polling `read`. With `immediate`, the first read is now; without,
 * it waits one first pace (the caller already holds a fresh value).
 */
export function startPacedPoll(
  read: () => Promise<PollOutcome>,
  pace: PollPace,
  options: { readonly immediate?: boolean } = {},
): PacedPoll {
  let delay = pace.firstMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let again = false;
  let stopped = false;

  const hidden = () =>
    typeof document !== "undefined" && document.visibilityState === "hidden";

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    // Hidden: no timer at all; the visibility listener picks it up.
    if (stopped || hidden()) return;
    timer = setTimeout(() => void run(), delay);
  };
  const run = async () => {
    timer = undefined;
    if (stopped) return;
    if (hidden()) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    let outcome: PollOutcome;
    try {
      outcome = await read();
    } catch {
      // A failed read is tried again at a slower pace, never in a burst.
      outcome = "same";
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    if (outcome === "done") {
      stop();
      return;
    }
    delay = nextPollDelay(delay, again ? "changed" : outcome, pace);
    if (again) {
      again = false;
      void run();
      return;
    }
    schedule();
  };
  const onVisibility = () => {
    if (stopped) return;
    if (hidden()) {
      clear();
      return;
    }
    // Back in view: whatever happened meanwhile is read now.
    delay = pace.firstMs;
    clear();
    void run();
  };
  const stop = () => {
    stopped = true;
    clear();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisibility);
  };

  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", onVisibility);
  if (options.immediate === true) void run();
  else schedule();

  return {
    now: () => {
      if (stopped) return;
      delay = pace.firstMs;
      clear();
      void run();
    },
    stop,
  };
}
