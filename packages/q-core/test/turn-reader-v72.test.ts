import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V71,
  TURN_READER_V72,
  V71_PLAN_ASK,
  V72_PLAN_ASK,
} from "../src/index.js";

/**
 * Q-page sweep 2026-10-29 (F14): "What should I do today?" started a
 * three-minute plan job. v72 tells a plan from a question about what to do
 * now -- by meaning, with cases, never a phrase list in code.
 */
describe("TURN_READER v72: a question about what to do now is not a plan", () => {
  it("is v71 with only its PLAN ASK rule replaced", () => {
    const registry = createDefaultPromptRegistry();
    const v72 = registry.get("TURN_READER", 72)?.definition;
    expect(v72?.output).toEqual(TURN_READER_V71.output);
    expect(TURN_READER_V72.template.replace(V72_PLAN_ASK, V71_PLAN_ASK)).toBe(
      TURN_READER_V71.template,
    );
  });

  it("answers what to do now in the conversation, and keeps plans for plans", () => {
    expect(V72_PLAN_ASK).toContain(
      '"what should I do today?" is planAsk null with nextSteps true',
    );
    expect(V72_PLAN_ASK).toContain(
      '"plan my raise over the next 8 weeks" is planAsk {kind GOAL, subject OWN, deliverable PLAN}',
    );
    expect(V72_PLAN_ASK).toMatch(/in any words and any language/u);
    // v71's GOAL example that made a light question a plan is gone.
    expect(V71_PLAN_ASK).toContain('"what should I do this week?"');
    expect(V72_PLAN_ASK).not.toContain('"what should I do this week?"');
  });
});
