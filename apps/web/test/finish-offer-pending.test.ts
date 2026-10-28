import { describe, expect, it } from "vitest";

import { canOfferFinish } from "../src/features/onboarding-conversation/conversation";

/**
 * Production re-test 2026-10-28 (investor f46ddb69): nine mandate answers
 * were still saving, coverage said the setup could not complete, and the
 * Finish control never showed. An answer still saving counts as answered
 * for the control; the runtime still decides on Finish.
 */
const field = (state: string, savePending = false, required = true) => ({
  applicable: true,
  required,
  state,
  savePending,
});

describe("the Finish control", () => {
  it("shows when every required answer is saved or still saving", () => {
    expect(
      canOfferFinish({
        summary: { canComplete: false, contradictory: 0 },
        fields: [
          field("CONFIRMED_SAVED"),
          field("MISSING", true),
          field("MISSING", false, false),
        ],
      }),
    ).toBe(true);
  });

  it("stays hidden while a required answer is missing, or two disagree", () => {
    expect(
      canOfferFinish({
        summary: { canComplete: false, contradictory: 0 },
        fields: [field("MISSING", true), field("MISSING")],
      }),
    ).toBe(false);
    expect(
      canOfferFinish({
        summary: { canComplete: false, contradictory: 1 },
        fields: [field("CONFIRMED_SAVED"), field("MISSING", true)],
      }),
    ).toBe(false);
  });

  it("shows whenever coverage says it can complete", () => {
    expect(
      canOfferFinish({
        summary: { canComplete: true, contradictory: 0 },
        fields: [],
      }),
    ).toBe(true);
  });
});
