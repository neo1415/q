import { describe, expect, it } from "vitest";

import {
  CounterpartPersonaLenientSchema,
  CounterpartPersonaResultSchema,
  createDefaultPromptRegistry,
  normaliseCounterpartPersona,
  normaliseRehearsalReview,
  RehearsalReviewLenientSchema,
  RehearsalReviewResultSchema,
} from "../src/index.js";

/**
 * REHEARSE audit (live 2026-10-01): v2 persona readings were refused whole
 * for "priorities:too_big" and "style:too_big", so no rehearsal could
 * start. The model answers a lenient shape and code trims it.
 */
describe("lenient rehearsal readings", () => {
  const long = (n: number) => "word ".repeat(n).trim();

  it("keeps a persona whose lists and lines run long", () => {
    const loose = CounterpartPersonaLenientSchema.parse({
      summary: long(150),
      style: long(120),
      temperament: {
        baseline: "SKEPTICAL",
        warmsTo: Array.from({ length: 9 }, () => "clear numbers"),
        coolsOn: Array.from({ length: 9 }, () => "vague answers"),
      },
      priorities: Array.from({ length: 9 }, (_, i) => `priority ${String(i)}`),
      likelyQuestions: [{ question: "What is your churn?", why: "Retention" }],
      likelyAnswers: [],
      pushbacks: Array.from({ length: 8 }, () => "asks for proof"),
      howToWin: Array.from({ length: 8 }, () => "bring cohorts"),
      dealbreakers: Array.from({ length: 8 }, () => "no traction"),
      grounding: "SOME",
    });
    const stored = normaliseCounterpartPersona(loose);
    expect(CounterpartPersonaResultSchema.safeParse(stored).success).toBe(true);
    expect(stored.priorities).toHaveLength(6);
    expect(stored.style.length).toBeLessThanOrEqual(300);
    expect(stored.style.endsWith("…")).toBe(true);
  });

  it("keeps a review whose notes run long, one rating per dimension", () => {
    const loose = RehearsalReviewLenientSchema.parse({
      overall: long(200),
      dimensions: [
        { name: "CLARITY", rating: "STRONG", note: long(100) },
        { name: "CLARITY", rating: "SOLID", note: "again" },
        { name: "EVIDENCE", rating: "NEEDS_WORK", note: "No numbers given." },
      ],
      wentRight: [],
      wentWrong: [],
      tips: Array.from({ length: 9 }, () => "Lead with retention."),
    });
    const stored = normaliseRehearsalReview(loose);
    expect(RehearsalReviewResultSchema.safeParse(stored).success).toBe(true);
    expect(stored.dimensions.map((d) => d.name)).toEqual([
      "CLARITY",
      "EVIDENCE",
    ]);
    expect(stored.tips).toHaveLength(6);
  });

  it("is what the active persona and review prompts ask for", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("INVESTOR_PERSONA").definition.version).toBe(3);
    expect(registry.getActive("REHEARSAL_SCORE").definition.version).toBe(4);
    expect(registry.getActive("INVESTOR_TWIN_TURN").definition.version).toBe(4);
  });
});
