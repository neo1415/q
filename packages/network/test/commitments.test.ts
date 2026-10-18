import { describe, expect, it } from "vitest";

import { commitmentBucket, commitmentNextStep } from "../src/index.js";

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

describe("the money's steps (2026-10-04)", () => {
  it("counts money sent or received as confirmed, whatever was first said", () => {
    expect(commitmentBucket({ level: "SOFT", status: "TRANSFER_SENT" })).toBe(
      "CONFIRMED",
    );
    expect(commitmentBucket({ level: "SOFT", status: "RECEIVED" })).toBe(
      "CONFIRMED",
    );
  });

  it("offers each side only its own next step", () => {
    // Q heard it: either side confirms the amount first.
    expect(commitmentNextStep("DETECTED", "INVESTOR", "COMPANY")).toBe(
      "CONFIRM_AMOUNT",
    );
    expect(commitmentNextStep("DETECTED", null, "INVESTOR")).toBe(
      "CONFIRM_AMOUNT",
    );
    // One side confirmed: only the other side confirms it.
    expect(commitmentNextStep("STATED", "COMPANY", "COMPANY")).toBeNull();
    expect(commitmentNextStep("STATED", "COMPANY", "INVESTOR")).toBe(
      "CONFIRM_AMOUNT",
    );
    // Both confirmed: the investor sends; the company may confirm receipt.
    expect(commitmentNextStep("CONFIRMED", "COMPANY", "INVESTOR")).toBe(
      "MARK_SENT",
    );
    expect(commitmentNextStep("CONFIRMED", "COMPANY", "COMPANY")).toBe(
      "CONFIRM_RECEIVED",
    );
    expect(
      commitmentNextStep("TRANSFER_SENT", "COMPANY", "INVESTOR"),
    ).toBeNull();
    expect(commitmentNextStep("TRANSFER_SENT", "COMPANY", "COMPANY")).toBe(
      "CONFIRM_RECEIVED",
    );
    expect(commitmentNextStep("RECEIVED", "COMPANY", "COMPANY")).toBeNull();
    expect(commitmentNextStep("DISPUTED", null, "COMPANY")).toBeNull();
  });
});
