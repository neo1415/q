import { describe, expect, it } from "vitest";
import type { OnboardingResponseValue } from "@capital-q/contracts";

import { FOUNDER_STEPS, founderRecordChecks } from "../src/index.js";

const pick = (optionKey: string): OnboardingResponseValue => ({
  type: "SINGLE_SELECT",
  optionKey,
});

describe("founder record checks (final check 2026-10-30)", () => {
  it("raising now at the start and not right now on the raise: one open check naming both, neither changed", () => {
    const values = new Map([
      [FOUNDER_STEPS.intent, pick("raising_now")],
      [FOUNDER_STEPS.raising, pick("not_now")],
    ]);
    const checks = founderRecordChecks(values);
    expect(checks).toEqual([
      {
        id: "RAISING_INTENT_VS_STATUS:raising_now:not_now",
        stepKeys: [FOUNDER_STEPS.intent, FOUNDER_STEPS.raising],
        fact: 'On record, what brings you to Capital Q is "I\'m raising for a company", and whether you are raising now is "Not right now".',
      },
    ]);
    // Contradictions coexist: the check reads the record, never edits it.
    expect(values.get(FOUNDER_STEPS.raising)).toEqual(pick("not_now"));
  });

  it("answers that agree, or one not given yet, raise nothing", () => {
    expect(
      founderRecordChecks(
        new Map([
          [FOUNDER_STEPS.intent, pick("raising_now")],
          [FOUNDER_STEPS.raising, pick("active")],
        ]),
      ),
    ).toEqual([]);
    expect(
      founderRecordChecks(
        new Map([
          [FOUNDER_STEPS.intent, pick("preparing_to_raise")],
          [FOUNDER_STEPS.raising, pick("not_now")],
        ]),
      ),
    ).toEqual([]);
    expect(
      founderRecordChecks(
        new Map([[FOUNDER_STEPS.intent, pick("raising_now")]]),
      ),
    ).toEqual([]);
  });
});
