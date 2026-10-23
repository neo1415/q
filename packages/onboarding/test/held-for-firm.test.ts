import { describe, expect, it } from "vitest";

import {
  ONBOARDING_CONTEXT_REQUIRED_CODE,
  OnboardingContextRequiredError,
  isTransientOnboardingFailure,
  waitsForContext,
} from "../src/index.js";

/**
 * QA F-52 (23 Oct 2026): an answer that needs the firm or company before
 * it can land is held and saved once the firm exists, never refused for
 * good (and never read out as "firm context isn't active").
 */
describe("an answer that waits for its firm", () => {
  it("is known by its code, from the API or a batch refusal", () => {
    const problem = {
      detail: "kept",
      errors: [{ path: "value", code: ONBOARDING_CONTEXT_REQUIRED_CODE }],
    };
    expect(waitsForContext({ status: 400, problem })).toBe(true);
    expect(waitsForContext({ problem })).toBe(true);
    expect(waitsForContext(new OnboardingContextRequiredError())).toBe(true);
    expect(
      waitsForContext({
        status: 400,
        problem: { errors: [{ code: "investor_type_required" }] },
      }),
    ).toBe(false);
  });

  it("is held for retry, unlike any other refusal", () => {
    expect(
      isTransientOnboardingFailure({
        status: 400,
        problem: { errors: [{ code: ONBOARDING_CONTEXT_REQUIRED_CODE }] },
      }),
    ).toBe(true);
    expect(
      isTransientOnboardingFailure({
        status: 400,
        problem: { errors: [{ code: "organisation_name_required" }] },
      }),
    ).toBe(false);
  });

  it("never says 'context' to the person", () => {
    expect(new OnboardingContextRequiredError().message).not.toMatch(
      /context/iu,
    );
  });
});
