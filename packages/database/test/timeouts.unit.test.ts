import type { Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";

import { toDatabaseError } from "../src/errors.js";
import {
  lockTimeoutFor,
  QUERY_DEADLINE_GRACE_MS,
  resolvePostgresOptions,
  resolveSqlTimeouts,
  transactionLimitsFor,
} from "../src/internal/postgres.js";
import { instrumentSql, QueryDeadlineError } from "../src/round-trips.js";
import { createTransactionManager } from "../src/transaction.js";

/**
 * Statement limits that survive the pooler (16 Nov 2026: Supavisor drops
 * startup parameters, so the statement timeout passed at connect was never
 * in force on hosted, and a Q run hung on a read nothing timed out).
 */

const URL = "postgresql://test:synthetic-test-value@localhost/test";
const POOLER_URL =
  "postgresql://postgres.tenant:synthetic-test-value@pooler.example.test:6543/postgres";

function config(overrides: Record<string, string> = {}) {
  return parseDatabaseConfig({
    NODE_ENV: "test",
    CAPITAL_Q_ENV: "local",
    DATABASE_URL: URL,
    ...overrides,
  });
}

const transactionPooler = () =>
  config({
    DATABASE_URL: POOLER_URL,
    DATABASE_CONNECTION_MODE: "transaction_pooler",
  });

describe("driver options per connection mode", () => {
  it("pipelines one query at a time behind the transaction pooler", () => {
    expect(
      resolvePostgresOptions(transactionPooler(), "REQUEST").max_pipeline,
    ).toBe(1);
  });

  it("keeps the driver's pipelining for direct and session_pooler", () => {
    expect(resolvePostgresOptions(config(), "REQUEST")).not.toHaveProperty(
      "max_pipeline",
    );
    expect(
      resolvePostgresOptions(
        config({ DATABASE_CONNECTION_MODE: "session_pooler" }),
        "REQUEST",
      ),
    ).not.toHaveProperty("max_pipeline");
  });

  it("sends a lock timeout at connect, except for migrations", () => {
    expect(
      resolvePostgresOptions(config(), "REQUEST").connection.lock_timeout,
    ).toBe(5_000);
    expect(
      resolvePostgresOptions(config(), "MIGRATION").connection,
    ).not.toHaveProperty("lock_timeout");
  });

  it("bounds a lock wait below its statement", () => {
    expect(lockTimeoutFor(10_000)).toBe(5_000);
    expect(lockTimeoutFor(120_000)).toBe(30_000);
    expect(lockTimeoutFor(2_000)).toBe(2_000);
  });
});

describe("where each limit is applied", () => {
  it("direct: the server has the startup parameters; the client deadline still holds", () => {
    expect(resolveSqlTimeouts(config(), "REQUEST")).toEqual({
      statementTimeoutMs: 10_000,
      lockTimeoutMs: 5_000,
      queryDeadlineMs: 10_000 + QUERY_DEADLINE_GRACE_MS,
      setLocal: false,
    });
    expect(transactionLimitsFor(config(), "REQUEST")).toBeUndefined();
  });

  it("behind either pooler: SET LOCAL per transaction, for request and privileged", () => {
    for (const mode of ["session_pooler", "transaction_pooler"] as const) {
      const pooled =
        mode === "transaction_pooler"
          ? transactionPooler()
          : config({ DATABASE_CONNECTION_MODE: mode });
      expect(transactionLimitsFor(pooled, "REQUEST")).toEqual({
        statementTimeoutMs: 10_000,
        lockTimeoutMs: 5_000,
      });
      expect(transactionLimitsFor(pooled, "PRIVILEGED_SERVICE")).toEqual({
        statementTimeoutMs: 10_000,
        lockTimeoutMs: 5_000,
      });
      expect(transactionLimitsFor(pooled, "MIGRATION")).toBeUndefined();
    }
  });

  it("migrations keep no client deadline", () => {
    expect(resolveSqlTimeouts(config(), "MIGRATION").queryDeadlineMs).toBe(
      undefined,
    );
  });

  it("a worker's own budget flows through", () => {
    const worker = parseDatabaseConfig(
      {
        NODE_ENV: "test",
        DATABASE_URL: POOLER_URL,
        DATABASE_CONNECTION_MODE: "session_pooler",
      },
      { statementTimeoutMs: 120_000 },
    );
    expect(transactionLimitsFor(worker, "REQUEST")).toEqual({
      statementTimeoutMs: 120_000,
      lockTimeoutMs: 30_000,
    });
    expect(resolveSqlTimeouts(worker, "REQUEST").queryDeadlineMs).toBe(122_000);
  });
});

/**
 * A stand-in for a postgres.js Query: a Promise subclass whose `handle`
 * hands it to the driver (here: nothing, or an answer after `answerMs`),
 * with the driver's own reject and cancel.
 */
class FakeQuery extends Promise<unknown> {
  executed = false;
  cancelled = 0;
  answerMs: number | null = null;
  settle!: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  static override get [Symbol.species]() {
    return Promise;
  }
  constructor() {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    super((a, b) => {
      resolve = a;
      reject = b;
    });
    this.settle = { resolve, reject };
  }
  reject(error: unknown): void {
    this.settle.reject(error);
  }
  cancel(): Promise<void> {
    this.cancelled += 1;
    return Promise.resolve();
  }
  handle(): void {
    if (this.executed) return;
    this.executed = true;
    if (this.answerMs !== null) {
      setTimeout(() => {
        this.settle.resolve([{ ok: 1 }]);
      }, this.answerMs);
    }
  }
  override then<A = unknown, B = never>(
    onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.handle();
    return super.then(onFulfilled, onRejected);
  }
}

function fakeClient(answerMs: number | null) {
  const sent: FakeQuery[] = [];
  const client = () => {
    const query = new FakeQuery();
    query.answerMs = answerMs;
    sent.push(query);
    return query;
  };
  return { client, sent };
}

describe("the client deadline on every query (fake clock)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a query nothing answers is cancelled and rejects as a TIMEOUT at its deadline", async () => {
    const { client, sent } = fakeClient(null);
    const sql = instrumentSql(client, { queryDeadlineMs: 12_000 });
    const outcome = (sql() as Promise<unknown>).then(
      () => "answered",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(11_999);
    expect(sent[0]?.cancelled).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(QueryDeadlineError);
    expect(sent[0]?.cancelled).toBe(1);
    expect(toDatabaseError(error).kind).toBe("TIMEOUT");
    // Never the statement's text.
    expect(String((error as Error).message)).not.toMatch(/select/i);
  });

  it("an answer inside the deadline is untouched and leaves no timer", async () => {
    const { client, sent } = fakeClient(300);
    const sql = instrumentSql(client, { queryDeadlineMs: 12_000 });
    // Awaiting hands the query to the driver, as a caller does.
    const answered = (sql() as Promise<unknown>).then((rows) => rows);
    await vi.advanceTimersByTimeAsync(300);
    await expect(answered).resolves.toEqual([{ ok: 1 }]);
    expect(vi.getTimerCount()).toBe(0);
    expect(sent[0]?.cancelled).toBe(0);
  });

  it("a query built but never sent (a fragment) arms nothing", () => {
    const { client } = fakeClient(null);
    const sql = instrumentSql(client, { queryDeadlineMs: 12_000 });
    // Built and dropped, never awaited: the driver never sees it.
    void sql();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("no deadline configured: nothing is armed", async () => {
    const { client } = fakeClient(null);
    const sql = instrumentSql(client);
    void (sql() as Promise<unknown>).then(
      () => undefined,
      () => undefined,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("SET LOCAL at the start of each transaction", () => {
  type Sent = { text: string; values: unknown[] };

  function fakeTransactionSql(fail = false) {
    const sent: Sent[] = [];
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
      sent.push({ text: strings.join("?"), values });
      return fail
        ? Promise.reject(Object.assign(new Error("x"), { code: "25P02" }))
        : Promise.resolve([]);
    };
    const sql = {
      begin: async (work: (inner: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as Sql;
    return { sql, sent };
  }

  it("is sent first, before the work's own statements, with both limits", async () => {
    const { sql, sent } = fakeTransactionSql();
    const value = await createTransactionManager(sql, {
      limits: { statementTimeoutMs: 10_000, lockTimeoutMs: 5_000 },
    }).run(async (context) => {
      await context.sql`select 1`;
      return "done";
    });
    expect(value).toBe("done");
    expect(sent[0]?.text).toMatch(/set_config\('statement_timeout'/);
    expect(sent[0]?.text).toMatch(/set_config\('lock_timeout'/);
    expect(sent[0]?.values).toEqual(["10000", "5000"]);
    expect(sent[1]?.text).toBe("select 1");
  });

  it("is not sent without limits (direct connections)", async () => {
    const { sql, sent } = fakeTransactionSql();
    await createTransactionManager(sql).run(async (context) => {
      await context.sql`select 1`;
    });
    expect(sent.map((s) => s.text)).toEqual(["select 1"]);
  });

  it("its failure fails the unit", async () => {
    const { sql } = fakeTransactionSql(true);
    await expect(
      createTransactionManager(sql, {
        limits: { statementTimeoutMs: 10_000, lockTimeoutMs: 5_000 },
      }).run(() => Promise.resolve("never kept")),
    ).rejects.toMatchObject({ kind: "UNEXPECTED", sqlState: "25P02" });
  });
});
