import { describe, expect, it } from "vitest";

import { Q_VISIBLE_STAGE_LABELS } from "@capital-q/contracts";

import {
  STAGE_PREAMBLE_AFTER_MS,
  stagePreamble,
} from "../src/voice/stage-preamble.js";
import { WORKING_STAGES } from "../src/voice/turn.js";
import { patientTurnTaking } from "../src/voice/turn-patience.js";

/**
 * HQ-3 (conversation audit §2.7): the voice's line when real work starts,
 * in approved words only, and patient turn-taking where people think aloud.
 */
describe("the stage preamble (HQ-3)", () => {
  it("is said within a second", () => {
    expect(STAGE_PREAMBLE_AFTER_MS).toBe(1_000);
  });

  it("every working stage has a line, and it is the approved label without a subject", () => {
    for (const stage of WORKING_STAGES) {
      const label =
        Q_VISIBLE_STAGE_LABELS[stage as keyof typeof Q_VISIBLE_STAGE_LABELS];
      expect(stagePreamble(stage, undefined), stage).toBe(
        /[.!?]$/u.test(label) ? label : `${label}.`,
      );
    }
  });

  it("names its subject only where the screen does, from the stage's own about", () => {
    expect(stagePreamble("REVIEWING_COMPANY", { subjects: ["Nixo"] })).toBe(
      "Looking at Nixo.",
    );
    expect(
      stagePreamble("COMPARING_OPPORTUNITIES", {
        subjects: ["Nixo", "Halyard"],
      }),
    ).toBe("Comparing Nixo and Halyard.");
    expect(
      stagePreamble("COMPARING_OPPORTUNITIES", { subjects: ["Nixo"] }),
    ).toBe("Comparing them side by side.");
    expect(
      stagePreamble("REVIEWING_INVESTOR_CRITERIA", { subjects: ["Zino"] }),
    ).toBe("Reading Zino's mandate.");
    expect(
      stagePreamble("SEARCHING_PUBLIC_SOURCES", { subjects: ["Nixo"] }),
    ).toBe("Looking into it.");
    expect(stagePreamble("NOT_A_STAGE", undefined)).toBeNull();
  });
});

describe("patient turn-taking (HQ-3)", () => {
  it("in onboarding, its welcome call and discovery; nowhere else", () => {
    expect(patientTurnTaking({ onboarding: true })).toBe(true);
    expect(patientTurnTaking({ welcome: true })).toBe(true);
    expect(patientTurnTaking({ discovery: true })).toBe(true);
    expect(patientTurnTaking({})).toBe(false);
  });
});
