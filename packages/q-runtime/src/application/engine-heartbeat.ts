import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import type {
  QLifecycleOutcome,
  QOrchestrationRuntime,
  QRunRef,
} from "./orchestration-runtime.js";

/**
 * Which runs this process is orchestrating, said durably (RECOVERY G-D24).
 *
 * Wraps the orchestration runtime: a run this process moves into an
 * in-flight state is held; a run it pauses, finishes, fails, cancels or
 * expires is released. While held, `engine_heartbeat_at` is touched every
 * `intervalMs` in one statement for all held runs, and once at the moment
 * a run is taken up, so a run resumed after a long pause is never mistaken
 * for an orphan. When the process dies the heartbeats stop, and the orphan
 * sweep closes the run within its engine window (orphaned-runs.ts).
 *
 * The heartbeat says only "a process holds this run"; it is not a lock and
 * gives no authority. A failed heartbeat write is logged and retried on
 * the next beat: missing a beat or two is what the window allows for.
 */

export const ENGINE_HEARTBEAT_INTERVAL_MS = 15 * 1000;

const NOT_IN_FLIGHT = new Set([
  "AWAITING_INPUT",
  "AWAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

export type RunEngineHeartbeat = {
  /** The runtime to give the engine: same behaviour, runs tracked. */
  readonly runtime: QOrchestrationRuntime;
  /** Touch every held run now. */
  readonly beat: () => Promise<void>;
  readonly start: () => void;
  readonly stop: () => void;
  /** Run ids currently held by this process (tests, diagnostics). */
  readonly held: () => readonly string[];
};

export function createRunEngineHeartbeat(options: {
  readonly sql: DatabaseExecutor;
  readonly runtime: QOrchestrationRuntime;
  readonly intervalMs?: number | undefined;
  readonly logger?: Logger | undefined;
}): RunEngineHeartbeat {
  const { sql, logger } = options;
  const held = new Map<string, QRunRef>();
  let timer: ReturnType<typeof setInterval> | undefined;

  async function touch(runIds: readonly string[]): Promise<void> {
    if (runIds.length === 0) return;
    try {
      await sql`
        update q_runtime.runs
           set engine_heartbeat_at = clock_timestamp()
         where id = any(${runIds as string[]}::uuid[])
           and status not in ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')`;
    } catch (error: unknown) {
      logger?.warn(
        { err: error, heldRuns: runIds.length },
        "q run engine heartbeat not written; retrying next beat",
      );
    }
  }

  /** Follows a lifecycle move: held while in flight, released otherwise. */
  function follow(ref: QRunRef, outcome: QLifecycleOutcome): void {
    const id = ref.runId;
    if (NOT_IN_FLIGHT.has(outcome.run.status)) {
      held.delete(id);
      return;
    }
    if (!held.has(id)) {
      held.set(id, ref);
      void touch([id]);
    }
  }

  const inner = options.runtime;
  const tracked =
    <A extends unknown[]>(
      method: (ref: QRunRef, ...rest: A) => Promise<QLifecycleOutcome>,
    ) =>
    async (ref: QRunRef, ...rest: A): Promise<QLifecycleOutcome> => {
      const outcome = await method(ref, ...rest);
      follow(ref, outcome);
      return outcome;
    };

  const runtime: QOrchestrationRuntime = {
    ...inner,
    begin: tracked(inner.begin),
    advance: tracked(inner.advance),
    advanceThrough: tracked(inner.advanceThrough),
    pause: tracked(inner.pause),
    resumeFromPause: tracked(inner.resumeFromPause),
    resumeFromApproval: tracked(inner.resumeFromApproval),
    complete: tracked(inner.complete),
    fail: tracked(inner.fail),
    finishCancellation: tracked(inner.finishCancellation),
    expire: tracked(inner.expire),
  };

  const beat = () => touch([...held.keys()]);

  return {
    runtime,
    beat,
    start: () => {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        void beat();
      }, options.intervalMs ?? ENGINE_HEARTBEAT_INTERVAL_MS);
      timer.unref();
    },
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    held: () => [...held.keys()],
  };
}
