// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkforcePlanProgress } from "@capital-q/contracts";

import { WorkforcePlan } from "../src/features/work/workforce-plan";

afterEach(cleanup);

const FACT = {
  ref: "F1",
  kind: "OPEN_REQUEST" as const,
  text: "Open diligence request with Harbourline Cargo: Unit economics by lane.",
  at: null,
};

const PLAN: WorkforcePlanProgress = {
  outcome: "Ready for diligence on Harbourline Cargo.",
  done: 1,
  total: 2,
  steps: [
    {
      key: "memo",
      who: "Documents",
      does: "Investment memo",
      why: "The team needs one document.",
      status: "DONE",
      summary: "Prepared.",
      dependsOn: [],
      fallbackFor: null,
      evidence: [FACT],
    },
    {
      key: "thanks",
      who: "Conversation",
      does: "Thank the founder",
      why: null,
      status: "HELD",
      summary:
        "Held before anything went out: an earlier step found a contradiction.",
      dependsOn: ["memo"],
      fallbackFor: null,
      evidence: [],
    },
    {
      key: "alt",
      who: "Discovery",
      does: "Use the catalog",
      why: null,
      status: "NOT_NEEDED",
      summary: null,
      dependsOn: [],
      fallbackFor: "memo",
      evidence: [],
    },
  ],
  prerequisites: [
    {
      what: "Unit economics by lane",
      status: "MISSING",
      blocking: true,
      evidence: ["F1"],
      resolvedBy: null,
    },
  ],
  signals: [{ kind: "CONTRADICTION", note: "ARR differs", stepKey: "memo" }],
  nextActions: [
    {
      action: "Ask the founder: churn",
      why: "It is not known.",
      evidence: [],
      tool: "diligence.questions.prepare",
      needsApproval: true,
      source: "RESULT",
    },
  ],
  situation: [FACT],
};

describe("the plan on a job card", () => {
  it("says the outcome, each step's state in words, what is missing, what was found and what needs approval", () => {
    render(<WorkforcePlan plan={PLAN} />);
    expect(screen.getByText("1 of 2 steps done")).toBeTruthy();
    expect(
      screen.getByText("Ready for diligence on Harbourline Cargo."),
    ).toBeTruthy();
    expect(screen.getByText(/^Needs you · after Documents/u)).toBeTruthy();
    expect(
      screen.getByText(/Not needed · only if Documents cannot/u),
    ).toBeTruthy();
    expect(screen.getByText(/^Based on: Open diligence request/u)).toBeTruthy();
    expect(screen.getByText(/Missing, needed for the outcome/u)).toBeTruthy();
    expect(screen.getByText("Contradiction:")).toBeTruthy();
    expect(screen.getByText(/Needs your approval\./u)).toBeTruthy();
  });

  it("shows nothing for a job with no plan on record", () => {
    const { container } = render(<WorkforcePlan plan={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});
