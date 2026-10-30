import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V72,
  TURN_READER_V73,
  V72_PLAN_ASK,
  V73_PLAN_ASK,
  V73_PLAN_OFFER_TAKEN,
} from "../src/index.js";

/**
 * Owner 2026-10-30: "What should I do today?" is answered in the
 * conversation and closes with Q's offer to build a full plan. Taking Q up
 * on it is the plan ask -- read by meaning, never a word list in code.
 */
describe("TURN_READER v73: a yes to Q's offer of a plan is the plan ask", () => {
  it("is the active reader: v72 with only its PLAN ASK rule extended", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(73);
    expect(active.output).toEqual(TURN_READER_V72.output);
    expect(TURN_READER_V73.template.replace(V73_PLAN_ASK, V72_PLAN_ASK)).toBe(
      TURN_READER_V72.template,
    );
    expect(registry.get("TURN_READER", 72)?.definition.status).toBe(
      "DEPRECATED",
    );
  });

  it("keeps v72's rule and adds the offer taken, with the no-case", () => {
    expect(V73_PLAN_ASK.startsWith(V72_PLAN_ASK.trimEnd())).toBe(true);
    expect(V73_PLAN_ASK).toContain(V73_PLAN_OFFER_TAKEN);
    expect(V73_PLAN_OFFER_TAKEN).toContain(
      "planAsk {kind GOAL, subject OWN, deliverable PLAN}",
    );
    expect(V73_PLAN_OFFER_TAKEN).toMatch(/or decline, planAsk stays null/u);
    // The light question itself is still answered, not planned.
    expect(V73_PLAN_ASK).toContain(
      '"what should I do today?" is planAsk null with nextSteps true',
    );
  });
});
