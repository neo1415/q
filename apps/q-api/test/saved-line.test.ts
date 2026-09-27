import { describe, expect, it } from "vitest";

import { savedReadsLine } from "../src/composition/saved-line.js";

describe("the saved confirmation (R30 #26)", () => {
  it("ends in exactly one full stop when the person's own text already has one", () => {
    expect(
      savedReadsLine(
        "Your profile",
        "Headline: CEO, Ledgerfold. Credit for Lagos market traders.",
      ),
    ).toBe(
      "Saved. Your profile now reads: Headline: CEO, Ledgerfold. Credit for Lagos market traders.",
    );
  });

  it("joins several changed lines with semicolons", () => {
    expect(savedReadsLine("Your profile", "Name: Ada.\nHeadline: CEO")).toBe(
      "Saved. Your profile now reads: Name: Ada; Headline: CEO.",
    );
  });
});
