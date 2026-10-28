import { describe, expect, it } from "vitest";

import {
  TURN_READER_V61,
  TURN_READER_V62,
  TurnReaderV62ResultSchema,
  V49_TEAM_JOB,
  V61_BOARD_ASK,
  V62_BOARD_SCREEN,
  V62_COMPARE,
  V62_DEEP_WORK,
  compareOverFromShown,
  V62_WORK_FROM_EARLIER,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * TURN_READER v62 (analyst lane QO-07, 2026-10-23): analysis or strategy
 * work ending in a document is a team job even as one document, and a yes
 * to work offered just before hands it over (workFromEarlier).
 */
describe("TURN_READER v62", () => {
  it("v61 kept whole plus two rules after TEAM JOB (v63 is active)", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(70);
    expect(TURN_READER_V61.status).toBe("DEPRECATED");
    const added = `${V62_DEEP_WORK}${V62_WORK_FROM_EARLIER}`;
    expect(TURN_READER_V62.template).toContain(`${V49_TEAM_JOB}${added}`);
    expect(TURN_READER_V62.template).toContain(
      `${V61_BOARD_ASK}${V62_BOARD_SCREEN}${V62_COMPARE}`,
    );
    expect(
      TURN_READER_V62.template
        .replace(added, "")
        .replace(`${V62_BOARD_SCREEN}${V62_COMPARE}`, ""),
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

  it("reads 'board' as their work board, never readiness, and a founder's fundraising pipeline as the pipeline (coordinator 2026-10-24)", () => {
    expect(V62_BOARD_SCREEN).toContain(
      `"what's on my board?" asks what is on it`,
    );
    expect(V62_BOARD_SCREEN).toMatch(/never about their readiness checklist/u);
    expect(V62_BOARD_SCREEN).toMatch(
      /fundraising pipeline" is their investor relationships pipeline/u,
    );
  });

  it("reads compare with lane 8's cases, and never with fromShown", () => {
    for (const said of [
      "compare the top two in a table",
      "put the first three side by side",
      "how do they stack up?",
      "compare-les",
      "which is better, Mizan or Silo Credit?",
      "Ledgerline, Duplo and Anchor",
      "what was the second one's raise?",
      "compare my raise to the market",
    ]) {
      expect(V62_COMPARE, said).toContain(said);
    }
    expect(V62_COMPARE).toMatch(/compare is never set with fromShown/u);
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    const parsed = TurnReaderV62ResultSchema.parse({
      ...base,
      compare: { count: 2, names: [] },
    });
    expect(parsed.compare).toEqual({ count: 2, names: [] });
    expect(
      TurnReaderV62ResultSchema.parse({ ...base, compare: { count: 9 } })
        .compare,
    ).toBeNull();
    expect(TurnReaderV62ResultSchema.parse(base).compare).toBeNull();
    // Both set: the comparison stands, the recall goes.
    const both = compareOverFromShown({
      compare: { count: 2, names: [] },
      fromShown: { turn: 1 },
    });
    expect(both.fromShown).toBeNull();
    expect(both.compare).toEqual({ count: 2, names: [] });
    const recall = compareOverFromShown({
      compare: null,
      fromShown: { turn: 1 },
    });
    expect(recall.fromShown).toEqual({ turn: 1 });
  });
});
