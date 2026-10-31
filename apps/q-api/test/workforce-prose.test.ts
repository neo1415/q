import { describe, expect, it } from "vitest";

import { prose } from "../src/composition/workforce/models.js";

describe("prose within its stored bound", () => {
  it("keeps text that fits", () => {
    expect(prose("Treat Mombasa as a month-12 decision.", 300)).toBe(
      "Treat Mombasa as a month-12 decision.",
    );
  });

  it("keeps whole sentences when they fit, never a sentence cut mid-clause", () => {
    const text = `${"Use the three active investor relationships deliberately. ".repeat(5)}Treat Mombasa as a month-12 decision, not a committed rollout.`;
    const cut = prose(text, 300);
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut.endsWith("deliberately.")).toBe(true);
    expect(text.startsWith(cut)).toBe(true);
  });

  it("live 2026-10-31 (IC memo lead): ends at the last whole sentence, never '…(company record, self-reported),…'", () => {
    const text =
      "Recommendation: do not proceed yet. Clearwater Assurance presents a potentially attractive but entirely company-reported proposition, and the research does not corroborate those figures or establish the company's legal identity, team, product quality, market position or financial condition. Given the apparent mismatch with the declared energy-transition mandate and the unverified pitch-video statement that the company is raising £9m (company record, self-reported), the committee should treat this as a pass unless it authorises a mandate exception first and names who owns the verification screen.";
    const cut = prose(text, 600);
    expect(cut.endsWith("financial condition.")).toBe(true);
    expect(cut).not.toContain("…");
  });

  it("cuts one long sentence at a word, with an ellipsis and no dangling comma", () => {
    const text = `${"one clause, ".repeat(40)}end.`;
    const cut = prose(text, 300);
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/[,;:]…$/u);
    expect(text.startsWith(cut.slice(0, -1))).toBe(true);
  });

  it("cuts one unbroken word at the bound", () => {
    expect(prose("x".repeat(500), 300)).toHaveLength(300);
  });
});
