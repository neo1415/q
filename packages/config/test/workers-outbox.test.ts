import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../src/errors.js";
import { parseWorkerConfig } from "../src/workers.js";

describe("worker outbox runner configuration", () => {
  it("applies bounded defaults", () => {
    expect(parseWorkerConfig({}).outbox).toEqual({
      batchSize: 25,
      pollIntervalMs: 750,
      maxAttempts: 10,
    });
  });

  it("reads overrides", () => {
    expect(
      parseWorkerConfig({
        OUTBOX_PUBLISH_BATCH_SIZE: "100",
        OUTBOX_POLL_INTERVAL_MS: "250",
        OUTBOX_MAX_ATTEMPTS: "3",
      }).outbox,
    ).toEqual({ batchSize: 100, pollIntervalMs: 250, maxAttempts: 3 });
  });

  it.each([
    ["OUTBOX_PUBLISH_BATCH_SIZE", "0"],
    ["OUTBOX_PUBLISH_BATCH_SIZE", "101"],
    ["OUTBOX_POLL_INTERVAL_MS", "10"],
    ["OUTBOX_POLL_INTERVAL_MS", "60000"],
    ["OUTBOX_MAX_ATTEMPTS", "0"],
    ["OUTBOX_MAX_ATTEMPTS", "many"],
  ])("rejects an out-of-bounds %s", (variable, value) => {
    expect(() => parseWorkerConfig({ [variable]: value })).toThrow(
      ConfigurationError,
    );
  });
});
