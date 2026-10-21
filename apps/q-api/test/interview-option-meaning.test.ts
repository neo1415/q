import { describe, expect, it } from "vitest";

import type { OnboardingStepManifest } from "@capital-q/onboarding";

import { toResponseValue } from "../src/voice/interview-steps.js";

/**
 * Founder order 2026-10-02: "no fixed phrases, let Q judge by meaning".
 * An option is matched by its key or label as the model read it; a list
 * of English negatives no longer turns words into "nothing yet".
 */
const step = {
  stepKey: "F2.materials",
  configuration: {
    stepType: "single_select",
    options: [
      { optionKey: "deck", label: "Pitch deck", description: "" },
      { optionKey: "nothing_yet", label: "Nothing yet", description: "" },
      { optionKey: "other", label: "Other", description: "" },
    ],
  },
} as unknown as OnboardingStepManifest;

describe("an option chosen by meaning", () => {
  it("takes the option the reading names, by key or label", () => {
    expect(toResponseValue(step, "nothing_yet")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "nothing_yet",
    });
    expect(toResponseValue(step, "Nothing yet")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "nothing_yet",
    });
  });

  it("does not guess 'nothing yet' from words such as 'no' or 'pas encore'", () => {
    for (const words of [
      "no deck yet, sorry",
      "pas encore",
      "we haven't got one",
    ]) {
      expect(toResponseValue(step, words), words).toEqual({
        type: "SINGLE_SELECT",
        optionKey: "other",
      });
    }
  });
});

describe("a text answer longer than its step holds (owner 2026-10-21)", () => {
  const short = {
    stepKey: "F1.company_name",
    configuration: { stepType: "short_text", minLength: 1, maxLength: 20 },
  } as unknown as OnboardingStepManifest;

  it("is kept up to the limit, cut at a word, never refused", () => {
    expect(
      toResponseValue(short, "Quillmark Health Systems of Nairobi"),
    ).toEqual({ type: "TEXT", text: "Quillmark Health" });
    expect(toResponseValue(short, "Quillmark")).toEqual({
      type: "TEXT",
      text: "Quillmark",
    });
  });
});
