import { describe, expect, it } from "vitest";

import { parseApiConfig } from "../src/api.js";
import { deploymentEnvironmentOf } from "../src/common.js";
import { ConfigurationError } from "../src/errors.js";
import { parseQApiConfig } from "../src/q-api.js";
import { parseWorkerConfig } from "../src/workers.js";

/**
 * W1-A (enterprise audit 21 Nov 2026): CAPITAL_Q_ENV is read one way
 * everywhere; production must say `production`. And the general rate
 * limit's allowances come from config with generous defaults.
 */
describe("CAPITAL_Q_ENV is read one way", () => {
  it.each([
    ["production", "production"],
    ["Production", "production"],
    [" production ", "production"],
    ["STAGING", "staging"],
    ["", "local"],
    ["  ", "local"],
  ])("%j reads as %s, in every service", (raw, expected) => {
    expect(
      parseApiConfig({ CAPITAL_Q_ENV: raw }).runtime.deploymentEnvironment,
    ).toBe(expected);
    expect(
      parseQApiConfig({ CAPITAL_Q_ENV: raw }).runtime.deploymentEnvironment,
    ).toBe(expected);
    expect(
      parseWorkerConfig({ CAPITAL_Q_ENV: raw }).runtime.deploymentEnvironment,
    ).toBe(expected);
    expect(deploymentEnvironmentOf({ CAPITAL_Q_ENV: raw })).toBe(expected);
  });

  it("unset is local; anything unknown stops the service rather than guess", () => {
    expect(deploymentEnvironmentOf({})).toBe("local");
    expect(deploymentEnvironmentOf({ CAPITAL_Q_ENV: "prod" })).toBeNull();
    expect(() => parseApiConfig({ CAPITAL_Q_ENV: "prod" })).toThrow(
      ConfigurationError,
    );
    expect(() => parseQApiConfig({ CAPITAL_Q_ENV: "live" })).toThrow(
      ConfigurationError,
    );
  });
});

describe("the general rate limit's allowances", () => {
  it("are generous by default", () => {
    expect(parseApiConfig({}).rateLimit).toEqual({
      perUser: 600,
      perAddress: 300,
      windowMs: 60_000,
    });
    expect(parseQApiConfig({}).rateLimit).toEqual({
      perUser: 600,
      perAddress: 300,
      windowMs: 60_000,
    });
  });

  it("read from the environment", () => {
    expect(
      parseQApiConfig({
        CQ_RATE_LIMIT_PER_USER: "1200",
        CQ_RATE_LIMIT_PER_ADDRESS: "60",
      }).rateLimit,
    ).toEqual({ perUser: 1200, perAddress: 60, windowMs: 60_000 });
  });

  it.each(["0", "-5", "abc", "1.5"])(
    "refuse %s rather than shut the API",
    (raw) => {
      expect(() => parseApiConfig({ CQ_RATE_LIMIT_PER_USER: raw })).toThrow(
        ConfigurationError,
      );
    },
  );
});
