import { describe, expect, it } from "vitest";

import {
  TURN_READER_V62,
  TURN_READER_V63,
  TurnReaderV63ResultSchema,
  V61_BOARD_ASK,
  V63_BOARD_LIST_ADD,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * TURN_READER v63 (coordinator and work-board lane, QA live 2026-10-24):
 * boardAsk gains LIST and ADD; the live v62 kept whole.
 */
describe("TURN_READER v63", () => {
  it("is the active reader, v62 kept whole plus LIST and ADD", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(72);
    expect(TURN_READER_V62.status).toBe("DEPRECATED");
    expect(TURN_READER_V63.template).toContain(
      `${V61_BOARD_ASK}${V63_BOARD_LIST_ADD}`,
    );
    expect(TURN_READER_V63.template.replace(V63_BOARD_LIST_ADD, "")).toBe(
      TURN_READER_V62.template,
    );
  });

  it("reads LIST and ADD by meaning, SAVE/BREAKDOWN/WORK first, with the live phrasings", () => {
    for (const said of [
      "what's on my board?",
      "show my work board",
      "what's in my to-dos",
      "qu'y a-t-il sur mon tableau ?",
      "add 'Prep IC memo for Mizan' to my board",
      "put 'call Kestrel on Friday' on my to-dos",
    ]) {
      expect(V63_BOARD_LIST_ADD, said).toContain(said);
    }
    expect(V63_BOARD_LIST_ADD).toMatch(
      /SAVE, BREAKDOWN and WORK win over LIST/u,
    );
    expect(V63_BOARD_LIST_ADD).toMatch(/stays SAVE, not ADD/u);
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    for (const ask of ["LIST", "ADD", "SAVE", "BREAKDOWN", "WORK"]) {
      expect(
        TurnReaderV63ResultSchema.parse({ ...base, boardAsk: ask }).boardAsk,
      ).toBe(ask);
    }
    expect(
      TurnReaderV63ResultSchema.parse({ ...base, boardAsk: "PIN" }).boardAsk,
    ).toBeNull();
  });
});
