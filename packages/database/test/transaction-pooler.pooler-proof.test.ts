import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

import { parseDatabaseConfig } from "@capital-q/config/database";

import { createRequestDatabaseClient } from "../src/client.js";
import { DatabaseError } from "../src/errors.js";
import type { RequestDatabase } from "../src/types.js";

/**
 * The transaction-pooler proof (scripts/db/pooler-proof/run.sh): the
 * request client exactly as q-api builds it with
 * DATABASE_CONNECTION_MODE=transaction_pooler, against Supavisor in
 * transaction mode on a small pool (POOLER_PROOF_POOL_SIZE server
 * connections), with two session clients holding LISTEN. Never part of
 * `pnpm test` or `pnpm test:integration`.
 */

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set: run scripts/db/pooler-proof/run.sh`);
  }
  return value;
}

const POOLER_URL = env("POOLER_PROOF_POOLER_URL");
const LISTEN_URL = env("POOLER_PROOF_LISTEN_URL");
const DIRECT_URL = env("POOLER_PROOF_DIRECT_URL");
const STATEMENT_TIMEOUT_MS = 3_000;
const DEADLINE_MS = STATEMENT_TIMEOUT_MS + 2_000;

function poolerClient(poolMax: number): RequestDatabase {
  return createRequestDatabaseClient(
    parseDatabaseConfig({
      NODE_ENV: "test",
      CAPITAL_Q_ENV: "local",
      DATABASE_URL: POOLER_URL,
      DATABASE_LISTEN_URL: LISTEN_URL,
      DATABASE_CONNECTION_MODE: "transaction_pooler",
      DATABASE_POOL_MAX: String(poolMax),
      DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      DATABASE_WARM_INTERVAL_SECONDS: "0",
      DATABASE_STATEMENT_TIMEOUT_MS: String(STATEMENT_TIMEOUT_MS),
    }),
  );
}

async function settle<T>(work: Promise<T>): Promise<{
  readonly value?: T;
  readonly error?: unknown;
  readonly ms: number;
}> {
  const started = performance.now();
  try {
    const value = await work;
    return { value, ms: performance.now() - started };
  } catch (error) {
    return { error, ms: performance.now() - started };
  }
}

function sqlState(error: unknown): string | undefined {
  if (error instanceof DatabaseError) return error.sqlState;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code: unknown = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

describe("transaction pooler: the request client through Supavisor (transaction mode)", () => {
  let db: RequestDatabase;
  let direct: Sql;
  const sessionHolders: { unlisten: () => Promise<void> }[] = [];
  const heard: string[] = [];

  beforeAll(async () => {
    // The production trial's client pool (10) against a pool of 4 server
    // connections: the pooler, not the client, is the bottleneck.
    db = poolerClient(10);
    direct = postgres(DIRECT_URL, { max: 2, prepare: false });
    // Two session-holding clients: q-api's LISTEN connection and a second
    // one (another replica), both on Supavisor's session port.
    sessionHolders.push(
      await db.listen("pooler_proof_wake", (payload) => {
        heard.push(payload);
      }),
    );
    const other = poolerClient(1);
    sessionHolders.push(
      await other.listen("pooler_proof_other", () => undefined),
    );
  });

  afterAll(async () => {
    for (const holder of sessionHolders) await holder.unlisten();
    await db.close();
    await direct.end();
  });

  it("(a) 200 concurrent queries, half of them in transactions, all finish within the deadline", async () => {
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        settle(
          index % 2 === 0
            ? db.sql<
                { n: number }[]
              >`select ${index}::int as n, pg_sleep(0.02)`.then(
                (rows) => rows[0]?.n,
              )
            : db.transactions.run(async (tx) => {
                const [row] = await tx.sql<
                  { n: number; timeout: string }[]
                >`select ${index}::int as n, current_setting('statement_timeout') as timeout, pg_sleep(0.02)`;
                return row?.timeout === "3s" ? row.n : -1;
              }),
        ),
      ),
    );
    const elapsed = performance.now() - started;
    const failures = results.filter((result) => result.error !== undefined);
    expect(failures.map((failure) => sqlState(failure.error))).toEqual([]);
    expect(results.map((result) => result.value)).toEqual(
      Array.from({ length: 200 }, (_, index) => index),
    );
    const slowest = Math.max(...results.map((result) => result.ms));
    expect(slowest).toBeLessThan(DEADLINE_MS);
    console.info(
      `pooler-proof (a): 200 queries in ${elapsed.toFixed(0)} ms, slowest ${slowest.toFixed(0)} ms`,
    );
  });

  it("(a) show statement_timeout inside a transaction reflects the set_config; outside one it is the role's own", async () => {
    const inside = await db.transactions.run(async (tx) => {
      const [timeout] = await tx.sql<
        { statement_timeout: string }[]
      >`show statement_timeout`;
      const [lock] = await tx.sql<
        { lock_timeout: string }[]
      >`show lock_timeout`;
      return {
        statement: timeout?.statement_timeout,
        lock: lock?.lock_timeout,
      };
    });
    expect(inside).toEqual({ statement: "3s", lock: "3s" });
    // Supavisor drops startup parameters: an autocommit statement carries
    // no app-set limit, only the role/database default and the client
    // deadline. Recorded, not asserted to a value the role may change.
    const [outside] = await db.sql<
      { statement_timeout: string }[]
    >`show statement_timeout`;
    console.info(
      `pooler-proof (a): statement_timeout outside a transaction = ${String(outside?.statement_timeout)}`,
    );
    // The next transaction on whatever server connection it lands on is
    // not left with a previous transaction's setting.
    const [after] = await db.sql<
      { statement_timeout: string }[]
    >`show statement_timeout`;
    expect(after?.statement_timeout).toBe(outside?.statement_timeout);
  });

  it("(b) NOTIFY sent through the transaction pooler reaches the session LISTEN", async () => {
    heard.length = 0;
    for (let index = 0; index < 5; index += 1) {
      await db.sql`select pg_notify('pooler_proof_wake', ${`wake-${String(index)}`})`;
    }
    await db.transactions.run(async (tx) => {
      await tx.sql`select pg_notify('pooler_proof_wake', 'wake-in-tx')`;
    });
    const arrived = await waitFor(
      () => Promise.resolve(heard.length >= 6),
      5_000,
    );
    expect(arrived).toBe(true);
    expect([...heard].sort()).toEqual(
      ["wake-0", "wake-1", "wake-2", "wake-3", "wake-4", "wake-in-tx"].sort(),
    );
  });

  it("(c) a slow statement in a transaction is cancelled by the server at its limit (57014)", async () => {
    const result = await settle(
      db.transactions.run(async (tx) => {
        await tx.sql`select pg_sleep(30)`;
      }),
    );
    expect(result.error).toBeInstanceOf(DatabaseError);
    expect((result.error as DatabaseError).kind).toBe("TIMEOUT");
    expect(sqlState(result.error)).toBe("57014");
    expect(result.ms).toBeGreaterThanOrEqual(STATEMENT_TIMEOUT_MS - 100);
    expect(result.ms).toBeLessThan(DEADLINE_MS);
    // The pool is usable at once.
    const [row] = await db.sql<{ one: number }[]>`select 1 as one`;
    expect(row?.one).toBe(1);
  });

  it("(c) a slow autocommit statement ends at the client deadline (57014), the server stops it, and the pool recovers", async () => {
    const marker = `pooler_proof_${String(Date.now())}`;
    const result = await settle(
      db.sql`select pg_sleep(30), ${marker}::text as marker`,
    );
    expect(sqlState(result.error)).toBe("57014");
    expect(result.ms).toBeLessThan(DEADLINE_MS + 1_000);
    // The cancel reached the backend through the pooler: the sleep is not
    // still holding a server connection.
    const stopped = await waitFor(async () => {
      const rows = await direct<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where state = 'active' and query like ${"%pg_sleep(30)%"}
          and pid <> pg_backend_pid()`;
      return rows[0]?.n === 0;
    }, 5_000);
    console.info(
      `pooler-proof (c): server-side sleep stopped after client deadline: ${String(stopped)}`,
    );
    expect(stopped).toBe(true);
    // Every client connection can still answer: one query per pool slot.
    const after = await Promise.all(
      Array.from({ length: 20 }, () =>
        settle(db.sql<{ one: number }[]>`select 1 as one`),
      ),
    );
    expect(after.filter((entry) => entry.error !== undefined)).toEqual([]);
    expect(Math.max(...after.map((entry) => entry.ms))).toBeLessThan(2_000);
  });

  it("back-to-back statements on one connection are all answered (no pipelining behind the pooler)", async () => {
    // The 17 Nov finding: with postgres.js max_pipeline 1, an autocommit
    // read and a parameterised statement written together on one
    // connection lose the second reply through Supavisor (transaction
    // mode), and the await hangs. The client must never pipeline there.
    const single = poolerClient(1);
    try {
      for (let index = 0; index < 50; index += 1) {
        const pair = await settle(
          Promise.all([
            single.sql`select id, code from ai_ops.providers order by code`,
            single.sql<{ n: number }[]>`select ${index}::int as n`,
          ]),
        );
        expect(sqlState(pair.error)).toBeUndefined();
        expect(pair.ms).toBeLessThan(2_000);
      }
    } finally {
      await single.close();
    }
    // The driver behaviour that made this necessary, recorded (not
    // asserted: a pooler release may fix it).
    // max_pipeline is a driver option its typings omit (as in
    // internal/postgres.ts, passed through a typed variable).
    const rawOptions: { prepare: boolean; max: number; max_pipeline: number } =
      { prepare: false, max: 1, max_pipeline: 1 };
    const raw = postgres(POOLER_URL, rawOptions);
    await raw`select 1`;
    let pipelined = "answered";
    for (let index = 0; index < 10 && pipelined === "answered"; index += 1) {
      pipelined = await Promise.race([
        Promise.all([
          raw`select id, code from ai_ops.providers order by code`,
          raw`select ${index}::int as n`,
        ]).then(() => "answered"),
        new Promise<string>((resolve) =>
          setTimeout(() => {
            resolve(`hung at pair ${String(index)}`);
          }, 2_000),
        ),
      ]);
    }
    console.info(
      `pooler-proof: raw postgres.js with max_pipeline 1 through the pooler: ${pipelined}`,
    );
    await raw.end({ timeout: 0 });
  });

  it("saturation: four long transactions hold every server connection; queued work waits, then finishes, nothing hangs", async () => {
    const pool = Number(process.env["POOLER_PROOF_POOL_SIZE"] ?? "4");
    const holders = Array.from({ length: pool }, () =>
      settle(
        db.transactions.run(async (tx) => {
          await tx.sql`select pg_sleep(1.5)`;
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const queued = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        settle(db.sql<{ n: number }[]>`select ${index}::int as n`),
      ),
    );
    const held = await Promise.all(holders);
    expect(held.filter((entry) => entry.error !== undefined)).toEqual([]);
    expect(queued.filter((entry) => entry.error !== undefined)).toEqual([]);
    const slowest = Math.max(...queued.map((entry) => entry.ms));
    console.info(
      `pooler-proof saturation: 40 queued queries, slowest ${slowest.toFixed(0)} ms behind ${String(pool)} held connections`,
    );
    expect(slowest).toBeLessThan(DEADLINE_MS);
  });
});
