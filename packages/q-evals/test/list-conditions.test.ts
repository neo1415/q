import { describe, expect, it } from "vitest";

import {
  gradeListConditions,
  LIST_CONDITIONS_CASES,
} from "../src/datasets/list-conditions/cases.js";

/**
 * RC2 list-conditions dataset and grader, offline ($0, no provider): the
 * cases TURN_READER v89's `question.listConditions` must read.
 */
describe("the list-conditions dataset and grader", () => {
  it("covers every live turn from the audit, both sides, voice, two languages and negatives", () => {
    const cases = LIST_CONDITIONS_CASES;
    expect(new Set(cases.map((one) => one.id)).size).toBe(cases.length);
    expect(cases.filter((one) => one.id.startsWith("live-")).length).toBe(5);
    expect(new Set(cases.map((one) => one.side))).toEqual(
      new Set(["INVESTOR", "FOUNDER"]),
    );
    expect(
      cases.filter((one) => /spanish|french/u.test(one.id)).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      cases.filter((one) => one.expected.conditions === null).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("grades by the typed reading, never by the words", () => {
    const expected = {
      kinds: ["FIT"] as const,
      conditions: { revenue: "HAS_REVENUE" as const },
    };
    const conditions = {
      relationship: null,
      revenue: "HAS_REVENUE",
      sector: null,
      stage: null,
      geography: null,
      order: "BEST_FIRST",
    };
    expect(
      gradeListConditions(expected, {
        question: { kind: "FIT", listConditions: conditions },
      }),
    ).toBe(true);
    expect(
      gradeListConditions(expected, {
        question: { kind: "FIT", listConditions: null },
      }),
    ).toBe("no conditions read");
    expect(
      gradeListConditions(expected, {
        question: {
          kind: "FIT",
          listConditions: { ...conditions, sector: "OUTSIDE" },
        },
      }),
    ).toBe("sector OUTSIDE");
    expect(
      gradeListConditions(
        { kinds: ["FIT"], conditions: null },
        { question: { kind: "FIT", listConditions: conditions } },
      ),
    ).toBe("a condition nobody stated");
    expect(gradeListConditions(expected, null)).toBe("not read");
  });
});
