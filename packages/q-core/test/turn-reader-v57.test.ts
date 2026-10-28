import { describe, expect, it } from "vitest";

import {
  TURN_READER_V56,
  TURN_READER_V57,
  V53_Q_PITCH,
  V57_WHAT_IS_CAPITAL_Q,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Q Story (owner 2026-10-21): "present / pitch Capital Q" opens the story;
 * a bare "What is Capital Q?" is answered briefly, never a seven-minute
 * film unasked (plan §4).
 */
describe("TURN_READER v57: what Capital Q is, asked alone, is not Q_PITCH", () => {
  it("was the active reader (v58 now), v56 kept whole plus one Q PITCH exception", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(70);
    expect(TURN_READER_V56.status).toBe("DEPRECATED");
    expect(TURN_READER_V57.template).toContain(
      `${V53_Q_PITCH}${V57_WHAT_IS_CAPITAL_Q}`,
    );
    expect(TURN_READER_V57.template.replace(V57_WHAT_IS_CAPITAL_Q, "")).toBe(
      TURN_READER_V56.template,
    );
    expect(TURN_READER_V57.output).toBe(TURN_READER_V56.output);
  });

  it("reads by meaning in any language, and keeps the story's own triggers", () => {
    expect(V57_WHAT_IS_CAPITAL_Q).toMatch(/by what it means, in any language/u);
    expect(V57_WHAT_IS_CAPITAL_Q).toMatch(/NOT Q_PITCH and has no tool/u);
    for (const said of [
      "what is Capital Q?",
      "c'est quoi Capital Q ?",
      "present Capital Q",
      "pitch Capital Q",
      "tell me your story",
      "yes, show me",
    ]) {
      expect(V57_WHAT_IS_CAPITAL_Q).toContain(said);
    }
  });
});
