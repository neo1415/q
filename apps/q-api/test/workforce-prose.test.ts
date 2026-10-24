import { describe, expect, it } from "vitest";

import { prose } from "../src/composition/workforce/models.js";

describe("prose within its stored bound", () => {
  it("keeps text that fits", () => {
    expect(prose("Treat Mombasa as a month-12 decision.", 300)).toBe(
      "Treat Mombasa as a month-12 decision.",
    );
  });

  it("cuts long text at a word, with an ellipsis, never mid-word", () => {
    const text = `${"Use the three active investor relationships deliberately. ".repeat(5)}Treat Mombasa as a month-12 decision, not a committed rollout.`;
    const cut = prose(text, 300);
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut.endsWith("…")).toBe(true);
    expect(text.startsWith(cut.slice(0, -1))).toBe(true);
    expect(text[cut.length - 1]).toBe(" ");
  });

  it("cuts one unbroken word at the bound", () => {
    expect(prose("x".repeat(500), 300)).toHaveLength(300);
  });
});
