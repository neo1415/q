import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";

import {
  cachedInRun,
  createRequestDatabaseClient,
  createRoundTripCounter,
  withRoundTripCounter,
  type RequestDatabase,
} from "../src/index.js";

/**
 * R5: the per-run counter counts what is sent, where it is sent, and the
 * run read cache serves a repeated read once until this run writes to
 * what it read. Real local PostgreSQL; temporary table only.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("round trips and the run read cache, against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        // One connection: queries queue, which is where the old debug-hook
        // count went to the wrong context.
        DATABASE_POOL_MAX: "1",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });
  afterAll(async () => {
    await db.close();
  });

  it("counts each query sent once, fragments never, and BEGIN/COMMIT", async () => {
    const counter = createRoundTripCounter("run-a");
    await withRoundTripCounter(counter, async () => {
      const fragment = db.sql`select 1 as one`;
      await db.sql`select * from (${fragment}) f`;
      await db.transactions.run(async ({ sql }) => {
        await sql`select 2`;
      });
    });
    // 1 select + (BEGIN, select, COMMIT)
    expect(counter.count).toBe(4);
  });

  it("counts concurrent queries to their own run, not the socket's", async () => {
    const a = createRoundTripCounter("run-a");
    const b = createRoundTripCounter("run-b");
    await Promise.all([
      withRoundTripCounter(a, () =>
        Promise.all([1, 2, 3].map((n) => db.sql`select ${n}::int`)),
      ),
      withRoundTripCounter(b, () =>
        Promise.all([1, 2].map((n) => db.sql`select ${n}::int`)),
      ),
      // Outside any run: counted nowhere.
      db.sql`select 9`,
    ]);
    expect(a.count).toBe(3);
    expect(b.count).toBe(2);
  });

  it("serves a repeated read once, and a write by the run drops it", async () => {
    const counter = createRoundTripCounter("run-c");
    let loads = 0;
    const key = {
      aggregate: "probe",
      tables: ["pg_temp.r5_probe"],
      actor: "user-1",
      fingerprint: "all",
    };
    const read = () =>
      cachedInRun(key, async () => {
        loads += 1;
        return db.sql`select 1`;
      });
    await withRoundTripCounter(counter, async () => {
      await read();
      await read();
      expect(loads).toBe(1);
      // Another actor never shares the entry.
      await cachedInRun({ ...key, actor: "user-2" }, async () => {
        loads += 1;
        return db.sql`select 1`;
      });
      expect(loads).toBe(2);
      // A read of something else is unaffected by an unrelated write...
      await db.sql`select 1 where false and exists (select 1) /* insert into other.table */`;
      await read();
      expect(loads).toBe(2);
      // ...and a write to the table it read drops it.
      await db.transactions.run(async ({ sql }) => {
        await sql`create temporary table if not exists r5_probe (n int) on commit drop`;
        await sql`insert into pg_temp.r5_probe values (1)`;
      });
      await read();
      expect(loads).toBe(3);
    });
    // Outside a run there is no cache.
    await read();
    await read();
    expect(loads).toBe(5);
  });
});
