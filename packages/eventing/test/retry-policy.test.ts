import { describe, expect, it } from "vitest";

import {
  createOutboxRetryPolicy,
  DEFAULT_MAX_ATTEMPTS,
  exponentialBackoffSeconds,
} from "../src/publisher/retry-policy.js";

describe("outbox retry policy", () => {
  it("backs off exponentially from 5 s and caps at 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(exponentialBackoffSeconds)).toEqual(
      [5, 10, 20, 40, 80, 160, 300, 300, 300],
    );
  });

  it("defaults to ten attempts and rejects a non-positive bound", () => {
    expect(createOutboxRetryPolicy().maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(createOutboxRetryPolicy({ maxAttempts: 3 }).maxAttempts).toBe(3);
    expect(() => createOutboxRetryPolicy({ maxAttempts: 0 })).toThrow(
      RangeError,
    );
    expect(() => createOutboxRetryPolicy({ maxAttempts: 1.5 })).toThrow(
      RangeError,
    );
  });
});
