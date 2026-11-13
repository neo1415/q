import { describe, expect, it } from "vitest";

import {
  gradeNavigationIntent,
  NAVIGATION_INTENT_CASES,
} from "../src/datasets/navigation-intent/cases.js";

/**
 * C10 navigation-intent dataset and grader, offline ($0, no provider). The
 * live part is test/navigation-intent.live.test.ts (off unless
 * CQ_LIVE_MODEL_TESTS=1).
 */
describe("the navigation-intent dataset and grader", () => {
  it("has at least 15 cases: GO, OFFER_ONLY, NONE, negated, spoken, non-English and multi-part", () => {
    const cases = NAVIGATION_INTENT_CASES;
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(new Set(cases.map((one) => one.id)).size).toBe(cases.length);
    const count = (test: (one: (typeof cases)[number]) => boolean) =>
      cases.filter(test).length;
    expect(count((one) => one.expected.mode === "GO")).toBeGreaterThanOrEqual(
      6,
    );
    expect(
      count((one) => one.expected.mode === "OFFER_ONLY"),
    ).toBeGreaterThanOrEqual(4);
    expect(
      count((one) => one.expected.mode === "NONE" && !one.expected.negated),
    ).toBeGreaterThanOrEqual(5);
    expect(
      count((one) => one.expected.negated === true),
    ).toBeGreaterThanOrEqual(2);
    expect(
      count((one) => one.expected.multiPart === true),
    ).toBeGreaterThanOrEqual(1);
    expect(count((one) => one.modality === "VOICE")).toBeGreaterThanOrEqual(1);
    expect(
      count((one) => /spanish|french|pidgin/u.test(one.id)),
    ).toBeGreaterThanOrEqual(2);
    // Negated cases are NONE: "don't open it" is never a move.
    for (const one of cases.filter((c) => c.expected.negated === true)) {
      expect(one.expected.mode, one.id).toBe("NONE");
    }
  });

  it("grades by the typed intent, never by the words", () => {
    const go = { mode: "GO" as const };
    expect(
      gradeNavigationIntent(go, { navigation: { mode: "GO", negated: false } }),
    ).toBe(true);
    expect(
      gradeNavigationIntent(go, {
        navigation: { mode: "NONE", negated: false },
      }),
    ).toBe("mode NONE");
    expect(gradeNavigationIntent(go, { navigation: null })).toBe(
      "no navigation read",
    );
    expect(gradeNavigationIntent(go, null)).toBe("not read");
    expect(
      gradeNavigationIntent(
        { mode: "NONE", negated: true },
        { navigation: { mode: "NONE", negated: false } },
      ),
    ).toBe("negated false");
    const multi = { mode: "GO" as const, multiPart: true };
    expect(
      gradeNavigationIntent(multi, {
        navigation: { mode: "GO", negated: false },
        parts: [{ ask: "open Clinicrest" }],
      }),
    ).toBe("parts 1");
    expect(
      gradeNavigationIntent(multi, {
        navigation: { mode: "GO", negated: false },
        parts: [{ ask: "open Clinicrest" }, { ask: "its stage" }],
      }),
    ).toBe(true);
  });
});
