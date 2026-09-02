import { describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";

import { createRequestDatabaseClient } from "../src/client.js";
import { DatabaseError, toDatabaseError } from "../src/errors.js";
import { checkDatabaseHealth } from "../src/health.js";
import { resolvePostgresOptions } from "../src/internal/postgres.js";
import { createMigrationDatabaseClient } from "../src/migration.js";
import { createPrivilegedDatabaseClient } from "../src/privileged.js";

// Synthetic credentials. The password is a sentinel that must never surface.
const SECRET = "super-secret-test-value";
const LOCAL_TEST_URL = `postgresql://test:${SECRET}@localhost/test`;

// 127.0.0.1:9 is the discard port: a connection attempt fails immediately
// without any database, which is what these unit tests need.
const UNREACHABLE_URL = `postgresql://test:${SECRET}@127.0.0.1:9/test`;

function config(overrides: Record<string, string> = {}) {
  return parseDatabaseConfig({
    NODE_ENV: "test",
    CAPITAL_Q_ENV: "local",
    DATABASE_URL: LOCAL_TEST_URL,
    DATABASE_CONNECT_TIMEOUT_SECONDS: "1",
    ...overrides,
  });
}

describe("driver options", () => {
  it("maps validated config onto Postgres.js options", () => {
    const options = resolvePostgresOptions(
      config({
        DATABASE_POOL_MAX: "7",
        DATABASE_IDLE_TIMEOUT_SECONDS: "30",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "4",
        DATABASE_STATEMENT_TIMEOUT_MS: "1500",
      }),
      "REQUEST",
    );

    expect(options).toEqual({
      max: 7,
      idle_timeout: 30,
      connect_timeout: 4,
      prepare: true,
      connection: {
        application_name: "capital-q:request",
        statement_timeout: 1500,
      },
    });
  });

  it("keeps prepared statements for direct and session_pooler modes", () => {
    expect(resolvePostgresOptions(config(), "REQUEST").prepare).toBe(true);
    expect(
      resolvePostgresOptions(
        config({ DATABASE_CONNECTION_MODE: "session_pooler" }),
        "REQUEST",
      ).prepare,
    ).toBe(true);
  });

  it("labels each access class in application_name", () => {
    expect(
      resolvePostgresOptions(config(), "PRIVILEGED_SERVICE").connection
        .application_name,
    ).toBe("capital-q:privileged_service");
    expect(
      resolvePostgresOptions(config(), "MIGRATION").connection.application_name,
    ).toBe("capital-q:migration");
  });

  it("disables prepared statements for transaction_pooler mode", () => {
    expect(
      resolvePostgresOptions(
        config({ DATABASE_CONNECTION_MODE: "transaction_pooler" }),
        "REQUEST",
      ).prepare,
    ).toBe(false);
  });
});

describe("access classes", () => {
  it("creates three distinct, explicitly labelled clients without connecting", async () => {
    const request = createRequestDatabaseClient(config());
    const privileged = createPrivilegedDatabaseClient(config());
    const migration = createMigrationDatabaseClient(config());

    expect(request.accessClass).toBe("REQUEST");
    expect(privileged.accessClass).toBe("PRIVILEGED_SERVICE");
    expect(migration.accessClass).toBe("MIGRATION");

    // Construction is lazy: closing a never-used client must not need a socket.
    await Promise.all([request.close(), privileged.close(), migration.close()]);
  });

  it("refuses privileged and migration clients in a deployed environment without a dedicated URL", () => {
    const deployed = parseDatabaseConfig({
      NODE_ENV: "production",
      CAPITAL_Q_ENV: "production",
      DATABASE_URL: LOCAL_TEST_URL,
    });

    expect(() => createPrivilegedDatabaseClient(deployed)).toThrow(
      /DATABASE_PRIVILEGED_URL/,
    );
    expect(() => createMigrationDatabaseClient(deployed)).toThrow(
      /DATABASE_MIGRATION_URL/,
    );
    // The request client remains constructible with only DATABASE_URL.
    expect(createRequestDatabaseClient(deployed).accessClass).toBe("REQUEST");
  });
});

describe("failure handling", () => {
  it("reports an unreachable database as unhealthy without leaking the URL", async () => {
    const client = createRequestDatabaseClient(
      config({ DATABASE_URL: UNREACHABLE_URL }),
    );

    const health = await checkDatabaseHealth(client.sql);
    await client.close();

    expect(health.reachable).toBe(false);
    expect(JSON.stringify(health)).not.toContain(SECRET);
    expect(JSON.stringify(health)).not.toContain("127.0.0.1");
  });

  it("wraps transaction failures on an unreachable database as DatabaseError", async () => {
    const client = createRequestDatabaseClient(
      config({ DATABASE_URL: UNREACHABLE_URL }),
    );

    let caught: unknown;
    try {
      await client.transactions.run(async (tx) => {
        await tx.sql`select 1`;
      });
    } catch (error) {
      caught = error;
    } finally {
      await client.close();
    }

    expect(caught).toBeInstanceOf(DatabaseError);
    const wrapped = caught as DatabaseError;
    expect(wrapped.kind).toBe("CONNECTION");
    expect(wrapped.message).not.toContain(SECRET);
    expect(wrapped.message).not.toContain("127.0.0.1");
  });

  it("classifies SQLSTATEs without copying the driver message", () => {
    const driverError = Object.assign(
      new Error(`connection "${LOCAL_TEST_URL}" failed on: select secret`),
      { code: "23505", constraint_name: "companies_slug_key" },
    );

    const wrapped = toDatabaseError(driverError);

    expect(wrapped.kind).toBe("CONSTRAINT");
    expect(wrapped.sqlState).toBe("23505");
    expect(wrapped.constraintName).toBe("companies_slug_key");
    expect(wrapped.message).not.toContain(SECRET);
    expect(wrapped.message).not.toContain("select secret");
    expect(wrapped.cause).toBe(driverError);
  });

  it.each([
    ["57014", "TIMEOUT"],
    ["40001", "RETRYABLE"],
    ["40P01", "RETRYABLE"],
    ["23503", "CONSTRAINT"],
    ["08006", "CONNECTION"],
    ["42P01", "UNEXPECTED"],
  ] as const)("maps SQLSTATE %s to %s", (code, kind) => {
    expect(toDatabaseError(Object.assign(new Error("x"), { code })).kind).toBe(
      kind,
    );
  });

  it("passes an existing DatabaseError through unchanged", () => {
    const original = new DatabaseError("TIMEOUT");
    expect(toDatabaseError(original)).toBe(original);
  });
});
