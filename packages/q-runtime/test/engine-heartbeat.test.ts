import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  createOrphanedRunSweep,
  createRunEngineHeartbeat,
  ORPHAN_ENGINE_WINDOW_MS,
  type QOrchestrationRuntime,
  type QRunRepository,
} from "../src/index.js";

/**
 * RECOVERY G-D24: a run mid-answer when q-api restarted stayed in
 * SYNTHESIS for over 6 minutes. The engine now heartbeats the runs it
 * holds, and the sweep closes a run whose heartbeat stopped within a
 * minute, as RUN_EXPIRED ("That one didn't finish. Ask again and I'll
 * start it fresh.").
 */

const REF = { runId: "r1", tenantId: "t", actorUserId: "u" } as never;

function fakeRuntime(statusAfter: Record<string, string>) {
  const move = (name: string) => () =>
    Promise.resolve({
      kind: "ADVANCED",
      run: { id: "r1", status: statusAfter[name] ?? "SYNTHESIS" },
    });
  return {
    begin: move("begin"),
    advance: move("advance"),
    advanceThrough: move("advanceThrough"),
    pause: move("pause"),
    resumeFromPause: move("resumeFromPause"),
    resumeFromApproval: move("resumeFromApproval"),
    complete: move("complete"),
    fail: move("fail"),
    finishCancellation: move("finishCancellation"),
    expire: move("expire"),
  } as unknown as QOrchestrationRuntime;
}

function recordingSql() {
  const touched: string[][] = [];
  const sql = ((_strings: TemplateStringsArray, ids: string[]) => {
    touched.push([...ids]);
    return Promise.resolve([]);
  }) as unknown as DatabaseExecutor;
  return { sql, touched };
}

describe("the run engine heartbeat (G-D24)", () => {
  it("holds a run while in flight, touching it at once, and releases it on a pause or an end", async () => {
    const { sql, touched } = recordingSql();
    const heartbeat = createRunEngineHeartbeat({
      sql,
      runtime: fakeRuntime({
        begin: "PLANNING",
        pause: "AWAITING_APPROVAL",
        resumeFromApproval: "SYNTHESIS",
        complete: "COMPLETED",
      }),
    });
    await heartbeat.runtime.begin(REF, undefined as never);
    expect(heartbeat.held()).toEqual(["r1"]);
    expect(touched).toEqual([["r1"]]); // taken up: touched now, not in 15 s

    await heartbeat.beat();
    expect(touched.at(-1)).toEqual(["r1"]);

    await heartbeat.runtime.pause(REF);
    expect(heartbeat.held()).toEqual([]); // a person holds it now, not an engine

    // Resumed after a long pause: touched at once, so its old heartbeat
    // never makes it look orphaned.
    await heartbeat.runtime.resumeFromApproval(REF);
    expect(heartbeat.held()).toEqual(["r1"]);
    expect(touched.at(-1)).toEqual(["r1"]);

    await heartbeat.runtime.complete(REF, undefined);
    expect(heartbeat.held()).toEqual([]);
    const writes = touched.length;
    await heartbeat.beat();
    expect(touched).toHaveLength(writes); // nothing held: no write
  });

  it("asks the repository for runs whose heartbeat stopped a minute ago", async () => {
    let asked: Record<string, unknown> | undefined;
    const runs = {
      listStale: (_sql: unknown, input: Record<string, unknown>) => {
        asked = input;
        return Promise.resolve([]);
      },
    } as unknown as QRunRepository;
    const now = new Date("2026-10-09T12:00:00.000Z");
    await createOrphanedRunSweep({
      sql: {} as DatabaseExecutor,
      runs,
      runtime: {} as QOrchestrationRuntime,
      now: () => now,
    }).sweep();
    expect(ORPHAN_ENGINE_WINDOW_MS).toBe(60_000);
    expect(asked?.["engineSilentSince"]).toBe("2026-10-09T11:59:00.000Z");
    // The silence rule for runs no heartbeating engine held is unchanged.
    expect(asked?.["inFlightSilentSince"]).toBe("2026-10-09T11:45:00.000Z");
  });
});
