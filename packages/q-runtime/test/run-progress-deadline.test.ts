import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  createRunEngineHeartbeat,
  createRunProgress,
  ENGINE_HEARTBEAT_INTERVAL_MS,
  RUN_STALL_AFTER_MS,
  type QOrchestrationRuntime,
} from "../src/index.js";

/**
 * The run-level progress deadline (16 Nov 2026). On the pooler trial run
 * dff4faca reached SYNTHESIS, made one model call, then awaited a read
 * that never returned; its heartbeat kept it alive until the process
 * restarted. An interactive run that shows no progress (stage change,
 * model call, tool result) for RUN_STALL_AFTER_MS is now failed as
 * RUN_EXPIRED; a model call in flight is bounded by the gateway and never
 * counts as a stall; background work is not watched.
 *
 * Virtual clock: the heartbeat's timer and the progress clock are faked.
 */

const ANSWER = "q-orchestrator-v5";
const WORKFORCE = "q-workforce-card-v1";

function ref(runId: string) {
  return { runId, tenantId: "t", actorUserId: "u" } as never;
}

function fakeRuntime(versionOf: (runId: string) => string) {
  const failed: { runId: string; code: string }[] = [];
  const outcome = (runId: string, status: string) =>
    Promise.resolve({
      kind: "ADVANCED",
      run: { id: runId, status, orchestrationVersion: versionOf(runId) },
    });
  const runtime = {
    begin: (r: { runId: string }) => outcome(r.runId, "PREFLIGHT"),
    advance: (r: { runId: string }, to: string) => outcome(r.runId, to),
    advanceThrough: (r: { runId: string }) => outcome(r.runId, "PLANNING"),
    pause: (r: { runId: string }) => outcome(r.runId, "AWAITING_INPUT"),
    resumeFromPause: (r: { runId: string }) => outcome(r.runId, "SYNTHESIS"),
    resumeFromApproval: (r: { runId: string }) => outcome(r.runId, "SYNTHESIS"),
    complete: (r: { runId: string }) => outcome(r.runId, "COMPLETED"),
    fail: (r: { runId: string }, code: string) => {
      failed.push({ runId: r.runId, code });
      return outcome(r.runId, "FAILED");
    },
    finishCancellation: (r: { runId: string }) => outcome(r.runId, "CANCELLED"),
    expire: (r: { runId: string }) => outcome(r.runId, "EXPIRED"),
  } as unknown as QOrchestrationRuntime;
  return { runtime, failed };
}

const sql = (() => Promise.resolve([])) as unknown as DatabaseExecutor;

function compose(versionOf: (runId: string) => string = () => ANSWER) {
  const progress = createRunProgress(() => Date.now());
  const { runtime, failed } = fakeRuntime(versionOf);
  const warnings: string[] = [];
  const heartbeat = createRunEngineHeartbeat({
    sql,
    runtime,
    logger: {
      warn: (_fields: unknown, message: string) => warnings.push(message),
    } as never,
    stall: {
      progress,
      appliesTo: (run) => run.orchestrationVersion === ANSWER,
    },
  });
  heartbeat.start();
  return { heartbeat, progress, failed, warnings };
}

describe("the run progress deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is 90 s, checked every heartbeat", () => {
    expect(RUN_STALL_AFTER_MS).toBe(90_000);
    expect(ENGINE_HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });

  it("fails an answer run stuck on a read after its last model call, with the run-did-not-finish code", async () => {
    const { heartbeat, progress, failed, warnings } = compose();
    await heartbeat.runtime.begin(ref("r1"), ANSWER);
    await heartbeat.runtime.advance(ref("r1"), "SYNTHESIS");
    // The classification call: started, timed out, ended.
    progress.callStarted("r1");
    await vi.advanceTimersByTimeAsync(3_000);
    progress.callEnded("r1");
    // Then a read that never returns: nothing more happens. At 90 s the
    // last progress (3 s) is 87 s old: kept.
    await vi.advanceTimersByTimeAsync(RUN_STALL_AFTER_MS - 3_000);
    expect(failed).toEqual([]);
    // The next beat (105 s) finds it 102 s silent.
    await vi.advanceTimersByTimeAsync(ENGINE_HEARTBEAT_INTERVAL_MS);
    expect(failed).toEqual([{ runId: "r1", code: "RUN_EXPIRED" }]);
    expect(heartbeat.held()).toEqual([]);
    expect(progress.watched()).toEqual([]);
    expect(warnings).toContain(
      "q run made no progress within its deadline; failing it",
    );
    // Failed once, not again on later beats.
    await vi.advanceTimersByTimeAsync(5 * 15_000);
    expect(failed).toHaveLength(1);
    heartbeat.stop();
  });

  it("keeps a run whose long model call is still in flight", async () => {
    const { heartbeat, progress, failed } = compose();
    await heartbeat.runtime.begin(ref("r2"), ANSWER);
    progress.callStarted("r2");
    await vi.advanceTimersByTimeAsync(3 * RUN_STALL_AFTER_MS);
    expect(failed).toEqual([]);
    expect(heartbeat.held()).toEqual(["r2"]);
    // The call ends; the window starts again from there.
    progress.callEnded("r2");
    await vi.advanceTimersByTimeAsync(RUN_STALL_AFTER_MS - 15_000);
    expect(failed).toEqual([]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(failed.map((f) => f.runId)).toEqual(["r2"]);
    heartbeat.stop();
  });

  it("keeps a run that keeps moving", async () => {
    const { heartbeat, progress, failed } = compose();
    await heartbeat.runtime.begin(ref("r3"), ANSWER);
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      // Alternate the kinds of progress: a tool result, a stage change.
      if (i % 2 === 0) progress.note("r3");
      else await heartbeat.runtime.advance(ref("r3"), "SYNTHESIS");
    }
    expect(failed).toEqual([]);
    await heartbeat.runtime.complete(ref("r3"), undefined);
    expect(progress.watched()).toEqual([]);
    heartbeat.stop();
  });

  it("never fails background work (workforce runs are not watched)", async () => {
    const { heartbeat, failed, progress } = compose(() => WORKFORCE);
    await heartbeat.runtime.begin(ref("w1"), WORKFORCE);
    expect(progress.watched()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10 * RUN_STALL_AFTER_MS);
    expect(failed).toEqual([]);
    expect(heartbeat.held()).toEqual(["w1"]);
    heartbeat.stop();
  });

  it("a run paused for a person is not watched while it waits", async () => {
    const { heartbeat, failed, progress } = compose();
    await heartbeat.runtime.begin(ref("r4"), ANSWER);
    await heartbeat.runtime.pause(ref("r4"));
    expect(progress.watched()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10 * RUN_STALL_AFTER_MS);
    expect(failed).toEqual([]);
    heartbeat.stop();
  });
});
