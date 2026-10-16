import { describe, expect, it } from "vitest";

import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";

import { PERSONALITY_NOTES } from "../src/voice/standing.js";
import { SPOKEN_QUESTIONS } from "../src/voice/step-copy.js";
import {
  onboardingLanguageNote,
  SPOKEN_QUESTIONS_AR,
  withQuestionsInLanguage,
} from "../src/voice/step-copy-language.js";

/**
 * Multilingual Q, live 2026-10-16 (scenario 14): an Arabic interview had
 * "Here's what I understood. Does it look right?" and "How many founders?"
 * added in English by the code that keeps a question at the end of a turn.
 * Any language now: the shared translation layer; Arabic's hand copy wins.
 */
const founderSteps = FOUNDER_DEFINITION_CURRENT.steps;
const noMachine = (lines: readonly string[]) =>
  Promise.resolve(lines.map(() => null));
const tagged = (tag: string) => (lines: readonly string[]) =>
  Promise.resolve(lines.map((line) => `[${tag}] ${line}`));

describe("the questions code adds, in the person's language", () => {
  it("Arabic: the hand-written question, the model's words kept", async () => {
    expect(
      await withQuestionsInLanguage(
        "مؤسستان، أنتِ وخالد، محفوظتان. Are the founders full-time?",
        founderSteps,
        SPOKEN_QUESTIONS,
        "ar",
        noMachine,
      ),
    ).toBe("مؤسستان، أنتِ وخالد، محفوظتان. هل يعمل المؤسسون بدوام كامل؟");
  });

  it("any other language: through the shared layer, only the English line", async () => {
    const asked: string[] = [];
    const out = await withQuestionsInLanguage(
      "Merci, c'est noté. How many founders?",
      founderSteps,
      SPOKEN_QUESTIONS,
      "fr",
      (lines) => {
        asked.push(...lines);
        return tagged("fr")(lines);
      },
    );
    expect(asked).toEqual(["How many founders?"]);
    expect(out).toBe("Merci, c'est noté. [fr] How many founders?");
  });

  it("the optional tail too; English and untranslated lines stay as they are", async () => {
    const reply =
      "Sawa. What's your website? We can come back to this if you'd rather skip it.";
    expect(
      await withQuestionsInLanguage(
        reply,
        founderSteps,
        SPOKEN_QUESTIONS,
        "sw",
        tagged("sw"),
      ),
    ).toBe(
      "Sawa. [sw] What's your website? [sw] We can come back to this if you'd rather skip it.",
    );
    expect(
      await withQuestionsInLanguage(
        reply,
        founderSteps,
        SPOKEN_QUESTIONS,
        "en-GB",
        tagged("x"),
      ),
    ).toBe(reply);
    expect(
      await withQuestionsInLanguage(
        reply,
        founderSteps,
        SPOKEN_QUESTIONS,
        "sw",
        noMachine,
      ),
    ).toBe(reply);
  });

  it("Arabic's hand copy covers every founder and investor step", () => {
    const missing = [...founderSteps, ...INVESTOR_DEFINITION_V1.steps].filter(
      (step) => SPOKEN_QUESTIONS_AR[step.stepKey] === undefined,
    );
    expect(missing.map((step) => step.stepKey)).toEqual([]);
  });

  it("the interviewer's note is generic and fits beside any personality", () => {
    expect(onboardingLanguageNote(null)).toBe("");
    expect(onboardingLanguageNote("en")).toBe("");
    for (const tag of ["ar", "sw", "fr", "zh"]) {
      const note = onboardingLanguageNote(tag);
      expect(note).toMatch(/ask each of them in their language/u);
      for (const personality of Object.values(PERSONALITY_NOTES)) {
        expect(`${personality} ${note}`.length).toBeLessThanOrEqual(1_200);
      }
    }
  });
});
