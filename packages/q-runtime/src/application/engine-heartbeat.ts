import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import type { QRunRecord } from "../contracts/index.js";
import type {
  QLifecycleOutcome,
  QOrchestrationRuntime,
  QRunRef,
} from "./orchestration-runtime.js";
import type { RunProgress } from "./run-progress.js";

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

/**
 * Silence after which a watched interactive run is failed (16 Nov 2026).
 * A healthy turn finishes in about 11 s and moves at least every few
 * seconds; the slowest legitimate gap without a stage change, model call
 * or tool result is a read bounded by the statement budget (10 s) or a
 * tool bounded by its own HTTP timeouts. 90 s is well past both and well
 * short of the minutes the pooler-trial run hung. Checked on each beat,
 * so a stalled run fails 90-105 s after its last progress.
 */
export const RUN_STALL_AFTER_MS = 90 * 1000;

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
  /**
   * The progress deadline. A held run it applies to that shows no progress
   * (run-progress.ts) for `afterMs` is failed as RUN_EXPIRED, whose public
   * line is the one a person already sees for a run that did not finish,
   * instead of being kept alive by its heartbeat. Absent: no deadline.
   */
  readonly stall?:
    | {
        readonly progress: RunProgress;
        readonly afterMs?: number | undefined;
        /**
         * Which runs it applies to: interactive answer runs only. Long
         * background work (workforce jobs) keeps its own limits.
         */
        readonly appliesTo: (run: QRunRecord) => boolean;
      }
    | undefined;
}): RunEngineHeartbeat {
  const { sql, logger, stall } = options;
  const held = new Map<string, QRunRef>();
  /** Stalled runs being failed now, so overlapping beats fail each once. */
  const failing = new Set<string>();
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
      stall?.progress.release(id);
      return;
    }
    if (!held.has(id)) {
      held.set(id, ref);
      if (stall?.appliesTo(outcome.run) === true) stall.progress.watch(id);
      void touch([id]);
    }
    // A lifecycle move is progress (no-op for a run not watched).
    stall?.progress.note(id);
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

  /** Fails each held, watched run that has stopped making progress. */
  async function failStalled(): Promise<void> {
    if (stall === undefined) return;
    const afterMs = stall.afterMs ?? RUN_STALL_AFTER_MS;
    for (const { runId, silentMs } of stall.progress.stalled(afterMs)) {
      const ref = held.get(runId);
      if (ref === undefined) {
        stall.progress.release(runId);
        continue;
      }
      if (failing.has(runId)) continue;
      failing.add(runId);
      logger?.warn(
        { qRunId: runId, silentMs, stallAfterMs: afterMs },
        "q run made no progress within its deadline; failing it",
      );
      try {
        // The tracked fail: releases the run from the heartbeat and the
        // watch. Whatever the stuck work does later meets a terminal run.
        await runtime.fail(ref, "RUN_EXPIRED");
      } catch (error: unknown) {
        // Left watched: the next beat tries again.
        logger?.warn(
          { err: error, qRunId: runId },
          "q stalled run could not be failed; retrying next beat",
        );
      } finally {
        failing.delete(runId);
      }
    }
  }

  const beat = async () => {
    await touch([...held.keys()]);
    await failStalled();
  };

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
