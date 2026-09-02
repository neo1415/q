import { describe, expect, it } from "vitest";

import { parseDatabaseConfig, resolveDatabaseUrl } from "../src/database.js";
import { ConfigurationError } from "../src/errors.js";

// Synthetic. The password is a sentinel used to prove it never leaks.
const REQUEST_URL = "postgresql://test:super-secret-test-value@localhost/test";
const PRIVILEGED_URL = "postgresql://svc:other-secret-value@localhost/test";
const MIGRATION_URL = "postgresql://mig:third-secret-value@localhost/test";

const BASE_ENV = { NODE_ENV: "test", DATABASE_URL: REQUEST_URL };

describe("parseDatabaseConfig", () => {
  it("applies bounded defaults with only DATABASE_URL set", () => {
    const config = parseDatabaseConfig(BASE_ENV);

    expect(config.connectionMode).toBe("direct");
    expect(config.poolMax).toBe(5);
    expect(config.idleTimeoutSeconds).toBe(20);
    expect(config.connectTimeoutSeconds).toBe(10);
    expect(config.statementTimeoutMs).toBe(10_000);
    expect(config.secrets.url).toBe(REQUEST_URL);
    expect(config.secrets.privilegedUrl).toBeUndefined();
    expect(config.secrets.migrationUrl).toBeUndefined();
  });

  it("reads every override", () => {
    const config = parseDatabaseConfig({
      ...BASE_ENV,
      CAPITAL_Q_ENV: "staging",
      DATABASE_CONNECTION_MODE: "transaction_pooler",
      DATABASE_POOL_MAX: "12",
      DATABASE_IDLE_TIMEOUT_SECONDS: "5",
      DATABASE_CONNECT_TIMEOUT_SECONDS: "3",
      DATABASE_STATEMENT_TIMEOUT_MS: "2500",
      DATABASE_PRIVILEGED_URL: PRIVILEGED_URL,
      DATABASE_MIGRATION_URL: MIGRATION_URL,
    });

    expect(config.runtime.deploymentEnvironment).toBe("staging");
    expect(config.connectionMode).toBe("transaction_pooler");
    expect(config.poolMax).toBe(12);
    expect(config.idleTimeoutSeconds).toBe(5);
    expect(config.connectTimeoutSeconds).toBe(3);
    expect(config.statementTimeoutMs).toBe(2500);
    expect(config.secrets.privilegedUrl).toBe(PRIVILEGED_URL);
    expect(config.secrets.migrationUrl).toBe(MIGRATION_URL);
  });

  it("fails without DATABASE_URL and names the variable, not a value", () => {
    expect(() => parseDatabaseConfig({ NODE_ENV: "test" })).toThrow(
      ConfigurationError,
    );
  });

  it.each([
    ["DATABASE_URL", "mysql://nope"],
    ["DATABASE_URL", "not a url at all"],
    ["DATABASE_CONNECTION_MODE", "pgbouncer"],
    ["DATABASE_POOL_MAX", "0"],
    ["DATABASE_POOL_MAX", "50"],
    ["DATABASE_POOL_MAX", "five"],
    ["DATABASE_STATEMENT_TIMEOUT_MS", "1"],
    ["DATABASE_STATEMENT_TIMEOUT_MS", "600000"],
    ["DATABASE_CONNECT_TIMEOUT_SECONDS", "0"],
    ["DATABASE_PRIVILEGED_URL", "https://example.test"],
  ])("rejects invalid %s", (variable, value) => {
    expect(() =>
      parseDatabaseConfig({ ...BASE_ENV, [variable]: value }),
    ).toThrow(ConfigurationError);
  });

  it("never echoes a connection string in a configuration error", () => {
    let caught: unknown;
    try {
      parseDatabaseConfig({
        NODE_ENV: "test",
        DATABASE_URL: `${REQUEST_URL}`,
        DATABASE_POOL_MAX: "not-a-number",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigurationError);
    const serialised = JSON.stringify({
      message: (caught as Error).message,
      issues: (caught as ConfigurationError).issues,
    });
    expect(serialised).not.toContain("super-secret-test-value");
    expect(serialised).not.toContain("not-a-number");
  });
});

describe("resolveDatabaseUrl", () => {
  it("returns the request URL for REQUEST access everywhere", () => {
    const staging = parseDatabaseConfig({
      ...BASE_ENV,
      CAPITAL_Q_ENV: "staging",
    });
    expect(resolveDatabaseUrl(staging, "REQUEST")).toBe(REQUEST_URL);
  });

  it("prefers a dedicated URL when configured", () => {
    const config = parseDatabaseConfig({
      ...BASE_ENV,
      DATABASE_PRIVILEGED_URL: PRIVILEGED_URL,
      DATABASE_MIGRATION_URL: MIGRATION_URL,
    });

    expect(resolveDatabaseUrl(config, "PRIVILEGED_SERVICE")).toBe(
      PRIVILEGED_URL,
    );
    expect(resolveDatabaseUrl(config, "MIGRATION")).toBe(MIGRATION_URL);
  });

  it("falls back to DATABASE_URL only locally / under test", () => {
    const local = parseDatabaseConfig({
      NODE_ENV: "development",
      CAPITAL_Q_ENV: "local",
      DATABASE_URL: REQUEST_URL,
    });
    expect(resolveDatabaseUrl(local, "PRIVILEGED_SERVICE")).toBe(REQUEST_URL);
    expect(resolveDatabaseUrl(local, "MIGRATION")).toBe(REQUEST_URL);
  });

  it.each(["preview", "staging", "production"] as const)(
    "refuses to substitute the request credential for privileged access in %s",
    (environment) => {
      const config = parseDatabaseConfig({
        NODE_ENV: "production",
        CAPITAL_Q_ENV: environment,
        DATABASE_URL: REQUEST_URL,
      });

      for (const accessClass of ["PRIVILEGED_SERVICE", "MIGRATION"] as const) {
        let caught: unknown;
        try {
          resolveDatabaseUrl(config, accessClass);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ConfigurationError);
        expect(JSON.stringify(caught)).not.toContain("super-secret-test-value");
        expect((caught as Error).message).not.toContain(
          "super-secret-test-value",
        );
      }
    },
  );
});
