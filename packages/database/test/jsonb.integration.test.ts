import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";

import { createRequestDatabaseClient } from "../src/client.js";
import { decodeJsonbString, jsonbParam } from "../src/jsonb.js";
import type { RequestDatabase } from "../src/types.js";

/**
 * Regression (2026-10-01): `${JSON.stringify(value)}::jsonb` stores a JSON
 * string, because postgres.js serialises the json-cast parameter again.
 * jsonbParam must store the object or array itself.
 */
const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("jsonb parameters against local Supabase Postgres", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
        DATABASE_STATEMENT_TIMEOUT_MS: "2000",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("stores an array as an array and an object as an object", async () => {
    const rows = await db.sql<{ a: string; o: string; n: string }[]>`
      select jsonb_typeof(${jsonbParam(db.sql, [{ text: "hi" }])}::jsonb) as a,
             jsonb_typeof(${jsonbParam(db.sql, { kind: "TEXT", text: "x" })}::jsonb) as o,
             jsonb_typeof(coalesce(${null}::jsonb, '[]'::jsonb)) as n`;
    expect(rows[0]).toEqual({ a: "array", o: "object", n: "array" });
  });

  it("shows the double-encoding it prevents", async () => {
    const rows = await db.sql<{ t: string }[]>`
      select jsonb_typeof(${JSON.stringify([1])}::jsonb) as t`;
    expect(rows[0]?.t).toBe("string");
  });

  it("decodes a double-encoded value read back from an older row", () => {
    expect(decodeJsonbString('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(decodeJsonbString({ a: 1 })).toEqual({ a: 1 });
    expect(decodeJsonbString("not json")).toBe("not json");
  });
});
