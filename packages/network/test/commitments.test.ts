import { describe, expect, it } from "vitest";

import { commitmentBucket } from "../src/index.js";

/**
 * Spec 6.6.14-6.6.15: money counts as confirmed only when the other side
 * confirmed a firm or invested commitment; everything else is soft, and
 * nothing is in both buckets.
 */
describe("commitment buckets", () => {
  it("counts only confirmed firm or invested money as confirmed", () => {
    expect(commitmentBucket({ level: "FIRM", status: "CONFIRMED" })).toBe(
      "CONFIRMED",
    );
    expect(commitmentBucket({ level: "INVESTED", status: "CONFIRMED" })).toBe(
      "CONFIRMED",
    );
  });

  it("keeps one side's word, however firm, as soft until the other confirms", () => {
    expect(commitmentBucket({ level: "FIRM", status: "STATED" })).toBe("SOFT");
    expect(commitmentBucket({ level: "INVESTED", status: "STATED" })).toBe(
      "SOFT",
    );
  });

  it("keeps a soft commitment soft even when confirmed", () => {
    expect(commitmentBucket({ level: "SOFT", status: "CONFIRMED" })).toBe(
      "SOFT",
    );
  });
});
