import { describe, expect, it } from "vitest";

import {
  INVESTOR_TWIN_TURN_V13,
  INVESTOR_TWIN_TURN_V14,
  RehearsalTurnV10ResultSchema,
  V14_STANCE,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Owner 2026-10-24 (rehearsal room upgrade): the room's stance tag (Asks,
 * Disagrees, Decides) comes from the played line itself, said by the model
 * that wrote it, never guessed by code from its words.
 */
describe("INVESTOR_TWIN_TURN v14: the line's stance", () => {
  it("is active, v13 kept whole plus the stance", () => {
    const active =
      createDefaultPromptRegistry().getActive("INVESTOR_TWIN_TURN");
    expect(active.definition.version).toBe(14);
    expect(INVESTOR_TWIN_TURN_V14.template).toContain(V14_STANCE);
    expect(INVESTOR_TWIN_TURN_V14.template).toContain("beats, stance).");
    expect(INVESTOR_TWIN_TURN_V14.template.length).toBeGreaterThan(
      INVESTOR_TWIN_TURN_V13.template.length,
    );
    expect(V14_STANCE).toMatch(/by what it means in any language/u);
  });

  it("takes one of the three stances, or none", () => {
    const base = {
      appraisal: "NEUTRAL",
      line: "What's your churn?",
      move: "QUESTION",
      mood: "SKEPTICAL",
      intensity: "NORMAL",
      reaction: null,
      conclusion: null,
      presence: null,
      askedToSee: false,
      wantsToEnd: false,
      onlyNoise: false,
      screenNote: null,
      beats: [],
    };
    expect(
      RehearsalTurnV10ResultSchema.safeParse({ ...base, stance: "ASKS" })
        .success,
    ).toBe(true);
    expect(
      RehearsalTurnV10ResultSchema.safeParse({ ...base, stance: null }).success,
    ).toBe(true);
    expect(
      RehearsalTurnV10ResultSchema.safeParse({ ...base, stance: "AGREES" })
        .success,
    ).toBe(false);
  });
});
