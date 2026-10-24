import { describe, expect, it } from "vitest";

import {
  TURN_READER_V61,
  TURN_READER_V62,
  TurnReaderV62ResultSchema,
  V49_TEAM_JOB,
  V61_BOARD_ASK,
  V62_BOARD_SCREEN,
  V62_DEEP_WORK,
  V62_WORK_FROM_EARLIER,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * TURN_READER v62 (analyst lane QO-07, 2026-10-23): analysis or strategy
 * work ending in a document is a team job even as one document, and a yes
 * to work offered just before hands it over (workFromEarlier).
 */
describe("TURN_READER v62", () => {
  it("is the active reader, v61 kept whole plus two rules after TEAM JOB", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(62);
    expect(TURN_READER_V61.status).toBe("DEPRECATED");
    const added = `${V62_DEEP_WORK}${V62_WORK_FROM_EARLIER}`;
    expect(TURN_READER_V62.template).toContain(`${V49_TEAM_JOB}${added}`);
    expect(TURN_READER_V62.template).toContain(
      `${V61_BOARD_ASK}${V62_BOARD_SCREEN}`,
    );
    expect(
      TURN_READER_V62.template.replace(added, "").replace(V62_BOARD_SCREEN, ""),
    ).toBe(TURN_READER_V61.template);
    expect(V62_BOARD_SCREEN).toMatch(/NAVIGATE with destination BOARD/u);
    expect(V62_BOARD_SCREEN).toContain("open my board");
  });

  it("carries the analyst lane's cases, read by meaning", () => {
    for (const said of [
      "write me a 12-month plan",
      "put together a growth strategy for us",
      "I need a market study for Lagos",
      "fais-moi une étude de marché pour Lagos",
    ]) {
      expect(V62_DEEP_WORK, said).toContain(said);
    }
    expect(V62_DEEP_WORK).toMatch(/teamJob is true/u);
    expect(V62_DEEP_WORK).toMatch(/deck, one-pager or memo/u);
    for (const said of ["yes", "go ahead", "please do", "oui, vas-y"]) {
      expect(V62_WORK_FROM_EARLIER, said).toContain(`"${said}"`);
    }
    expect(V62_WORK_FROM_EARLIER).toMatch(/do that/u);
    expect(V62_WORK_FROM_EARLIER).toMatch(
      /A yes to an offer to SEND something to someone is not deep work/u,
    );
  });

  it("is lenient: absent or malformed workFromEarlier reads as false", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    expect(TurnReaderV62ResultSchema.parse(base).workFromEarlier).toBe(false);
    expect(
      TurnReaderV62ResultSchema.parse({ ...base, workFromEarlier: "yes" })
        .workFromEarlier,
    ).toBe(false);
    expect(
      TurnReaderV62ResultSchema.parse({ ...base, workFromEarlier: true })
        .workFromEarlier,
    ).toBe(true);
  });
});
