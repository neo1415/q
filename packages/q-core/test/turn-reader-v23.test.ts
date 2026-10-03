import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V22,
  TURN_READER_V22_HAND_OVER,
  TURN_READER_V23,
  TURN_READER_V23_HAND_OVER,
} from "../src/index.js";

/**
 * TURN_READER v23 (QA live 2026-10-01): "handle this for me" was not read
 * as a hand-over. Varied examples guide the reading; a question about
 * meetings is still not one.
 */
describe("TURN_READER v23", () => {
  it("is the active reader; v22 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(36);
    expect(TURN_READER_V22.status).toBe("DEPRECATED");
  });

  it("changes only the hand-over line, keeping the schema", () => {
    expect(TURN_READER_V23.output).toBe(TURN_READER_V22.output);
    expect(
      TURN_READER_V23.template.replace(
        TURN_READER_V23_HAND_OVER,
        TURN_READER_V22_HAND_OVER,
      ),
    ).toBe(TURN_READER_V22.template);
  });

  it("guides with a short form, another language or register, and an implied one, and keeps the negative", () => {
    expect(TURN_READER_V23_HAND_OVER).toContain("handle this for me");
    expect(TURN_READER_V23_HAND_OVER).toContain("occupe-toi");
    expect(TURN_READER_V23_HAND_OVER).toContain("take it from here");
    expect(TURN_READER_V23_HAND_OVER).toContain("A question about meetings");
  });
});
