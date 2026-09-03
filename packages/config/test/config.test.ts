import { describe, expect, it } from "vitest";

import { API_DEFAULT_PORT, parseApiConfig } from "../src/api.js";
import { Q_API_DEFAULT_PORT, parseQApiConfig } from "../src/q-api.js";
import { parseWorkerConfig } from "../src/workers.js";
import { parseWebServerConfig } from "../src/web.js";
import { ConfigurationError } from "../src/errors.js";

/**
 * Tests parse explicit environment objects rather than mutating `process.env`,
 * so they are order-independent and cannot leak state between cases.
 */
const EMPTY_ENV = {} as const;

/** The web app cannot be configured without its Auth server; api/q-api can. */
const WEB_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
} as const;

describe("runtime defaults", () => {
  it("defaults to local development when nothing is set", () => {
    const config = parseApiConfig(EMPTY_ENV);

    expect(config.runtime.nodeEnv).toBe("development");
    expect(config.runtime.deploymentEnvironment).toBe("local");
    expect(config.network.host).toBe("0.0.0.0");
    expect(config.network.port).toBe(API_DEFAULT_PORT);
  });

  it("accepts an explicit deployment environment", () => {
    const config = parseApiConfig({
      CAPITAL_Q_ENV: "staging",
      NODE_ENV: "production",
    });

    expect(config.runtime.deploymentEnvironment).toBe("staging");
    expect(config.runtime.nodeEnv).toBe("production");
  });

  it("rejects an unknown deployment environment", () => {
    expect(() => parseApiConfig({ CAPITAL_Q_ENV: "prod" })).toThrow(
      ConfigurationError,
    );
  });

  it("rejects an unknown node environment", () => {
    expect(() => parseApiConfig({ NODE_ENV: "staging" })).toThrow(
      ConfigurationError,
    );
  });
});

describe("port parsing", () => {
  it("coerces a numeric string", () => {
    expect(parseApiConfig({ PORT: "4100" }).network.port).toBe(4100);
  });

  it.each(["abc", "0", "-1", "70000", "3.5"])(
    "rejects the invalid port %s instead of silently defaulting",
    (port) => {
      expect(() => parseApiConfig({ PORT: port })).toThrow(ConfigurationError);
    },
  );

  it("falls back to the service default only when PORT is absent", () => {
    expect(parseApiConfig(EMPTY_ENV).network.port).toBe(API_DEFAULT_PORT);
    expect(parseQApiConfig(EMPTY_ENV).network.port).toBe(Q_API_DEFAULT_PORT);
  });

  it("gives each service a distinct default so they run concurrently", () => {
    expect(API_DEFAULT_PORT).not.toBe(Q_API_DEFAULT_PORT);
  });
});

describe("per-service isolation", () => {
  it("ignores unrelated environment variables rather than rejecting them", () => {
    // The real process environment always contains PATH, HOME, CI and platform
    // variables. A service validates only what it owns.
    const config = parseApiConfig({
      PATH: "/usr/bin",
      CI: "true",
      VERCEL_URL: "example.invalid",
      SOME_OTHER_SERVICE_SECRET: "unrelated",
    });

    expect(config.runtime.deploymentEnvironment).toBe("local");
  });

  it("does not give the worker network configuration it has no use for", () => {
    const config = parseWorkerConfig({ PORT: "9999", HOST: "127.0.0.1" });

    expect(config).not.toHaveProperty("network");
    expect(config.runtime.deploymentEnvironment).toBe("local");
  });

  it("exposes empty public and secret areas rather than omitting them", () => {
    // The shape exists now so future provider credentials have a defined home
    // and cannot be mixed into runtime config.
    for (const config of [
      parseApiConfig(EMPTY_ENV),
      parseQApiConfig(EMPTY_ENV),
      parseWorkerConfig(EMPTY_ENV),
    ]) {
      expect(config.public).toEqual({});
      expect(config.secrets).toEqual({});
    }
    // The web app's public area holds exactly the two browser-safe Supabase
    // values and nothing secret.
    const web = parseWebServerConfig(WEB_ENV);
    expect(Object.keys(web.public).sort()).toEqual([
      "supabasePublishableKey",
      "supabaseUrl",
    ]);
    expect(web.secrets).toEqual({});
  });
});

describe("observability configuration", () => {
  it("defaults to debug locally and silent under test", () => {
    expect(parseApiConfig(EMPTY_ENV).observability.logLevel).toBe("debug");
    expect(parseApiConfig({ NODE_ENV: "test" }).observability.logLevel).toBe(
      "silent",
    );
  });

  it("defaults to info in deployed environments", () => {
    for (const environment of ["preview", "staging", "production"]) {
      expect(
        parseApiConfig({ CAPITAL_Q_ENV: environment }).observability.logLevel,
      ).toBe("info");
    }
  });

  it("accepts an explicit log level", () => {
    expect(parseApiConfig({ LOG_LEVEL: "warn" }).observability.logLevel).toBe(
      "warn",
    );
  });

  it("rejects an invalid log level rather than downgrading it", () => {
    expect(() => parseApiConfig({ LOG_LEVEL: "purple" })).toThrow(
      ConfigurationError,
    );
  });

  it("leaves service version and region undefined when not injected", () => {
    // No fake "1.0.0". CI/deployment injects a real git SHA or release id.
    const config = parseApiConfig(EMPTY_ENV);

    expect(config.observability.serviceVersion).toBeUndefined();
    expect(config.observability.region).toBeUndefined();
  });

  it("carries an injected service version through", () => {
    expect(
      parseApiConfig({ SERVICE_VERSION: "abc1234" }).observability
        .serviceVersion,
    ).toBe("abc1234");
  });

  it("applies to every backend service", () => {
    expect(parseQApiConfig({ LOG_LEVEL: "error" }).observability.logLevel).toBe(
      "error",
    );
    expect(
      parseWorkerConfig({ LOG_LEVEL: "error" }).observability.logLevel,
    ).toBe("error");
  });
});

describe("configuration errors are safe to log", () => {
  const SYNTHETIC_SECRET = "super-secret-test-value";

  it("names the variable and the expectation", () => {
    let error: unknown;
    try {
      parseApiConfig({ PORT: "abc" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    const configError = error as ConfigurationError;

    expect(configError.service).toBe("api");
    expect(configError.issues.map((issue) => issue.variable)).toContain("PORT");
    expect(configError.message).toContain("PORT");
    expect(configError.message).toContain(
      "expected an integer between 1 and 65535",
    );
  });

  it("never echoes a supplied value, even when that value is the invalid one", () => {
    let error: unknown;
    try {
      parseApiConfig({
        CAPITAL_Q_ENV: SYNTHETIC_SECRET,
        SOME_PROVIDER_TOKEN: SYNTHETIC_SECRET,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    const configError = error as ConfigurationError;

    expect(configError.message).not.toContain(SYNTHETIC_SECRET);
    for (const issue of configError.issues) {
      expect(issue.reason).not.toContain(SYNTHETIC_SECRET);
      expect(issue.variable).not.toContain(SYNTHETIC_SECRET);
    }
  });

  it("does not carry the environment on the error object", () => {
    let error: unknown;
    try {
      parseApiConfig({ PORT: "abc", ANOTHER_TOKEN: SYNTHETIC_SECRET });
    } catch (caught) {
      error = caught;
    }

    expect(JSON.stringify(error)).not.toContain(SYNTHETIC_SECRET);
  });
});
