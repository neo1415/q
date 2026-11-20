import { describe, expect, it } from "vitest";

import {
  answerPlanOf,
  createDefaultPromptRegistry,
  discoveryTurn,
  INITIAL_CONVERSATION_STATE,
  TURN_READER_V95,
  TURN_READER_V96,
  TURN_SKIM_V12,
  TURN_SKIM_V13,
  TurnReaderV96ResultSchema,
  TurnSkimV13ResultSchema,
  V13_SEEKS_GUIDANCE,
  V92_RULES_END_BEFORE,
  V96_SEEKS_GUIDANCE,
} from "../src/index.js";

/**
 * HQ-5 follow-up (live, fictional Savanna: "I'm not really sure what I'm
 * looking for right now" got a suggestion and no question): seeking
 * guidance is read by meaning (TURN_SKIM v13, TURN_READER v96) and opens
 * discovery on the first turn.
 */
describe("seeksGuidance (TURN_SKIM v13, TURN_READER v96)", () => {
  const registry = createDefaultPromptRegistry();

  it("are active, add one rule each, with v12 and v95 deprecated", () => {
    expect(registry.getActive("TURN_SKIM").definition.version).toBe(13);
    expect(registry.getActive("TURN_READER").definition.version).toBe(96);
    expect(registry.get("TURN_SKIM", 12)?.definition.status).toBe("DEPRECATED");
    expect(registry.get("TURN_READER", 95)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(TURN_SKIM_V13.template.replace(V13_SEEKS_GUIDANCE, "")).toBe(
      TURN_SKIM_V12.template,
    );
    expect(TURN_READER_V96.template.replace(` ${V96_SEEKS_GUIDANCE}`, "")).toBe(
      TURN_READER_V95.template,
    );
    const at = TURN_READER_V96.template.indexOf(V96_SEEKS_GUIDANCE);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(
      TURN_READER_V96.template.indexOf(V92_RULES_END_BEFORE),
    );
  });

  it("reads leniently: absent or malformed is false", () => {
    expect(
      TurnSkimV13ResultSchema.parse({ kind: "OTHER", confidence: "HIGH" })
        .seeksGuidance,
    ).toBe(false);
    expect(
      TurnSkimV13ResultSchema.parse({
        kind: "OTHER",
        confidence: "HIGH",
        seeksGuidance: "yes",
      }).seeksGuidance,
    ).toBe(false);
    const field = TurnReaderV96ResultSchema.shape.seeksGuidance;
    expect(field.parse(true)).toBe(true);
    expect(field.parse(undefined)).toBe(false);
    expect(field.parse("yes")).toBe(false);
  });

  it("opens discovery on the first turn, as Savanna's turn should have", () => {
    // How her turn was read: advice, nothing else unclear.
    const plan = answerPlanOf({
      answerKinds: ["CHAT"],
      questionKind: "ADVICE",
      turnKind: "QUESTION_TO_Q",
      seeksGuidance: true,
    });
    expect(plan).toEqual({ shape: "DISCOVERY", then: null });
    const decided = discoveryTurn(INITIAL_CONVERSATION_STATE, {
      words: "I'm not really sure what I'm looking for right now",
      discoveryShape: plan?.shape === "DISCOVERY",
      underspecified: false,
      task: false,
      coverage: { side: "INVESTOR", known: ["SECTORS"] },
    });
    expect(decided.turn?.kind).toBe("ASK");
    // Without the signal, the same reading is advice, as it was live.
    expect(
      answerPlanOf({
        answerKinds: ["CHAT"],
        questionKind: "ADVICE",
        turnKind: "QUESTION_TO_Q",
      })?.shape,
    ).toBe("ADVICE");
  });
});
