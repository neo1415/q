import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import {
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_FINANCIAL_STEPS,
  FOUNDER_STEPS,
} from "@capital-q/founder-onboarding/definition";

import { isSupportedVersion } from "../src/features/founder-onboarding/models/journey";

/**
 * Live 2026-10-01: founder definition v3 was published and every new
 * founder saw "Founder setup isn't available right now", because this
 * screen accepted v2 only. v3 is v2 plus two options; v1 stays refused.
 * Live 2026-10-15: the same again for v4 (published 2026-10-07; v3 plus
 * the optional financials block), until the screen named v4.
 */
const KNOWN_PATH: readonly string[] = [
  FOUNDER_STEPS.intent,
  FOUNDER_STEPS.companyName,
  FOUNDER_STEPS.country,
  FOUNDER_FINANCIAL_STEPS.cash,
  FOUNDER_FINANCIAL_STEPS.minCheque,
];
const viewAt = (definitionVersion: number, stepKeys = KNOWN_PATH) =>
  ({
    session: { definitionVersion },
    progress: {
      eligibleSteps: stepKeys.map((stepKey) => ({ stepKey })),
    },
  }) as unknown as OnboardingSessionView;

describe("the founder setup screen's definition versions", () => {
  it("renders v2, v3, v4 and the version new sessions pin to", () => {
    for (const v of [2, 3, 4, FOUNDER_DEFINITION_CURRENT.version]) {
      expect(isSupportedVersion(viewAt(v))).toBe(true);
    }
  });

  it("renders a later version that only adds options (v5: Gulf countries) without a code change", () => {
    expect(isSupportedVersion(viewAt(5))).toBe(true);
  });

  it("refuses v1, and any version whose path has a step this screen cannot draw", () => {
    expect(isSupportedVersion(viewAt(1))).toBe(false);
    expect(
      isSupportedVersion(viewAt(6, [...KNOWN_PATH, "F9.new_question"])),
    ).toBe(false);
  });
});
