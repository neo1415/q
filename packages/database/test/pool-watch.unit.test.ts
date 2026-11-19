import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toDatabaseError } from "../src/errors.js";
import {
  databasePoolExhaustionsObserved,
  watchConnectionPool,
} from "../src/pool-watch.js";
import {
  connectionPoolOf,
  ConnectionPoolRecycledError,
  instrumentSql,
  QueryDeadlineError,
} from "../src/round-trips.js";
import { createTransactionManager } from "../src/transaction.js";

/**
 * Incident 19 Nov 2026: q-api's pool behind the transaction pooler wedged
 * and every statement failed as 57014 until a manual restart. These fakes
 * model postgres.js closely enough to show where slots went: a query's own
 * `resolve`/`reject` are what the driver calls when its connection is done
 * with it; `cancel` of a query the driver never saw rejects it at once
 * (index.js "canceling statement due to user request"); `end({ timeout: 0 })`
 * destroys every connection, rejecting whatever is still on one.
 */

type Behaviour = {
  /** Answer after this long; null: the pooler never answers. */
  answerMs: number | null;
  /** A cancel of a running statement is answered after this long; null: never. */
  cancelAnswersMs: number | null;
};

class DriverQuery extends Promise<unknown> {
  executed = false;
  /** The driver finished with it (the connection is free again). */
  done = false;
  cancelled = 0;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  readonly behaviour: Behaviour;
  static override get [Symbol.species]() {
    return Promise;
  }
  constructor(behaviour: Behaviour) {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    super((a, b) => {
      resolve = a;
      reject = b;
    });
    this.behaviour = behaviour;
    this.resolve = resolve;
    this.reject = reject;
  }
  /** The driver itself settles it: the connection is done with it. */
  answer(value: unknown): void {
    if (this.done) return;
    this.done = true;
    this.resolve(value);
  }
  fail(error: Error): void {
    if (this.done) return;
    this.done = true;
    this.reject(error);
  }
  cancel(): Promise<void> {
    this.cancelled += 1;
    if (!this.executed) {
      // Never written to a connection: dropped and rejected at once.
      this.fail(
        Object.assign(new Error("canceling statement due to user request"), {
          code: "57014",
        }),
      );
      return Promise.resolve();
    }
    const after = this.behaviour.cancelAnswersMs;
    if (after !== null) {
      setTimeout(() => {
        this.fail(Object.assign(new Error("cancelled"), { code: "57014" }));
      }, after);
    }
    return Promise.resolve();
  }
  handle(): void {
    if (this.executed) return;
    this.executed = true;
    const after = this.behaviour.answerMs;
    if (after !== null) {
      setTimeout(() => {
        this.answer([{ ok: 1 }]);
      }, after);
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

type Tx = (strings: TemplateStringsArray) => Promise<unknown>;

/**
 * A fake postgres.js driver: statements, transactions (BEGIN ... COMMIT or
 * ROLLBACK, ended early when the driver is destroyed, as postgres.js races
 * a transaction against its connection closing) and end().
 */
function fakeDriver(behaviour: Behaviour) {
  const sent: DriverQuery[] = [];
  const statements: string[] = [];
  const destroyers = new Set<(error: unknown) => void>();
  let ended = false;
  const destroyed = () =>
    Object.assign(new Error("write CONNECTION_DESTROYED"), {
      code: "CONNECTION_DESTROYED",
    });
  const client = (strings?: TemplateStringsArray) => {
    const query = new DriverQuery(behaviour);
    if (ended) {
      query.fail(
        Object.assign(new Error("CONNECTION_ENDED"), {
          code: "CONNECTION_ENDED",
        }),
      );
    }
    statements.push(strings?.join("?") ?? "");
    sent.push(query);
    return query;
  };
  const begin = async (work: (tx: Tx) => Promise<unknown>) => {
    if (ended) throw destroyed();
    statements.push("begin");
    const tx: Tx = (strings) => {
      statements.push(strings.join("?"));
      return Promise.resolve([]);
    };
    let destroy!: (error: unknown) => void;
    const closed = new Promise<never>((_, reject) => {
      destroy = reject;
    });
    destroyers.add(destroy);
    try {
      return await Promise.race([
        (async () => {
          try {
            const value = await work(tx);
            statements.push("commit");
            return value;
          } catch (error) {
            statements.push("rollback");
            throw error;
          }
        })(),
        closed,
      ]);
    } finally {
      destroyers.delete(destroy);
    }
  };
  const end = (_options?: { timeout?: number }) => {
    ended = true;
    for (const query of sent) {
      if (query.executed) query.fail(destroyed());
    }
    for (const destroy of destroyers) destroy(destroyed());
    return Promise.resolve();
  };
  return Object.assign(client, {
    begin,
    end,
    sent,
    statements,
    isEnded: () => ended,
  });
}

type FakeDriver = ReturnType<typeof fakeDriver>;

function pooled(
  behaviour: Behaviour,
  options: { slots: number; deadlineMs?: number; reopen?: boolean },
) {
  const first = fakeDriver(behaviour);
  const drivers: FakeDriver[] = [first];
  const sql = instrumentSql(first, {
    queryDeadlineMs: options.deadlineMs ?? 12_000,
    connectionSlots: options.slots,
    reopen:
      options.reopen === false
        ? undefined
        : () => {
            const next = fakeDriver({ answerMs: 10, cancelAnswersMs: 10 });
            drivers.push(next);
            return next;
          },
  });
  const pool = connectionPoolOf(sql);
  if (pool === undefined) throw new Error("expected a gated pool");
  return { sql, pool, drivers };
}

/** Statements the driver holds on a connection right now. */
const onConnections = (driver: FakeDriver) =>
  driver.sent.filter((query) => query.executed && !query.done).length;

const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "answered",
    (error: unknown) => error,
  );

function logger() {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  return {
    lines,
    logger: {
      error: (fields: Record<string, unknown>, message: string) => {
        lines.push({ fields, message });
      },
    },
  };
}

describe("a slot follows its connection, not its caller (incident 19 Nov 2026)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a statement past its deadline keeps its slot until the driver is done with the connection", async () => {
    // The server is slow; the cancel lands half a second after the deadline.
    const { sql, pool, drivers } = pooled(
      { answerMs: null, cancelAnswersMs: 500 },
      { slots: 1 },
    );
    const driver = drivers[0] as FakeDriver;
    const slow = outcome(sql());
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await slow).toBeInstanceOf(QueryDeadlineError);
    expect(driver.sent[0]?.cancelled).toBe(1);
    // The caller has its answer; the connection is still busy.
    expect(onConnections(driver)).toBe(1);
    expect(pool.inspect().held).toBe(1);
    // Before 19 Nov the slot was freed here and the next statement was
    // written behind the running one: the write Supavisor never answers.
    const next = outcome(sql());
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.sent[1]?.executed).toBe(false);
    expect(onConnections(driver)).toBe(1);
    // The cancel is answered: the connection is free, and only now is the
    // next statement handed over.
    await vi.advanceTimersByTimeAsync(500);
    expect(driver.sent[1]?.executed).toBe(true);
    expect(onConnections(driver)).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await next).toBeInstanceOf(QueryDeadlineError);
  });

  it("the incident: wedged connections are never written behind; once the pool is full, statements fail without reaching the driver", async () => {
    // Neither the statements nor their cancels are ever answered.
    const { sql, pool, drivers } = pooled(
      { answerMs: null, cancelAnswersMs: null },
      { slots: 2 },
    );
    const driver = drivers[0] as FakeDriver;
    const first = [outcome(sql()), outcome(sql())];
    await vi.advanceTimersByTimeAsync(12_000);
    for (const result of await Promise.all(first)) {
      expect(result).toBeInstanceOf(QueryDeadlineError);
    }
    expect(pool.inspect()).toMatchObject({ slots: 2, held: 2 });
    const later = [outcome(sql()), outcome(sql()), outcome(sql())];
    await vi.advanceTimersByTimeAsync(12_000);
    for (const result of await Promise.all(later)) {
      expect(toDatabaseError(result).kind).toBe("TIMEOUT");
    }
    // Never more statements on connections than there are connections.
    expect(driver.sent.slice(2).every((query) => !query.executed)).toBe(true);
    expect(onConnections(driver)).toBe(2);
  });

  it("an aborted speculative call inside a transaction gives its slot back", async () => {
    const { sql, pool } = pooled(
      { answerMs: 10, cancelAnswersMs: 10 },
      { slots: 1 },
    );
    const transactions = createTransactionManager(sql as never);
    const controller = new AbortController();
    const speculative = (signal: AbortSignal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    const unit = outcome(
      transactions.run(async (tx) => {
        await tx.sql`select 1`;
        return speculative(controller.signal);
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(pool.inspect()).toMatchObject({ held: 1 });
    controller.abort();
    const error = await unit;
    expect((error as Error).name).toBe("AbortError");
    expect(pool.inspect()).toMatchObject({ held: 0, waiting: 0 });
  });

  it("a provider call rejecting mid-transaction rolls back and gives the slot back", async () => {
    const { sql, pool, drivers } = pooled(
      { answerMs: 10, cancelAnswersMs: 10 },
      { slots: 2 },
    );
    const transactions = createTransactionManager(sql as never);
    const providerFailure = Object.assign(new Error("provider failed"), {
      code: "provider_unavailable",
    });
    const units = [1, 2, 3].map(() =>
      outcome(
        transactions.run(async (tx) => {
          await tx.sql`insert into t values (1)`;
          await Promise.reject(providerFailure);
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    for (const result of await Promise.all(units)) {
      expect(result).toBe(providerFailure);
    }
    expect(
      (drivers[0] as FakeDriver).statements.filter((s) => s === "rollback"),
    ).toHaveLength(3);
    expect(pool.inspect()).toMatchObject({ held: 0, waiting: 0 });
    // The pool still serves.
    const next = outcome(sql());
    await vi.advanceTimersByTimeAsync(10);
    expect(await next).toBe("answered");
  });

  it("a gate-waiting statement cancelled by its deadline is never handed over and holds nothing", async () => {
    const { sql, pool, drivers } = pooled(
      { answerMs: null, cancelAnswersMs: null },
      { slots: 1 },
    );
    void outcome(sql());
    await vi.advanceTimersByTimeAsync(0);
    const waiting = outcome(sql());
    await vi.advanceTimersByTimeAsync(12_000);
    // The driver's own cancel of a query it never saw (the error q-api
    // logged for 72 minutes).
    const error = await waiting;
    expect((error as Error).message).toMatch(/canceling statement/);
    expect((drivers[0] as FakeDriver).sent[1]?.executed).toBe(false);
    expect(pool.inspect()).toMatchObject({ held: 1, waiting: 0 });
  });
});

describe("watchConnectionPool (fake clock)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recycles a wedged pool with one alert line; holders and waiters fail as CONNECTION; permits return to full", async () => {
    const { sql, pool, drivers } = pooled(
      { answerMs: null, cancelAnswersMs: null },
      { slots: 2 },
    );
    const { lines, logger: log } = logger();
    const before = databasePoolExhaustionsObserved();
    const watch = watchConnectionPool({ sql, logger: log, intervalMs: 5_000 });
    // One transaction waits forever on something outside the database (a
    // model call that never settles); one statement is wedged.
    const transactions = createTransactionManager(sql as never);
    const stuck = outcome(
      transactions.run(async () => {
        await new Promise(() => undefined);
      }),
    );
    const wedged = outcome(sql());
    await vi.advanceTimersByTimeAsync(0);
    const waiting = outcome(sql());
    expect(pool.inspect()).toMatchObject({ held: 2, waiting: 1 });
    // Default limit: twice the 12 s deadline. Nothing before it.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toMatchObject({
      alert: "DB_POOL_EXHAUSTED",
      slots: 2,
      held: 2,
      recycled: true,
      heldByKind: { statement: 1, transaction: 1, reserved: 0, notify: 0 },
    });
    expect(JSON.stringify(lines[0])).not.toMatch(/select|insert/i);
    expect(databasePoolExhaustionsObserved()).toBe(before + 1);
    // The holder unwound with the driver's connection failure, not a hang.
    expect(((await stuck) as { cause?: { code?: unknown } }).cause?.code).toBe(
      "CONNECTION_DESTROYED",
    );
    expect(await wedged).toBeInstanceOf(QueryDeadlineError);
    expect((drivers[0] as FakeDriver).isEnded()).toBe(true);
    expect(onConnections(drivers[0] as FakeDriver)).toBe(0);
    // The statement that waited fails (deadline or recycle), never hangs.
    expect(toDatabaseError(await waiting).kind).toMatch(/TIMEOUT|CONNECTION/);
    expect(pool.inspect()).toMatchObject({ held: 0, waiting: 0, recycles: 1 });
    // The fresh pool serves at once.
    const after = outcome(sql());
    await vi.advanceTimersByTimeAsync(10);
    expect(await after).toBe("answered");
    expect(pool.inspect()).toMatchObject({ held: 0 });
    watch.stop();
  });

  it("a waiter failed by a recycle gets a CONNECTION error", async () => {
    const { sql, pool } = pooled(
      { answerMs: null, cancelAnswersMs: null },
      { slots: 1, deadlineMs: 60_000 },
    );
    void outcome(sql());
    await vi.advanceTimersByTimeAsync(0);
    const transactions = createTransactionManager(sql as never);
    const waitingTx = outcome(transactions.run(() => Promise.resolve(1)));
    const waitingStatement = outcome(sql());
    await vi.advanceTimersByTimeAsync(0);
    expect(pool.inspect().waiting).toBe(2);
    expect(pool.recycle()).toBe(true);
    const txError = await waitingTx;
    expect(toDatabaseError(txError).kind).toBe("CONNECTION");
    const statementError = await waitingStatement;
    expect(statementError).toBeInstanceOf(ConnectionPoolRecycledError);
    expect(toDatabaseError(statementError).kind).toBe("CONNECTION");
  });

  it("leaves a busy pool alone while slots keep turning over", async () => {
    const { sql, pool } = pooled(
      { answerMs: 1_000, cancelAnswersMs: 10 },
      { slots: 2 },
    );
    const { lines, logger: log } = logger();
    const watch = watchConnectionPool({
      sql,
      logger: log,
      intervalMs: 1_000,
      stuckAfterMs: 30_000,
    });
    // Saturated for two minutes, every statement answered in a second.
    for (let second = 0; second < 120; second += 1) {
      void outcome(sql());
      void outcome(sql());
      void outcome(sql());
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(lines).toEqual([]);
    expect(pool.inspect().recycles).toBe(0);
    watch.stop();
  });

  it("without a way to reopen, it still alerts (recycled: false)", async () => {
    const { sql } = pooled(
      { answerMs: null, cancelAnswersMs: null },
      { slots: 1, reopen: false },
    );
    const { lines, logger: log } = logger();
    const events: boolean[] = [];
    const watch = watchConnectionPool({
      sql,
      logger: log,
      intervalMs: 1_000,
      stuckAfterMs: 30_000,
      onExhausted: ({ recycled }) => events.push(recycled),
    });
    void outcome(sql());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines.map((line) => line.fields["recycled"])).toEqual([false]);
    expect(events).toEqual([false]);
    watch.stop();
  });

  it("an ungated client has nothing to watch", () => {
    const { lines, logger: log } = logger();
    const plain = instrumentSql(
      fakeDriver({ answerMs: 1, cancelAnswersMs: 1 }),
    );
    const watch = watchConnectionPool({ sql: plain, logger: log });
    expect(watch.check()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(lines).toEqual([]);
  });
});
