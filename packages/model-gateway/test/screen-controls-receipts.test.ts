import { describe, expect, it } from "vitest";

import { controlsLine } from "../src/q/manifest-fact.js";
import { screenActsNote } from "../src/q/index.js";

/**
 * RECOVERY-2026-10 (C's request): the page's controls reach the model by
 * id, so "open the readiness tab" and "the second one" name something
 * operate_screen accepts; and what came of Q's last screen acts (the
 * browser's receipts) reaches the next turn, so Q never claims an act it
 * has no DONE receipt for.
 */

describe("the page's controls, for the model", () => {
  it("lists each control by id, kind, state and count", () => {
    expect(
      controlsLine([
        { id: "tab.overview", kind: "TAB", state: "SELECTED" },
        { id: "tab.readiness", kind: "TAB" },
        { id: "section.risks", kind: "SECTION" },
        { id: "list.investors", kind: "LIST", count: 4 },
      ]),
    ).toBe(
      "- Controls on this page, for operate_screen by id (a tab is selected with SELECT_TAB, a section shown with SCROLL_TO, the nth item of a list opened with SELECT_ITEM and its index): tab.overview (TAB, SELECTED); tab.readiness (TAB); section.risks (SECTION); list.investors (LIST, 4 items).",
    );
  });

  it("says nothing when the page registered none, and stays bounded", () => {
    expect(controlsLine([])).toBeNull();
    const many = Array.from({ length: 48 }, (_, index) => ({
      id: `section.part-number-${String(index)}`,
      kind: "SECTION" as const,
    }));
    const line = controlsLine(many) ?? "";
    expect(line.length).toBeLessThanOrEqual(1_420);
    expect(line).toMatch(/and \d+ more\.$/u);
  });
});

describe("what Q's last screen acts did", () => {
  // C's receiptFacts wording, as the q-api composes it.
  const facts = [
    "SELECT_TAB tab.readiness: done on their screen (DONE).",
    "SCROLL_TO section.risks: NOT done: that control is not on their screen (TARGET_MISSING).",
  ];

  it("is a trusted note that keeps DONE and NOT done apart", () => {
    const note = screenActsNote(facts);
    expect(note?.role).toBe("SYSTEM");
    expect(note?.content).toContain(facts[0]);
    expect(note?.content).toContain(facts[1]);
    expect(note?.content).toContain("Only an act marked DONE happened");
    expect(note?.content).toContain("never say a NOT done act worked");
  });

  it("is absent when there are no receipts", () => {
    expect(screenActsNote([])).toBeNull();
  });
});
