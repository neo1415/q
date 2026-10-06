import { describe, expect, it } from "vitest";

import {
  investorArchetypeOf,
  questioningNote,
} from "../src/composition/rehearsal-archetypes.js";
import { readTurn } from "../src/composition/rehearsal-readings.js";

/** P3: distinct investors question differently, chosen by code, stably. */

const base = {
  counterpartName: "Ada Fund",
  style: "",
  summary: "",
  priorities: [] as string[],
  likelyQuestions: [] as { question: string }[],
};

describe("investor archetypes", () => {
  it("matches a persona's own words to a questioning style", () => {
    expect(
      investorArchetypeOf({
        ...base,
        priorities: ["Revenue growth and unit economics", "Burn and runway"],
      }).id,
    ).toBe("NUMBERS_FIRST");
    expect(
      investorArchetypeOf({
        ...base,
        priorities: ["Climate impact measured per tonne", "Mission first"],
      }).id,
    ).toBe("MISSION_DRIVEN");
    expect(
      investorArchetypeOf({
        ...base,
        summary: "Asks why now and who the incumbent is; tests the moat.",
      }).id,
    ).toBe("THESIS_SKEPTIC");
  });

  it("reads conduct: a short-patience partner pattern-matches", () => {
    expect(
      investorArchetypeOf({
        ...base,
        conduct: {
          patience: "SHORT",
          warmth: "TYPICAL",
          dodgeTolerance: "TYPICAL",
        },
      }).id,
    ).toBe("PATTERN_MATCHER");
  });

  it("is stable for the same person and never matches 'arr' inside a word", () => {
    const input = { ...base, style: "carries an array of questions" };
    const first = investorArchetypeOf(input).id;
    expect(investorArchetypeOf(input).id).toBe(first);
    // No cue matched: the pick comes from the name, not from "carry".
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"].map(
      (n) => investorArchetypeOf({ ...input, counterpartName: n }).id,
    );
    expect(new Set(names).size).toBeGreaterThan(1);
  });

  it("gives a founder an answering note, not an investor's", () => {
    expect(questioningNote("FOUNDER", base)).toMatch(/You are the founder/);
    expect(questioningNote("INVESTOR", base)).toMatch(/investor/);
  });
});

describe("P5: the rehearsal turn's screen note", () => {
  const turn = { line: "Walk me through this slide.", move: "ASK" };
  it("is read when present, null when empty or absent", () => {
    expect(
      readTurn({
        ...turn,
        screenNote: { shows: "TAM $40bn", take: "No source." },
      })?.screenNote,
    ).toEqual({ shows: "TAM $40bn", take: "No source." });
    expect(
      readTurn({ ...turn, screenNote: { shows: "", take: "" } })?.screenNote,
    ).toBeNull();
    expect(readTurn(turn)?.screenNote).toBeNull();
  });
});
