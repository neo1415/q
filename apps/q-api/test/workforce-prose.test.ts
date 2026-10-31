import { describe, expect, it } from "vitest";

import { personProse } from "../src/composition/workforce/analysis.js";
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

describe("live 2026-10-31: the IC memo's lead as the person reads it", () => {
  it("takes code's cut back to the last whole sentence, never '…self-reported),…'", () => {
    const lead =
      "Recommendation: do not proceed yet. Clearwater Assurance presents a potentially attractive but entirely company-reported proposition, and the research does not corroborate those figures or establish the company's legal identity, team, product quality, market position or financial condition. Given the apparent mismatch with the declared mandate and the unverified pitch-video statement that the company is raising £9m (company record, self-reported), the committee should treat this as a pass unless it first authorises an exception, names who owns the verification screen, sets the evidence it needs to see on identity, customers, revenue and regulatory acceptance, and agrees when it will look at the company again.";
    const stored = prose(lead, 600);
    expect(stored.endsWith("…")).toBe(true);
    const read = personProse(stored);
    expect(read.endsWith("financial condition.")).toBe(true);
    expect(read).not.toContain("…");
    expect(personProse("Whole text.")).toBe("Whole text.");
    expect(personProse(`${"word ".repeat(30)}tail,…`)).toMatch(/tail…$/u);
  });
});
