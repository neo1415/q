import { describe, expect, it } from "vitest";

import {
  TURN_READER_V60,
  TURN_READER_V61,
  TurnReaderV61ResultSchema,
  V60_ANSWERING_INTEREST,
  V61_BOARD_ASK,
  V61_INTEREST_WITH_NOTE,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * TURN_READER v61 (2026-10-23): the live v60 kept whole, plus the
 * work-board lane's boardAsk (S1, with its ten eval cases) and QO-08 (a
 * note expressing interest to founders not connected is Express Interest
 * with that note, never a question back).
 */
describe("TURN_READER v61", () => {
  it("v60 kept whole plus two readings (v63 is active)", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(75);
    expect(TURN_READER_V60.status).toBe("DEPRECATED");
    const added = `${V61_INTEREST_WITH_NOTE}${V61_BOARD_ASK}`;
    expect(TURN_READER_V61.template).toContain(
      `${V60_ANSWERING_INTEREST}${added}`,
    );
    expect(TURN_READER_V61.template.replace(added, "")).toBe(
      TURN_READER_V60.template,
    );
  });

  it("reads boardAsk for their own work board, with the work-board lane's cases (S1)", () => {
    for (const said of [
      "save that plan to my board",
      "put this on my board",
      "keep Kestrel on my board",
      "break it into tasks",
      "save the plan and split it into to-dos",
      "work on those items for me",
      "start on the hiring task",
      "what's on my board?",
      "guarda esto en mi tablero",
    ]) {
      expect(V61_BOARD_ASK, said).toContain(said);
    }
    expect(V61_BOARD_ASK).toMatch(/BREAKDOWN over SAVE/u);
    expect(V61_BOARD_ASK).toMatch(/GateQ inbox or board/u);
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    expect(TurnReaderV61ResultSchema.parse(base).boardAsk).toBeNull();
    expect(
      TurnReaderV61ResultSchema.parse({ ...base, boardAsk: "PIN" }).boardAsk,
    ).toBeNull();
    expect(
      TurnReaderV61ResultSchema.parse({ ...base, boardAsk: "WORK" }).boardAsk,
    ).toBe("WORK");
  });

  it("reads a note expressing interest as Express Interest with the note (QO-08)", () => {
    expect(V61_INTEREST_WITH_NOTE).toContain(
      "draft a note to the Duplo founders expressing interest, don't send",
    );
    expect(V61_INTEREST_WITH_NOTE).toMatch(/Express Interest with that note/u);
    expect(V61_INTEREST_WITH_NOTE).toMatch(/never a reason to ask first/u);
  });
});
