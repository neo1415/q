import { describe, expect, it } from "vitest";

import { friendlyDetail } from "../src/features/onboarding-kit/problem-words";

/**
 * F17: a founder never sees "(REQUIRED_STEPS_INCOMPLETE)". The session's
 * refusals become words they can act on, and any other internal code is
 * dropped from the server's sentence.
 */
describe("onboarding refusals in plain words", () => {
  it("explains that Q's first reading is still running", () => {
    const out = friendlyDetail(
      "The onboarding session does not allow this action right now. (REQUIRED_STEPS_INCOMPLETE)",
    );
    expect(out.reason).toBe("REQUIRED_STEPS_INCOMPLETE");
    expect(out.text).toMatch(/first reading/u);
    expect(out.text).not.toMatch(/[A-Z]{3,}_[A-Z]/u);
  });

  it("drops an unknown code and keeps the sentence", () => {
    expect(friendlyDetail("That isn't allowed. (SOME_OTHER_CODE)")).toEqual({
      text: "That isn't allowed.",
      reason: "SOME_OTHER_CODE",
    });
    expect(friendlyDetail("Plain words.")).toEqual({
      text: "Plain words.",
      reason: null,
    });
  });
});
