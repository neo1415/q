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
 * Replay of production run a3ea0ea5 (conversation 9995dcca, 17 Nov 2026,
 * investor Zino Aviation). Recorded timeline, from q_runtime.run_events:
 *
 *   15:01:22  q.run.started
 *   15:01:29  WAITING_FOR_APPROVAL (the Approval Engine moved the run to
 *             AWAITING_APPROVAL in its own proposal transaction)
 *   15:01:34  q.action.proposed + q.approval.required (card c02fa2c8)
 *   15:01:35  q.message.completed (the card's "Ready to send" line)
 *   15:03:14  q.run.failed EXPIRED -- 99 s after the last progress
 *
 * and in q_runtime.actions / approvals: the action WITHDRAWN and its
 * approval REVOKED at 15:03:14, by no user. The progress deadline failed a
 * run that was only waiting for the investor's tap, because the heartbeat
 * never saw the pause. The run's own record now decides.
 */

const ANSWER = "q-orchestrator-v5";

function ref(runId: string) {
  return { runId, tenantId: "t", actorUserId: "u" } as never;
}

function compose(durable: Map<string, string>) {
  const failed: string[] = [];
  const outcome = (runId: string, status: string) => {
    durable.set(runId, status);
    return Promise.resolve({
      kind: "ADVANCED",
      run: { id: runId, status, orchestrationVersion: ANSWER },
    });
  };
  const runtime = {
    begin: (r: { runId: string }) => outcome(r.runId, "PREFLIGHT"),
    advance: (r: { runId: string }, to: string) => outcome(r.runId, to),
    resumeFromApproval: (r: { runId: string }) =>
      outcome(r.runId, "ACTION_EXECUTION"),
    complete: (r: { runId: string }) => outcome(r.runId, "COMPLETED"),
    fail: (r: { runId: string }) => {
      failed.push(r.runId);
      return outcome(r.runId, "FAILED");
    },
  } as unknown as QOrchestrationRuntime;
  // The status read the deadline makes; anything else (the heartbeat's
  // touch) returns nothing.
  const reads: string[][] = [];
  const sql = ((strings: TemplateStringsArray, ids: string[]) => {
    if (!strings.join("?").includes("select id::text as id, status")) {
      return Promise.resolve([]);
    }
    reads.push(ids);
    return Promise.resolve(
      ids.flatMap((id) => {
        const status = durable.get(id);
        return status === undefined ? [] : [{ id, status }];
      }),
    );
  }) as unknown as DatabaseExecutor;
  const progress = createRunProgress(() => Date.now());
  const heartbeat = createRunEngineHeartbeat({
    sql,
    runtime,
    stall: { progress, appliesTo: () => true },
  });
  heartbeat.start();
  return { heartbeat, progress, failed, reads };
}

describe("a run waiting on its approval card (replay a3ea0ea5)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is released, never failed, when the Approval Engine paused it outside the tracked runtime", async () => {
    const durable = new Map<string, string>();
    const { heartbeat, progress, failed, reads } = compose(durable);
    await heartbeat.runtime.begin(ref("a3ea0ea5"), ANSWER);
    await heartbeat.runtime.advance(ref("a3ea0ea5"), "SYNTHESIS");
    // 15:01:29: the proposal transaction moves the run (not the runtime).
    await vi.advanceTimersByTimeAsync(7_000);
    durable.set("a3ea0ea5", "AWAITING_APPROVAL");
    // 15:01:35: the card's line is the last progress.
    await vi.advanceTimersByTimeAsync(6_000);
    progress.note("a3ea0ea5");
    // Production failed it at 99 s; well past that, it still waits.
    await vi.advanceTimersByTimeAsync(
      RUN_STALL_AFTER_MS + 4 * ENGINE_HEARTBEAT_INTERVAL_MS,
    );
    expect(failed).toEqual([]);
    expect(reads.flat()).toContain("a3ea0ea5");
    expect(heartbeat.held()).toEqual([]);
    expect(progress.watched()).toEqual([]);
    // The investor approves later: the resume takes it up again.
    await heartbeat.runtime.resumeFromApproval(ref("a3ea0ea5"));
    expect(heartbeat.held()).toEqual(["a3ea0ea5"]);
    heartbeat.stop();
  });

  it("still fails a run whose record says it is in flight and silent", async () => {
    const durable = new Map<string, string>();
    const { heartbeat, failed } = compose(durable);
    await heartbeat.runtime.begin(ref("stuck"), ANSWER);
    await heartbeat.runtime.advance(ref("stuck"), "SYNTHESIS");
    await vi.advanceTimersByTimeAsync(
      RUN_STALL_AFTER_MS + ENGINE_HEARTBEAT_INTERVAL_MS,
    );
    expect(failed).toEqual(["stuck"]);
    heartbeat.stop();
  });
});
