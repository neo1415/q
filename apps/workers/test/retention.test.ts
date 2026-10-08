import { describe, expect, it } from "vitest";

import type { TransactionManager } from "@capital-q/database";

import {
  RETENTION,
  runRetentionPass,
  TERMINAL_RUN_STATUSES,
} from "../src/retention/retention.js";

/**
 * DEF-A9 / F-D10. The decisions are pinned here: which rows qualify, in
 * which order things are deleted, and that a second worker skips rather
 * than racing. The SQL itself was run against the local database.
 */

type Call = { text: string; values: unknown[] };

function fakeTransactions(options: {
  readonly locked: boolean;
  readonly deadThreads: string[];
}): { transactions: TransactionManager; calls: Call[] } {
  const calls: Call[] = [];
  const sql = (strings: unknown, ...values: unknown[]) => {
    // `sql(list)` builds an IN-list fragment; record it as itself.
    if (!Array.isArray(strings) || !("raw" in strings)) return strings;
    const text = (strings as string[]).join("$").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    if (text.includes("pg_try_advisory_xact_lock")) {
      return Promise.resolve([{ locked: options.locked }]);
    }
    if (text.startsWith("select distinct c.thread_id")) {
      return Promise.resolve(
        options.deadThreads.map((thread_id) => ({ thread_id })),
      );
    }
    return Promise.resolve(Object.assign([], { count: 3 }));
  };
  return {
    calls,
    transactions: {
      run: (work) => work({ sql } as never),
    },
  };
}

describe("retention (DEF-A9, F-D10)", () => {
  it("skips the pass when another worker holds the lock", async () => {
    const { transactions, calls } = fakeTransactions({
      locked: false,
      deadThreads: ["t1"],
    });
    const pass = await runRetentionPass({ transactions });
    expect(pass).toEqual({
      skipped: true,
      checkpointThreads: 0,
      checkpointRows: 0,
      voiceTurns: 0,
    });
    expect(calls).toHaveLength(1);
  });

  it("prunes only terminal, old runs' checkpoints, writes and blobs before headers", async () => {
    const { transactions, calls } = fakeTransactions({
      locked: true,
      deadThreads: ["run-1", "run-2"],
    });
    const pass = await runRetentionPass({ transactions });
    const select = calls.find((c) => c.text.startsWith("select distinct"));
    expect(select?.text).toContain(
      "join q_runtime.runs r on r.id::text = c.thread_id",
    );
    expect(select?.text).toContain("coalesce(r.completed_at, r.created_at)");
    expect(select?.values).toContain(RETENTION.checkpointDays);
    const deletes = calls
      .filter((c) => c.text.startsWith("delete from q_runtime.checkpoint"))
      .map((c) => c.text.split(" ")[2]);
    expect(deletes).toEqual([
      "q_runtime.checkpoint_writes",
      "q_runtime.checkpoint_blobs",
      "q_runtime.checkpoints",
    ]);
    expect(pass).toMatchObject({
      skipped: false,
      checkpointThreads: 2,
      checkpointRows: 9,
    });
  });

  it("deletes only unlinked voice turns past their retention, oldest first, bounded", async () => {
    const { transactions, calls } = fakeTransactions({
      locked: true,
      deadThreads: [],
    });
    const pass = await runRetentionPass({ transactions });
    const voice = calls.find((c) => c.text.includes("voice_line_turns"));
    expect(voice?.text).toContain("where conversation_id is null");
    expect(voice?.text).toContain("order by spoken_at");
    expect(voice?.values).toEqual([
      RETENTION.orphanVoiceTurnDays,
      RETENTION.voiceTurnsPerPass,
    ]);
    // No dead threads: no checkpoint deletes at all.
    expect(
      calls.some((c) => c.text.startsWith("delete from q_runtime.checkpoint")),
    ).toBe(false);
    expect(pass.voiceTurns).toBe(3);
  });

  it("never touches a run that could still resume", async () => {
    expect(TERMINAL_RUN_STATUSES).not.toContain("AWAITING_APPROVAL");
    expect(TERMINAL_RUN_STATUSES).not.toContain("RUNNING");
    const { transactions, calls } = fakeTransactions({
      locked: true,
      deadThreads: [],
    });
    await runRetentionPass({ transactions });
    const select = calls.find((c) => c.text.startsWith("select distinct"));
    expect(select?.values[0]).toEqual(TERMINAL_RUN_STATUSES);
  });
});
