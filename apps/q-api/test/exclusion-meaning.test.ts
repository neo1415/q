import { describe, expect, it } from "vitest";

import {
  EXCLUSION_MEANING_REASON,
  exclusionMeaningUnsettled,
} from "../src/voice/interview-steps.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Owner 2026-10-25 (live e2e: "we never invest in gambling or tobacco" was
 * read as a firm exclusion and written as "rather not see"): which one
 * their words meant is the reading's, by meaning. A firm exclusion is
 * written only where one was declared; where a write and the reading
 * disagree, Q asks one short question. Hard is never picked silently.
 */

const HARD = "I7.hard_exclusions";
const SECTOR_HARD = "I7.sector_exclusions";
const SOFT = "I7.avoid";

describe("which exclusion their words meant", () => {
  it("a firm exclusion is written only where the reading found one declared", () => {
    expect(exclusionMeaningUnsettled(HARD, new Set([HARD]))).toBe(false);
    expect(exclusionMeaningUnsettled(HARD, new Set([SECTOR_HARD]))).toBe(false);
    expect(exclusionMeaningUnsettled(HARD, new Set([SOFT]))).toBe(true);
    expect(exclusionMeaningUnsettled(SECTOR_HARD, new Set())).toBe(true);
    // No reading of it at all: asked, never saved silently.
    expect(exclusionMeaningUnsettled(HARD, null)).toBe(true);
    // Declared in an earlier turn, saved now.
    expect(
      exclusionMeaningUnsettled(HARD, new Set(), (key) => key === HARD),
    ).toBe(false);
  });

  it("a preference is not written over what was read as a firm exclusion", () => {
    expect(exclusionMeaningUnsettled(SOFT, new Set([SECTOR_HARD]))).toBe(true);
    expect(exclusionMeaningUnsettled(SOFT, new Set([SOFT]))).toBe(false);
    // Both read (some firm, some preference): each goes where it was read.
    expect(exclusionMeaningUnsettled(SOFT, new Set([HARD, SOFT]))).toBe(false);
    // Nothing read about exclusions: a preference ranks lower, hides nothing.
    expect(exclusionMeaningUnsettled(SOFT, new Set())).toBe(false);
  });

  it("other steps are untouched", () => {
    expect(exclusionMeaningUnsettled("I2.stages", null)).toBe(false);
  });
});

describe("the live case, through the port", () => {
  it("read as firm, written as 'rather not see': nothing saved, Q is told to ask", async () => {
    const said = "We never invest in gambling or tobacco.";
    const world = investorSession({
      currentStepKey: SOFT,
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Kestrel Ridge Partners",
      },
    });
    const port = createOnboardingPort({
      session: turn(world, said).session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: "b0000000-0000-4000-8000-000000000001",
      personTurns: [said],
      authority: () => Promise.resolve(reading({ stated: [SECTOR_HARD] })),
    });
    const [result] = await port.record([
      {
        stepKey: SOFT,
        value: ["gambling", "tobacco"],
        quote: "gambling or tobacco",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("REJECTED");
    expect(result && "reason" in result ? result.reason : null).toBe(
      EXCLUSION_MEANING_REASON,
    );
    expect(world.recordedValue(SOFT)).toBeUndefined();
  });
});
