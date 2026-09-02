import { describe, expect, it } from "vitest";

/**
 * Test harness smoke verification.
 *
 * This is infrastructure verification, NOT product behaviour coverage. It
 * proves only that Vitest discovers and executes Capital Q tests and that the
 * configured environment is the one this repository intends. It asserts nothing
 * about Capital Q's domain, and must never be counted as coverage of any
 * business or security invariant (doc 24, 320/322).
 *
 * Delete or replace it once real tests exist in this package.
 */
describe("test harness smoke verification", () => {
  it("executes a test through the configured runner", () => {
    expect(true).toBe(true);
  });

  it("runs in the node environment rather than a browser environment", () => {
    // Guards the `environment: "node"` setting in vitest.config.ts. If a future
    // change silently switched the default to jsdom/happy-dom, backend and
    // domain tests would start running against a fake browser and this fails.
    expect("window" in globalThis).toBe(false);
    expect(typeof process.versions.node).toBe("string");
  });
});
