import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V73,
  TURN_READER_V74,
  TurnReaderV74ResultSchema,
  V52_NEXT_STEPS,
  V74_NEXT_STEPS_ANY_KIND,
  V74_OFFER_TAKEN,
} from "../src/index.js";

/**
 * Live 2026-10-30 (founder.ledgerbridge, "What should I do today?" x3):
 * two of three runs read THEIR_OWN_RECORDS, not ADVICE, and lost code's
 * priorities and plan offer; a "yes" to Q's offer was re-guessed into
 * account settings. v74 reads nextSteps beside the question's class and
 * the offer taken as its own field.
 */
describe("TURN_READER v74", () => {
  it("is the active reader: v73 with the NEXT STEPS rule extended, nothing else", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(74);
    expect(registry.get("TURN_READER", 73)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(
      TURN_READER_V74.template.replace(
        `${V52_NEXT_STEPS}${V74_NEXT_STEPS_ANY_KIND}${V74_OFFER_TAKEN}`,
        V52_NEXT_STEPS,
      ),
    ).toBe(TURN_READER_V73.template);
    expect(V74_NEXT_STEPS_ANY_KIND).toContain(
      "whether you read the question as ADVICE or as THEIR_OWN_RECORDS",
    );
    expect(V74_OFFER_TAKEN).toMatch(/false when they decline/u);
  });

  it("reads acceptsOffer leniently: absent or malformed is false, never a lost reading", () => {
    const base = TurnReaderV74ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
    });
    expect(base.acceptsOffer).toBe(false);
    expect(
      TurnReaderV74ResultSchema.parse({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        acceptsOffer: "yes please",
      }).acceptsOffer,
    ).toBe(false);
    expect(
      TurnReaderV74ResultSchema.parse({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        acceptsOffer: true,
      }).acceptsOffer,
    ).toBe(true);
  });
});
