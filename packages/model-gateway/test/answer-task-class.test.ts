import { describe, expect, it } from "vitest";

import {
  answerTaskClass,
  budgetForTaskClass,
  CAPABILITIES_NOTE,
  DISCUSS_VERSUS_DO,
} from "../src/q/index.js";

/**
 * RECOVERY-2026-10 B4 (audit B-04): an analytical answer is budgeted as
 * the analysis it is, not as small talk; B7 (audit B-07): the tools note
 * no longer says "Tools only read" while propose_* tools prepare changes.
 */

const ANSWER = { capability: "ANSWER" as const };

describe("the answer's task class", () => {
  it.each([
    ["hi Q, how are you?", "NORMAL_DIALOGUE"],
    ["what's on my calendar today?", "NORMAL_DIALOGUE"],
    ["compare Halyard and Savanna for our seed round", "COMPARISON"],
    ["which of these is better for us?", "COMPARISON"],
    [
      "what are the biggest risks in Ajopot's financials?",
      "EVIDENCE_SYNTHESIS",
    ],
    ["break it down into actionable steps", "EVIDENCE_SYNTHESIS"],
    ["give me the pros and cons of raising now", "EVIDENCE_SYNTHESIS"],
  ])("%j is %s", (words, expected) => {
    expect(answerTaskClass(ANSWER, words)).toBe(expected);
  });

  it("follows the reader's analytical question kinds", () => {
    expect(
      answerTaskClass({ ...ANSWER, questionKind: "ADVICE" }, "what now?"),
    ).toBe("EVIDENCE_SYNTHESIS");
    expect(
      answerTaskClass({ ...ANSWER, questionKind: "PUBLIC_FACTS" }, "who won?"),
    ).toBe("NORMAL_DIALOGUE");
  });

  it("keeps small talk and other capabilities as they were", () => {
    expect(
      answerTaskClass(
        { ...ANSWER, turnKind: "SMALL_TALK" },
        "compare notes with you later, ha",
      ),
    ).toBe("NORMAL_DIALOGUE");
    expect(answerTaskClass({ capability: "INVESTIGATE" }, "hi")).toBe(
      "DEEP_INVESTIGATION",
    );
  });

  it("gives analysis room to finish its answer", () => {
    expect(
      budgetForTaskClass(answerTaskClass(ANSWER, "assess the risks"))
        .maxOutputTokens,
    ).toBeGreaterThan(budgetForTaskClass("NORMAL_DIALOGUE").maxOutputTokens);
  });
});

describe("discussing versus doing (B-07)", () => {
  it("says what reading and proposing tools do, and that a plan is not done", () => {
    expect(DISCUSS_VERSUS_DO).not.toContain("Tools only read.");
    expect(DISCUSS_VERSUS_DO).toContain(
      "propose_* tools only prepare a change for approval",
    );
    expect(CAPABILITIES_NOTE).toContain("prepared or planned is not done");
    expect(CAPABILITIES_NOTE).toContain(
      "say where a point comes from (their records, their words, or your inference)",
    );
  });
});
