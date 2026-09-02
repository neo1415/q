import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";

import { createRequestDatabaseClient } from "../src/client.js";
import { DatabaseError } from "../src/errors.js";
import { checkDatabaseHealth } from "../src/health.js";
import type { RequestDatabase } from "../src/types.js";

/**
 * Real PostgreSQL, no mocks. Requires the local Supabase stack
 * (`pnpm db:start`). Run with `pnpm test:integration`.
 *
 * The default target is the Supabase CLI's documented local database on
 * 127.0.0.1:54322 with its fixed local password -- a machine-local development
 * credential, not a secret for anything reachable from outside this host.
 * Override with CQ_TEST_DATABASE_URL to point at another *disposable* local
 * database. Hosted project URLs are never used here.
 */
const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const STATEMENT_TIMEOUT_MS = 2000;

/** Unique per test so a failed run cannot collide with the next. */
function scratchTable(): string {
  return `cq_data_001_${randomUUID().replaceAll("-", "")}`;
}

describe("@capital-q/database against local Supabase Postgres", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "3",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
        DATABASE_STATEMENT_TIMEOUT_MS: String(STATEMENT_TIMEOUT_MS),
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("connects and answers select 1", async () => {
    const rows = await db.sql<{ one: number }[]>`select 1 as one`;
    expect(rows).toEqual([{ one: 1 }]);
  });

  it("reports reachable via the health helper", async () => {
    await expect(checkDatabaseHealth(db.sql)).resolves.toEqual({
      reachable: true,
    });
  });

  it("applies the configured statement timeout on every connection", async () => {
    // pg_settings.setting is the raw value in the GUC's base unit (ms), so
    // the assertion does not depend on Postgres' pretty-printing.
    const [row] = await db.sql<
      { setting: string; application_name: string }[]
    >`select s.setting, a.application_name
        from pg_settings s, pg_stat_activity a
       where s.name = 'statement_timeout' and a.pid = pg_backend_pid()`;
    expect(row?.setting).toBe(String(STATEMENT_TIMEOUT_MS));
    expect(row?.application_name).toBe("capital-q:request");
  });

  it("classifies a statement that exceeds the timeout as TIMEOUT", async () => {
    let caught: unknown;
    try {
      await db.transactions.run(async (tx) => {
        await tx.sql`select pg_sleep(${(STATEMENT_TIMEOUT_MS + 500) / 1000})`;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).kind).toBe("TIMEOUT");
    expect((caught as DatabaseError).sqlState).toBe("57014");
  });

  it("commits a transaction that returns normally", async () => {
    const table = scratchTable();
    await db.sql`create table ${db.sql(table)} (id int primary key, note text)`;

    try {
      const result = await db.transactions.run(async (tx) => {
        await tx.sql`insert into ${tx.sql(table)} (id, note) values (1, 'committed')`;
        return "done" as const;
      });
      expect(result).toBe("done");

      const rows = await db.sql<
        { id: number; note: string }[]
      >`select id, note from ${db.sql(table)}`;
      expect(rows).toEqual([{ id: 1, note: "committed" }]);
    } finally {
      await db.sql`drop table if exists ${db.sql(table)}`;
    }
  });

  it("rolls back a transaction whose callback throws, preserving the cause", async () => {
    const table = scratchTable();
    await db.sql`create table ${db.sql(table)} (id int primary key)`;

    class UseCaseFailure extends Error {}

    try {
      let caught: unknown;
      try {
        await db.transactions.run(async (tx) => {
          await tx.sql`insert into ${tx.sql(table)} (id) values (1)`;
          throw new UseCaseFailure("business rule violated after write");
        });
      } catch (error) {
        caught = error;
      }

      // The application's own error comes back as itself, not wrapped.
      expect(caught).toBeInstanceOf(UseCaseFailure);

      const rows = await db.sql`select id from ${db.sql(table)}`;
      expect(rows).toHaveLength(0);
    } finally {
      await db.sql`drop table if exists ${db.sql(table)}`;
    }
  });

  it("rolls back a transaction that fails on a constraint and classifies it", async () => {
    const table = scratchTable();
    await db.sql`create table ${db.sql(table)} (id int primary key)`;

    try {
      let caught: unknown;
      try {
        await db.transactions.run(async (tx) => {
          await tx.sql`insert into ${tx.sql(table)} (id) values (1)`;
          await tx.sql`insert into ${tx.sql(table)} (id) values (1)`;
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(DatabaseError);
      expect((caught as DatabaseError).kind).toBe("CONSTRAINT");
      expect((caught as DatabaseError).sqlState).toBe("23505");
      expect((caught as DatabaseError).constraintName).toBe(`${table}_pkey`);

      const rows = await db.sql`select id from ${db.sql(table)}`;
      expect(rows).toHaveLength(0);
    } finally {
      await db.sql`drop table if exists ${db.sql(table)}`;
    }
  });

  it("runs every operation in one transaction on the same connection", async () => {
    const [outside] = await db.sql<
      { pid: number }[]
    >`select pg_backend_pid() as pid`;

    const pids = await db.transactions.run(async (tx) => {
      const [a] = await tx.sql<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      const [b] = await tx.sql<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      const [inTx] = await tx.sql<
        { xid: string | null }[]
      >`select txid_current_if_assigned()::text as xid`;
      // A write assigns a transaction id that both later statements share.
      await tx.sql`create temporary table cq_same_tx (id int) on commit drop`;
      const [afterWrite] = await tx.sql<
        { xid: string | null }[]
      >`select txid_current_if_assigned()::text as xid`;
      const [again] = await tx.sql<
        { xid: string | null }[]
      >`select txid_current_if_assigned()::text as xid`;
      return { a: a?.pid, b: b?.pid, before: inTx?.xid, afterWrite, again };
    });

    expect(pids.a).toBeDefined();
    expect(pids.a).toBe(pids.b);
    expect(pids.before).toBeNull();
    expect(pids.afterWrite?.xid).not.toBeNull();
    expect(pids.afterWrite?.xid).toBe(pids.again?.xid);
    // The pool may hand the transaction any connection; what matters is that
    // both statements inside shared one. `outside` just proves the query works.
    expect(outside?.pid).toBeDefined();
  });

  it("binds interpolated values as parameters, never as SQL text", async () => {
    const table = scratchTable();
    await db.sql`create table ${db.sql(table)} (id int primary key, name text not null)`;

    try {
      const hostile = `'; drop table ${table}; --`;
      await db.sql`insert into ${db.sql(table)} (id, name) values (${1}, ${hostile})`;

      const rows = await db.sql<
        { name: string }[]
      >`select name from ${db.sql(table)} where name = ${hostile}`;
      expect(rows).toEqual([{ name: hostile }]);

      // The table is still there and still has exactly the row we wrote.
      const [count] = await db.sql<
        { n: number }[]
      >`select count(*)::int as n from ${db.sql(table)}`;
      expect(count?.n).toBe(1);
    } finally {
      await db.sql`drop table if exists ${db.sql(table)}`;
    }
  });

  it("closes cleanly and refuses further queries afterwards", async () => {
    const throwaway = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "1",
      }),
    );

    await throwaway.sql`select 1`;
    await throwaway.close();

    await expect(throwaway.sql`select 1`).rejects.toThrow();
  });
});
