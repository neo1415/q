/**
 * Whether a run this process holds is still getting anywhere (16 Nov 2026).
 *
 * The engine heartbeat says "a process holds this run"; it says nothing
 * about whether the run is moving. On the transaction-pooler trial a turn
 * reached SYNTHESIS, made one model call, then awaited a database read
 * that never returned: the heartbeat kept the run alive until the process
 * restarted, and the person watched "working" for minutes.
 *
 * Progress is anything that shows the run moving: a lifecycle move (a
 * stage change), a model call starting or finishing, a tool result. A
 * model call in flight is bounded by the gateway's own attempt timeouts,
 * so while one is running the run is not stalled however long it takes;
 * everything else (a read, a tool) must show progress within the window.
 *
 * In memory, per process, only for the runs this process watches. Ids and
 * timestamps only: no content.
 */

export type RunProgress = {
  /** Start watching a run, as of now. A run already watched is unchanged. */
  readonly watch: (runId: string) => void;
  /** Stop watching (the run ended, paused or was released). */
  readonly release: (runId: string) => void;
  /** Something happened on the run. Ignored for runs not watched. */
  readonly note: (runId: string) => void;
  /** A model call for the run began; the run is busy until it ends. */
  readonly callStarted: (runId: string) => void;
  /** A model call for the run ended (either way): progress. */
  readonly callEnded: (runId: string) => void;
  /**
   * Watched runs with no call in flight and no progress for at least
   * `afterMs`, with how long each has been silent.
   */
  readonly stalled: (
    afterMs: number,
  ) => readonly { readonly runId: string; readonly silentMs: number }[];
  /** Run ids watched (tests, diagnostics). */
  readonly watched: () => readonly string[];
};

type Entry = { lastAt: number; calls: number };

export function createRunProgress(
  clock: () => number = () => Date.now(),
): RunProgress {
  const runs = new Map<string, Entry>();
  return {
    watch: (runId) => {
      if (!runs.has(runId)) runs.set(runId, { lastAt: clock(), calls: 0 });
    },
    release: (runId) => {
      runs.delete(runId);
    },
    note: (runId) => {
      const entry = runs.get(runId);
      if (entry !== undefined) entry.lastAt = clock();
    },
    callStarted: (runId) => {
      const entry = runs.get(runId);
      if (entry === undefined) return;
      entry.calls += 1;
      entry.lastAt = clock();
    },
    callEnded: (runId) => {
      const entry = runs.get(runId);
      if (entry === undefined) return;
      entry.calls = Math.max(0, entry.calls - 1);
      entry.lastAt = clock();
    },
    stalled: (afterMs) => {
      const now = clock();
      const found: { runId: string; silentMs: number }[] = [];
      for (const [runId, entry] of runs) {
        const silentMs = now - entry.lastAt;
        if (entry.calls === 0 && silentMs >= afterMs) {
          found.push({ runId, silentMs });
        }
      }
      return found;
    },
    watched: () => [...runs.keys()],
  };
}
