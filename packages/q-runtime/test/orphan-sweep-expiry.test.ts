import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  createOrphanedRunSweep,
  type QOrchestrationRuntime,
  type QRunRepository,
} from "../src/index.js";

/**
 * Autopilot P1 (live 2026-10-06): runs paused on a person's approval were
 * closed by the orphan sweep as FAILED RUN_EXPIRED -- 24 standing-instruction
 * cards in a day read as Q failures. A pause whose wait ran out EXPIRES;
 * only an in-flight run with no engine fails.
 */
describe("orphaned run sweep: an unanswered pause expires, it does not fail", () => {
  it("expires AWAITING_APPROVAL / AWAITING_INPUT and fails only silent in-flight runs", async () => {
    const stale = [
      { id: "a", status: "AWAITING_APPROVAL" },
      { id: "b", status: "AWAITING_INPUT" },
      { id: "c", status: "SYNTHESIS" },
      { id: "d", status: "CANCEL_REQUESTED" },
    ].map((run) => ({
      ...run,
      tenantId: "t",
      actorUserId: "u",
      version: 1,
    }));
    const calls: string[] = [];
    const runtime = {
      fail: (ref: { runId: string }, code: string) => {
        calls.push(`fail:${ref.runId}:${code}`);
        return Promise.resolve({ kind: "ADVANCED" });
      },
      expire: (ref: { runId: string }, code: string) => {
        calls.push(`expire:${ref.runId}:${code}`);
        return Promise.resolve({ kind: "ADVANCED" });
      },
      finishCancellation: (ref: { runId: string }) => {
        calls.push(`cancel:${ref.runId}`);
        return Promise.resolve({ kind: "ADVANCED" });
      },
    } as unknown as QOrchestrationRuntime;
    const runs = {
      listStale: () => Promise.resolve(stale),
    } as unknown as QRunRepository;

    const result = await createOrphanedRunSweep({
      sql: {} as DatabaseExecutor,
      runs,
      runtime,
    }).sweep();

    expect(calls).toEqual([
      "expire:a:APPROVAL_EXPIRED",
      "expire:b:RUN_EXPIRED",
      "fail:c:RUN_EXPIRED",
      "cancel:d",
    ]);
    expect(result).toEqual({
      examined: 4,
      failed: 1,
      expired: 2,
      cancelled: 1,
      untouched: 0,
    });
  });
});
