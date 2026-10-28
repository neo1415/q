import { describe, expect, it } from "vitest";

import { readinessItems, setupStillOpen } from "../src/features/home/briefing";

/**
 * Live typed run 2026-10-28, D6: Home said "3 steps before investors can
 * find you" and offered no way back into setup. While the setup is open
 * the card is the way back to Q; once finished it leads to the first
 * outstanding requirement, as before.
 */
const GAPS = [
  {
    requirement: "DISCOVERY_VISIBILITY_CONFIRMED",
    description: "Confirm who can discover your company.",
    href: "/company/visibility",
  },
  {
    requirement: "FOUNDER_IDENTITY_VERIFIED",
    description: "Verify yourself.",
    href: "/verification",
  },
  {
    requirement: "ORGANISATION_VERIFIED",
    description: "Verify the company.",
    href: "/verification",
  },
];

describe("the readiness card on Home", () => {
  it("leads back to Q with a visible call to action while setup is open", () => {
    const [card] = readinessItems(GAPS, true);
    expect(card).toMatchObject({
      title: "3 steps before investors can find you",
      href: "/onboarding/founder?from=home",
      cta: "Finish setup with Q",
    });
  });

  it("leads to the first outstanding requirement once setup is finished", () => {
    const [card] = readinessItems(GAPS, false);
    expect(card).toMatchObject({
      href: "/company/visibility",
      cta: "Continue",
    });
    expect(readinessItems([], false)).toEqual([]);
  });

  it("reads whether setup is open from the server's nudge", () => {
    const nudge = {
      journeyType: "founder" as const,
      doneCount: 6,
      requiredCount: 9,
      minutesLeft: 2,
      day: "2026-10-28",
    };
    expect(setupStillOpen(nudge)).toBe(true);
    expect(setupStillOpen({ ...nudge, doneCount: 9 })).toBe(false);
    expect(setupStillOpen(undefined)).toBe(false);
  });
});
