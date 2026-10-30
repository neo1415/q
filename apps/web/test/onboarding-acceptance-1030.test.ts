import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";

import {
  screenOnlyQuestion,
  settledByFamily,
  withAnswered,
} from "../src/features/onboarding-conversation/conversation";

/**
 * Live MVP acceptance 2026-10-30 (production 4bcfa584b, typed): what the
 * screen tells the conversation Q reads, and what it does not ask again.
 */
describe("the question the person answered reaches Q's conversation (Hydrolume)", () => {
  const review = "Here's what I understood. Does it look right?";

  it("a question the screen showed from the step is not Q's line, so it is kept", () => {
    expect(screenOnlyQuestion(review, null)).toBe(true);
    expect(
      screenOnlyQuestion(review, { stepKey: "F4.functions", text: "Team?" }),
    ).toBe(true);
  });

  it("Q's own line is already in the conversation", () => {
    expect(
      screenOnlyQuestion("Team? ", { stepKey: "F4.functions", text: "Team?" }),
    ).toBe(false);
  });

  it("the turns sent end on the question answered, so two identical yeses to two questions differ", () => {
    const recent = [
      { role: "q" as const, text: "The problem is spoilage. Is that right?" },
      { role: "person" as const, text: "yes" },
    ];
    const sent = withAnswered(recent, "The solution is probes. Is that right?");
    expect(sent.at(-1)).toEqual({
      role: "q",
      text: "The solution is probes. Is that right?",
    });
    // Already last: not added twice.
    expect(
      withAnswered(sent, "The solution is probes. Is that right?"),
    ).toHaveLength(sent.length);
    expect(withAnswered(recent, null)).toEqual(recent);
  });
});

describe("an answered concept is not asked again in other words (Kortrijk Polder)", () => {
  const viewWith = (
    rows: { stepKey: string; required: boolean; status: string }[],
    journeyType: "investor" | "founder" = "investor",
  ) =>
    ({
      session: { journeyType },
      progress: { eligibleSteps: rows },
    }) as unknown as OnboardingSessionView;

  it("sectors to exclude outright, after the sectors to avoid were saved, is settled", () => {
    const view = viewWith([
      { stepKey: "I3.sectors_avoid", required: false, status: "COMPLETED" },
      { stepKey: "I7.sector_exclusions", required: false, status: "PENDING" },
    ]);
    expect(settledByFamily(view, "I7.sector_exclusions")).toBe(true);
  });

  it("nothing in the family answered, or a required step, or a founder: asked as usual", () => {
    expect(
      settledByFamily(
        viewWith([
          { stepKey: "I3.sectors_avoid", required: false, status: "PENDING" },
          {
            stepKey: "I7.sector_exclusions",
            required: false,
            status: "PENDING",
          },
        ]),
        "I7.sector_exclusions",
      ),
    ).toBe(false);
    expect(
      settledByFamily(
        viewWith([
          { stepKey: "I3.sectors_avoid", required: false, status: "COMPLETED" },
          {
            stepKey: "I7.sector_exclusions",
            required: true,
            status: "PENDING",
          },
        ]),
        "I7.sector_exclusions",
      ),
    ).toBe(false);
    expect(
      settledByFamily(
        viewWith(
          [
            {
              stepKey: "I3.sectors_avoid",
              required: false,
              status: "COMPLETED",
            },
            {
              stepKey: "I7.sector_exclusions",
              required: false,
              status: "PENDING",
            },
          ],
          "founder",
        ),
        "I7.sector_exclusions",
      ),
    ).toBe(false);
  });
});
