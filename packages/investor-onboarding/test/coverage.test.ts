import { describe, expect, it } from "vitest";

import {
  deriveOnboardingCoverage,
  knownFactsFromRegistration,
} from "@capital-q/onboarding";

import { viewOf } from "../../onboarding/test/support/coverage-view.js";
import {
  INVESTOR_COVERAGE_PROFILE,
  INVESTOR_DEFINITION_V1,
  INVESTOR_STEPS,
} from "../src/definition/index.js";

const NOW = new Date("2026-10-16T10:00:00.000Z");

describe("investor coverage", () => {
  it("is a mandate interview: no founder or fundraising concept appears", () => {
    const c = deriveOnboardingCoverage({
      profile: INVESTOR_COVERAGE_PROFILE,
      definition: INVESTOR_DEFINITION_V1,
      view: viewOf(INVESTOR_DEFINITION_V1, {}),
      now: NOW,
    });
    expect(c.journeyType).toBe("investor");
    for (const f of c.fields) {
      expect(f.concept, f.fieldKey).not.toMatch(
        /^(capital|traction|financials|company)\./,
      );
    }
    const keys = new Set(INVESTOR_DEFINITION_V1.steps.map((s) => s.stepKey));
    for (const key of Object.keys(INVESTOR_COVERAGE_PROFILE.fields)) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it("the firm named at registration is KNOWN, and stages come before nuance", () => {
    const c = deriveOnboardingCoverage({
      profile: INVESTOR_COVERAGE_PROFILE,
      definition: INVESTOR_DEFINITION_V1,
      view: viewOf(INVESTOR_DEFINITION_V1, {
        [INVESTOR_STEPS.investorType]: {
          type: "SINGLE_SELECT",
          optionKey: "vc",
        },
      }),
      known: knownFactsFromRegistration(INVESTOR_COVERAGE_PROFILE, {
        organisationName: "Savanna Seed Partners",
      }),
      now: NOW,
    });
    const firm = c.fields.find(
      (f) => f.fieldKey === INVESTOR_STEPS.organisationName,
    );
    expect(firm?.state).toBe("KNOWN");
    const next = c.next.map((n) => n.fieldKey);
    expect(next).not.toContain(INVESTOR_STEPS.organisationName);
    expect(next).not.toContain(INVESTOR_STEPS.investorType);
    expect(c.next.every((n) => n.reason === "ESSENTIAL_MISSING")).toBe(true);
    // Optional nuance (green flags) is deferrable, never pressed.
    expect(
      c.fields.find((f) => f.fieldKey === INVESTOR_STEPS.greenFlags)?.state,
    ).toBe("DEFERRABLE");
  });
});
