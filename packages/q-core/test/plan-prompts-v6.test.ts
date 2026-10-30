import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMUNICATION_PROFILE,
  PLAN_REVIEW_V5,
  PLAN_REVIEW_V6,
  PlanReviewResultV3Schema,
  PlanReviewResultV4Schema,
  REVIEW_FEASIBILITY_V6,
  REVIEW_FIX_V6,
  REVIEW_REFS_V5,
  createDefaultPromptRegistry,
  renderPrompt,
} from "../src/index.js";

/**
 * Live 2026-10-30 (plan job ea7508c9, plan 01f706cf): R2 called due dates
 * 31 Oct-13 Nov "already past" on 30 Oct (the reviewer was never told
 * the date), and R1's "[s10] Replace it with plain wording ..." reached the
 * person without the words "it" meant.
 */

/** Realistic variables: the live run's own shape (situation abridged). */
const VARIABLES = {
  side: "FOUNDER",
  focus: "FEASIBILITY_AND_INVENTED_FACTS",
  today: "2026-10-30",
  ask: "Plan my raise over the next 8 weeks",
  situation: [
    "SCHEDULE [SCHEDULE]",
    'F31 (VERIFIED, as of 2026-11-14) Reminder "Validate the evidence and status of LedgerBridge\'s September 2026 traction claims" due 2026-11-14',
    "BOARD [BOARD]",
    'F33 (VERIFIED, as of 2026-11-20) On your board: "Prepare Aster follow-up" due 2026-11-20',
  ].join("\n"),
  publicFindings:
    "Public findings, when any, are in THE SITUATION under PUBLIC SOURCES and are cited by their F refs.",
  allowedActions: "propose_meeting: proposes a meeting (needs your approval)",
  plan: JSON.stringify({
    goal: "Run LedgerBridge's eight-week USD 1.2 million seed SAFE raise",
    steps: [
      {
        key: "s1",
        title: "Approve, change or decline both pending Aster messages",
        due: "2026-10-31",
        cites: ["F28", "F29"],
      },
    ],
  }),
};

const render = (variables: Record<string, unknown>) =>
  renderPrompt(createDefaultPromptRegistry(), {
    task: "PLAN_REVIEW",
    operatingMode: "CONTINUOUS_INTELLIGENCE",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes: "You are reviewing, not writing.",
    variables,
  });

describe("PLAN_REVIEW v6: today's date, fixes read alone, one change each", () => {
  it("was active (v8 now), on v5's output schema and rubric", () => {
    const active = createDefaultPromptRegistry().getActive("PLAN_REVIEW");
    expect(active.versionId).toBe("plan-review/v8");
    expect(PLAN_REVIEW_V6.output).toBe(PLAN_REVIEW_V5.output);
    expect(PLAN_REVIEW_V6.output).toMatchObject({
      schemaVersion: 3,
      schema: PlanReviewResultV3Schema,
    });
    expect(PLAN_REVIEW_V6.template).toContain(REVIEW_REFS_V5);
    expect(PLAN_REVIEW_V6.template).toContain("99/100");
    expect(PLAN_REVIEW_V6.template).toContain(REVIEW_FEASIBILITY_V6);
    expect(PLAN_REVIEW_V6.template).toContain(REVIEW_FIX_V6);
    expect(PLAN_REVIEW_V6.template).not.toContain('"move this after S2');
  });

  it("renders TODAY in the rubric with the live run's variables", () => {
    const rendered = render(VARIABLES);
    const text = rendered.messages.map((one) => one.content).join("\n");
    // v7 (active) keeps v6's lines and answers in schema v4.
    expect(rendered.outputSchema).toBe(PlanReviewResultV4Schema);
    // The rendered rule, as the reviewer reads it.
    expect(text).toContain(
      "TODAY is 2026-10-30: judge every date against TODAY. A due date on or after TODAY is not past. A record dated after TODAY (a reminder, a meeting, a board date) is in the future; it never means TODAY is later.",
    );
    expect(text).toContain(
      "quote the plan's words it changes, never “it”".replace(/“|”/gu, '"'),
    );
    expect(text).toContain("One change per defect");
    // The situation is still fenced as data.
    expect(text).toMatch(/UNTRUSTED_CONTENT[^\n]*situation/u);
    expect(text).toContain("as of 2026-11-14");
    expect(text).not.toContain("{{today}}");
  });

  it("refuses a review call without today", () => {
    const { today: _today, ...without } = VARIABLES;
    expect(() => render(without)).toThrow(/invalid/u);
  });
});
