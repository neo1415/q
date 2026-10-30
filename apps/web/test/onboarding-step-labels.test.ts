import { describe, expect, it } from "vitest";

import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_CURRENT } from "@capital-q/investor-onboarding";

import { FOUNDER_VOCABULARY } from "../src/features/founder-onboarding/conversation-adapter";
import { INVESTOR_VOCABULARY } from "../src/features/investor-onboarding/conversation-adapter";

/**
 * Live recheck 2026-10-30: the "I picked up" cards after an upload and the
 * read-back's pending card were labelled "What is your long-term vision
 * for the company? · ...": a step without a title fell back to its
 * question. Every card, acknowledgement and review line names a step by
 * `stepTitle`; it is the step's plain label for every step of both
 * journeys, never its question and never its key.
 */
describe("a step is named by its plain label", () => {
  for (const [journey, definition, vocabulary] of [
    ["founder", FOUNDER_DEFINITION_CURRENT, FOUNDER_VOCABULARY],
    ["investor", INVESTOR_DEFINITION_CURRENT, INVESTOR_VOCABULARY],
  ] as const) {
    it(`${journey}: no step's title is a question or a key`, () => {
      for (const step of definition.steps) {
        const title = vocabulary.stepTitle(step.stepKey);
        expect(title, step.stepKey).not.toBe(step.stepKey);
        if (step.configuration.prompt.trim().endsWith("?")) {
          expect(title, step.stepKey).not.toBe(step.configuration.prompt);
        }
      }
    });
  }

  it("the vision section is 'Our Vision', not its question", () => {
    expect(FOUNDER_VOCABULARY.stepTitle("F9.vision")).toBe("Our Vision");
    expect(FOUNDER_VOCABULARY.stepTitle("F5.monthly_burn")).toBe(
      "Monthly burn",
    );
  });
});
