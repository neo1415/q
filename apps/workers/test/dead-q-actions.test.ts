import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  DEAD_Q_ACTION_ERROR,
  settleDeadQActionEvents,
  writeAllowed,
} from "../src/outbox/dead-q-actions.js";

/** Records each statement; answers the count query, then the write. */
function recordingSql(counts: { event_type: string; n: number }[]) {
  const statements: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    statements.push({ text, values });
    if (text.startsWith("select")) return Promise.resolve(counts);
    const total = counts.reduce((sum, row) => sum + row.n, 0);
    return Promise.resolve(
      Array.from({ length: total }, (_, i) => ({ id: String(i) })),
    );
  }) as unknown as DatabaseExecutor;
  return { sql, statements };
}

const COUNTS = [
  { event_type: "q.action.approved", n: 2 },
  { event_type: "q.action.prepared", n: 3 },
];

describe("the dead q.action outbox plan (DEF-A1)", () => {
  it("a dry run counts by type and changes nothing", async () => {
    const { sql, statements } = recordingSql(COUNTS);
    const summary = await settleDeadQActionEvents(sql, "DRY_RUN");
    expect(summary).toEqual({
      mode: "DRY_RUN",
      byType: { "q.action.approved": 2, "q.action.prepared": 3 },
      total: 5,
      changed: 0,
    });
    expect(statements).toHaveLength(1);
  });

  it("requeue resets attempts only for unpublished UNKNOWN_TYPE q.action rows", async () => {
    const { sql, statements } = recordingSql(COUNTS);
    const summary = await settleDeadQActionEvents(sql, "REQUEUE");
    expect(summary.changed).toBe(5);
    const write = statements[1];
    expect(write?.text).toMatch(/^update events\.outbox set attempt_count = 0/);
    expect(write?.text).toContain("event_type like 'q.action.%'");
    expect(write?.text).toContain("published_at is null");
    expect(write?.values).toEqual([`${DEAD_Q_ACTION_ERROR}%`]);
  });

  it("discard deletes the same rows and nothing else", async () => {
    const { sql, statements } = recordingSql(COUNTS);
    await settleDeadQActionEvents(sql, "DISCARD");
    expect(statements[1]?.text).toMatch(/^delete from events\.outbox/);
    expect(statements[1]?.text).toContain("published_at is null");
  });

  it("writes to a local database, and to hosted only with a named approval", () => {
    expect(
      writeAllowed({
        databaseUrl: "postgresql://postgres:x@127.0.0.1:54322/postgres",
        hostedApprovedBy: undefined,
      }).ok,
    ).toBe(true);
    expect(
      writeAllowed({
        databaseUrl:
          "postgresql://postgres.ref:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
        hostedApprovedBy: undefined,
      }).ok,
    ).toBe(false);
    expect(
      writeAllowed({
        databaseUrl:
          "postgresql://postgres.ref:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
        hostedApprovedBy: "Zino",
      }).ok,
    ).toBe(true);
    expect(
      writeAllowed({ databaseUrl: undefined, hostedApprovedBy: "Zino" }).ok,
    ).toBe(false);
  });
});
