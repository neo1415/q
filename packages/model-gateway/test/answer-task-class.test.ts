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

describe("the answer's task class (Q intelligence step 4: the reader's fields)", () => {
  it.each([
    ["CHAT", "NORMAL_DIALOGUE"],
    ["LOOKUP", "NORMAL_DIALOGUE"],
    ["FOLLOW_UP", "NORMAL_DIALOGUE"],
    ["COMPARISON", "COMPARISON"],
    ["ANALYSIS", "EVIDENCE_SYNTHESIS"],
    ["DOCUMENT", "EVIDENCE_SYNTHESIS"],
  ])("answerKind %s is %s", (answerKind, expected) => {
    expect(answerTaskClass({ ...ANSWER, answerKind })).toBe(expected);
  });

  it("follows the reader's analytical question kinds", () => {
    expect(answerTaskClass({ ...ANSWER, questionKind: "ADVICE" })).toBe(
      "EVIDENCE_SYNTHESIS",
    );
    expect(answerTaskClass({ ...ANSWER, questionKind: "PUBLIC_FACTS" })).toBe(
      "NORMAL_DIALOGUE",
    );
  });

  it("a compound ask takes its heaviest part", () => {
    expect(
      answerTaskClass({
        ...ANSWER,
        answerKind: "LOOKUP",
        askParts: [
          { ask: "What's Silo Credit's runway?", kind: "LOOKUP" },
          { ask: "How does it compare with Ledgerfold's?", kind: "COMPARISON" },
        ],
      }),
    ).toBe("COMPARISON");
  });

  it("unread (FAKE mode, a failed reading) is the neutral default, never a word list", () => {
    expect(answerTaskClass(ANSWER)).toBe("NORMAL_DIALOGUE");
    // An unknown kind is no kind.
    expect(answerTaskClass({ ...ANSWER, answerKind: "DEEP_THOUGHT" })).toBe(
      "NORMAL_DIALOGUE",
    );
    // The function takes no words at all: there is nothing to match.
    expect(answerTaskClass.length).toBe(1);
  });

  it("keeps small talk and other capabilities as they were", () => {
    expect(
      answerTaskClass({
        ...ANSWER,
        turnKind: "SMALL_TALK",
        answerKind: "COMPARISON",
      }),
    ).toBe("NORMAL_DIALOGUE");
    expect(
      answerTaskClass({ capability: "INVESTIGATE", answerKind: "LOOKUP" }),
    ).toBe("DEEP_INVESTIGATION");
  });

  it("gives analysis room to finish its answer", () => {
    expect(
      budgetForTaskClass(answerTaskClass({ ...ANSWER, answerKind: "ANALYSIS" }))
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
