import { describe, expect, it } from "vitest";

import {
  displacedQLine,
  questionShown,
} from "@/features/onboarding-conversation/conversation";

/**
 * Live check 2026-10-31 ~20:41Z on production 857aa249a (fictional founder
 * "Kivisild Locker Network", typed): Q asked "The company: … Is that
 * right?" about the description. The reading of their earlier words saved
 * the description before they answered, the screen moved to the next
 * step's question, and Q's sentence was gone from the conversation, which
 * then read "How would you categorise the company?" where Q had asked
 * something else. Q's lines are append-only: the one that leaves the
 * screen joins the thread as said.
 */
const SAID =
  "The company: Kivisild Locker Network operates a network of smart parcel lockers in small towns for couriers. The role: CEO. Is that right?";
const NEXT = "How would you categorise the company?";

describe("Q's sentence is never replaced on screen", () => {
  it("the step Q asked about is saved under it: its sentence joins the thread, and the next question shows", () => {
    const question = { stepKey: "F1.description", text: SAID };
    // The session after the reading landed: the description is saved and
    // the journey asks the categories (promptStepOf moves past a step that
    // is no longer open), so the screen shows that step's question.
    const live = questionShown(
      { stepKey: "F1.categories", text: NEXT },
      question,
      false,
    );
    expect(live).toBe(NEXT);
    const thread = [
      { kind: "PERSON", text: "No website yet. I'm the CEO. We run…" },
    ];
    expect(displacedQLine(question, live, thread)).toBe(SAID);
  });

  it("nothing is added while it is still the live question, or once it is in the thread", () => {
    const question = { stepKey: "F1.description", text: SAID };
    expect(displacedQLine(question, SAID, [])).toBeNull();
    expect(
      displacedQLine(question, NEXT, [{ kind: "Q", text: `  ${SAID} ` }]),
    ).toBeNull();
    expect(displacedQLine(null, NEXT, [])).toBeNull();
  });
});
