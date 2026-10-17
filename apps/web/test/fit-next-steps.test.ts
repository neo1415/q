import { describe, expect, it } from "vitest";

import { nextStepsFor } from "../src/features/fit/next-steps";

const base = {
  name: "Ledgerfold",
  companyId: "84b9641f-b618-4fa3-8b35-1d19b1c71d82",
  questions: [
    "What are the loan pricing, repayment losses and resulting unit economics?",
    "What is the current customer acquisition motion and cost?",
  ],
};
const labels = (state: Parameters<typeof nextStepsFor>[0]["state"]) =>
  nextStepsFor({ ...base, state }).map((step) => step.label);

describe("nextStepsFor (executive review 2026-10-17)", () => {
  it("before a connection, only drafts: nothing can be sent to a founder yet", () => {
    expect(labels(null)).toEqual(["Draft questions for the founder"]);
    expect(labels("DISCOVERED")).toEqual(["Draft questions for the founder"]);
    expect(labels("INTEREST_EXPRESSED")).toEqual([
      "Draft questions for the founder",
    ]);
  });

  it("once connected, the first call leads, then the questions and documents", () => {
    expect(labels("CONNECTED")).toEqual([
      "Book a first call",
      "Send these questions to the founder",
      "Request the documents that would answer them",
    ]);
  });

  it("in diligence, offers the diligence workspace and never more than three", () => {
    const steps = nextStepsFor({ ...base, state: "IN_DILIGENCE" });
    expect(steps).toHaveLength(3);
    expect(steps.at(-1)).toMatchObject({
      kind: "LINK",
      href: "/company/84b9641f-b618-4fa3-8b35-1d19b1c71d82?tab=diligence",
    });
  });

  it("offers nothing for a closed relationship", () => {
    expect(labels("PASSED")).toEqual([]);
    expect(labels("DECLINED")).toEqual([]);
    expect(labels("INVESTED")).toEqual([]);
  });

  it("asks Q to prepare for approval, never to send, and never repeats header actions", () => {
    for (const state of [
      null,
      "CONNECTED",
      "MEETING_HELD",
      "IN_DILIGENCE",
    ] as const) {
      for (const step of nextStepsFor({ ...base, state })) {
        expect(step.label).not.toMatch(/Express interest|Pass/);
        if (step.kind === "ASK") {
          expect(step.ask).toMatch(
            /for my approval|nothing goes to the founder/,
          );
        }
      }
    }
  });
});
