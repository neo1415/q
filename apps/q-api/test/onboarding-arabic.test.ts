import { describe, expect, it } from "vitest";

import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";

import { PERSONALITY_NOTES } from "../src/voice/standing.js";
import { SPOKEN_QUESTIONS } from "../src/voice/step-copy.js";
import {
  ONBOARDING_ARABIC_NOTE,
  SPOKEN_QUESTIONS_AR,
  withArabicQuestions,
} from "../src/voice/step-copy-ar.js";

/**
 * Multilingual Q, live 2026-10-16 (scenario 14): an Arabic interview had
 * "Here's what I understood. Does it look right?" and "How many founders?"
 * added in English by the code that keeps a question at the end of a turn.
 */
const founderSteps = FOUNDER_DEFINITION_CURRENT.steps;

describe("the onboarding interview in Arabic", () => {
  it("asks the code-added question in Arabic and keeps the model's words", () => {
    const reply = "مؤسستان، أنتِ وخالد، محفوظتان. Are the founders full-time?";
    expect(withArabicQuestions(reply, founderSteps, SPOKEN_QUESTIONS)).toBe(
      "مؤسستان، أنتِ وخالد، محفوظتان. هل يعمل المؤسسون بدوام كامل؟",
    );
    expect(
      withArabicQuestions(
        "تم حفظ وصف الشركة. Here's what I understood. Does it look right?",
        founderSteps,
        SPOKEN_QUESTIONS,
      ),
    ).toBe("تم حفظ وصف الشركة. هذا ما فهمته. هل يبدو صحيحاً؟");
  });

  it("puts the optional tail and the finish question in Arabic", () => {
    expect(
      withArabicQuestions(
        "حسناً. What's your website? We can come back to this if you'd rather skip it.",
        founderSteps,
        SPOKEN_QUESTIONS,
      ),
    ).toBe("حسناً. ما موقعك الإلكتروني؟ يمكننا العودة إلى هذا إن فضّلت تخطيه.");
  });

  it("leaves names and figures as written", () => {
    const reply = "Rimal Freight تجمع USD 1.5m. How many founders?";
    expect(withArabicQuestions(reply, founderSteps, SPOKEN_QUESTIONS)).toBe(
      "Rimal Freight تجمع USD 1.5m. كم عدد المؤسسين؟",
    );
  });

  it("has Arabic for every founder and investor step", () => {
    const missing = [...founderSteps, ...INVESTOR_DEFINITION_V1.steps].filter(
      (step) => SPOKEN_QUESTIONS_AR[step.stepKey] === undefined,
    );
    expect(missing.map((step) => step.stepKey)).toEqual([]);
  });

  it("fits the language note beside any personality", () => {
    for (const note of Object.values(PERSONALITY_NOTES)) {
      expect(`${note} ${ONBOARDING_ARABIC_NOTE}`.length).toBeLessThanOrEqual(
        1_200,
      );
    }
  });
});
