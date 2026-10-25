import { describe, expect, it } from "vitest";

import { endedWithoutDocumentText } from "../src/composition/workforce/delivery.js";

/**
 * F11 (coordinator 2026-10-25): six growth-plan jobs failed within seconds
 * and the conversation still said "it moves to Done, with its document".
 * A job that ends with no document says so once: what did not get done,
 * why, and what happens next.
 */
const plan = {
  ownerUserId: "0a000000-0000-4000-8000-000000000001",
  goal: "Write a 12-month growth plan for Maji Loop",
  summary: "Research your market and write your 12-month growth plan.",
  steps: [{ agent: "RESEARCH", task: "Read the market" }],
  permitted: [],
  budgetUsd: "1.00",
  cannot: [],
};
const row = (state: string, reason: string | null, withPlan = true) =>
  ({ state, reason, plan: withPlan ? plan : {} }) as never;

describe("a job that ends with no document says so", () => {
  it("failed: what, why, and what they can do", () => {
    expect(
      endedWithoutDocumentText(row("FAILED", "The research step failed.")),
    ).toBe(
      "Research your market and write your 12-month growth plan didn't finish: the research step failed. There's no document; ask me to try again, or ask for a shorter version I can answer here.",
    );
    expect(endedWithoutDocumentText(row("FAILED", null, false))).toMatch(
      /^That work didn't finish: a step of the work failed/u,
    );
  });

  it("stopped, never started, or waiting on them", () => {
    expect(endedWithoutDocumentText(row("CANCELLED", null))).toMatch(
      /was stopped, so there's no document/u,
    );
    expect(
      endedWithoutDocumentText(
        row(
          "BLOCKED",
          "Your plan's limit for Q's work is reached; raise it to go on.",
        ),
      ),
    ).toMatch(/couldn't go ahead: your plan's limit/u);
    expect(
      endedWithoutDocumentText(
        row("NEEDS_DECISION", "Your approval of the brief."),
      ),
    ).toMatch(/is on hold, waiting for this: your approval of the brief\.$/u);
  });

  it("says nothing for a job still running or finished", () => {
    expect(endedWithoutDocumentText(row("RUNNING", null))).toBeNull();
    expect(endedWithoutDocumentText(row("COMPLETED", null))).toBeNull();
  });
});
