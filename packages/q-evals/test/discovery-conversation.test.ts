import { describe, expect, it } from "vitest";

import {
  DISCOVERY_CASES,
  gradeDiscoveryConversation,
  runDiscoveryCase,
} from "../src/datasets/discovery-conversation/cases.js";

/**
 * HQ-5: scripted vague-founder and vague-investor conversations through
 * discovery's own code, graded by code ($0: no provider is called).
 */
describe("discovery conversations ($0, graded by code)", () => {
  it("covers vague founders and vague investors, with both exits", () => {
    const ids = DISCOVERY_CASES.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith("founder-")).length).toBe(2);
    expect(ids.filter((id) => id.startsWith("investor-")).length).toBe(4);
    expect(
      DISCOVERY_CASES.filter((one) => one.exitAt !== undefined).length,
    ).toBeGreaterThanOrEqual(3);
  });

  for (const one of DISCOVERY_CASES) {
    it(`${one.id}: passes`, () => {
      expect(gradeDiscoveryConversation(one, runDiscoveryCase(one))).toEqual(
        [],
      );
    });
  }

  it("a second question and a re-ask of a declared fact are cut from what is said", () => {
    const one = DISCOVERY_CASES.find(
      (candidate) => candidate.id === "investor-vague-deal-flow",
    );
    if (one === undefined) throw new Error("case missing");
    const said = runDiscoveryCase(one)[1]?.said ?? "";
    expect(said).not.toContain("How much do you usually invest");
    expect(said).toContain("What was the last deal you looked at closely");
  });

  it("the grader fails a conversation that ignores the exit or re-asks", () => {
    const one = DISCOVERY_CASES[0];
    if (one === undefined) throw new Error("case missing");
    const transcript = runDiscoveryCase(one);
    const ignored = transcript.map((turn, index) =>
      index === one.exitAt
        ? {
            ...turn,
            decision: {
              kind: "ASK" as const,
              gap: "USE_OF_FUNDS",
              question: "What came first?",
              known: [],
              asked: 4,
              chips: [],
            },
            said: "What stage are you at?",
          }
        : turn,
    );
    const failures = gradeDiscoveryConversation(one, ignored);
    expect(failures).toContain("turn 3: the exit was not honoured");
    expect(failures).toContain("turn 3: re-asked the declared STAGE");
    expect(failures).toContain("turn 3: no visible exit");
    expect(failures).toContain("ended on a question, not a next step");
  });

  it("seeking guidance opens discovery on the first turn; without it, it does not", () => {
    const one = DISCOVERY_CASES.find(
      (candidate) => candidate.id === "investor-not-sure-first-turn",
    );
    if (one === undefined) throw new Error("case missing");
    expect(runDiscoveryCase(one)[0]?.decision?.kind).toBe("ASK");
    const unsignalled = {
      ...one,
      turns: one.turns.map((turn) => ({ ...turn, seeksGuidance: false })),
    };
    expect(
      gradeDiscoveryConversation(unsignalled, runDiscoveryCase(unsignalled)),
    ).toContain("turn 0: discovery did not open");
  });
});
