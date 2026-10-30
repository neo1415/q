import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMUNICATION_PROFILE,
  PLAN_REVIEW_V6,
  PLAN_REVIEW_V7,
  PLAN_WRITE_V4,
  PLAN_WRITE_V5,
  PlanReviewResultV4Schema,
  REVIEW_COVERAGE_V7,
  REVIEW_FEASIBILITY_V6,
  REVIEW_NOTE_V7,
  WRITE_COVERAGE_V5,
  WRITE_MODE_V5,
  createDefaultPromptRegistry,
  planMachineWords,
  renderPrompt,
} from "../src/index.js";

/**
 * Live 2026-10-30 (plan job 3a4aa98d, plan c13eabef): the card showed the
 * reviewers' fixes verbatim ("Remove … from step 10's evidenceNeeded
 * list"), and the redraft built step 9 on three remembered notes of this
 * same ask ("Q would draft a plan for two reviews"), "the second recorded
 * review", which R2 rightly flagged as invented.
 */

const item = (score: number) => ({ score, defects: [] });
const defect = {
  stepKey: "s3",
  refs: ["F72", "F73"],
  problem:
    "The step asks the person to confirm cash and monthly net burn without citing the recorded figures.",
  fix: "[s3] Add F72 and F73 to s3's cites.",
  note: "Your runway is not yet checked against the cash and monthly burn you told Q.",
};
const review = {
  situationCoverage: item(15),
  specificity: item(20),
  citesFacts: { score: 11, defects: [defect] },
  ownerClassification: item(10),
  feasibility: item(10),
  noInventedFacts: item(15),
  asksNothingKnown: item(10),
  roleCorrectWording: item(5),
  firewall: { held: true, defects: [] },
  score: 96,
};

describe("PLAN_REVIEW v7 / PLAN_WRITE v5 (plan job 3a4aa98d)", () => {
  it("are active, on v4's review output schema; rubric and bar unchanged", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("PLAN_REVIEW").versionId).toBe("plan-review/v7");
    expect(registry.getActive("PLAN_WRITE").versionId).toBe("plan-write/v5");
    expect(PLAN_REVIEW_V7.output).toMatchObject({
      schemaVersion: 4,
      schema: PlanReviewResultV4Schema,
    });
    expect(PLAN_WRITE_V5.output).toBe(PLAN_WRITE_V4.output);
    for (const kept of ["99/100", "plan-rubric/v1", REVIEW_FEASIBILITY_V6]) {
      expect(PLAN_REVIEW_V7.template).toContain(kept);
    }
    expect(PLAN_REVIEW_V7.template).toContain(REVIEW_NOTE_V7);
    expect(PLAN_REVIEW_V7.template).toContain(REVIEW_COVERAGE_V7);
    expect(PLAN_REVIEW_V6.template).not.toContain("note is for the person");
    expect(PLAN_WRITE_V5.template).toContain(WRITE_COVERAGE_V5);
    expect(PLAN_WRITE_V5.template).toContain(WRITE_MODE_V5);
    expect(PLAN_WRITE_V4.template).not.toContain(
      "remembered note of this same ask",
    );
  });

  it("a defect needs its person note; a firewall defect has none", () => {
    expect(PlanReviewResultV4Schema.safeParse(review).success).toBe(true);
    const { note: _note, ...without } = defect;
    expect(
      PlanReviewResultV4Schema.safeParse({
        ...review,
        citesFacts: { score: 11, defects: [without] },
      }).success,
    ).toBe(false);
    expect(
      PlanReviewResultV4Schema.safeParse({
        ...review,
        firewall: {
          held: false,
          defects: [
            {
              stepKey: null,
              refs: [],
              exposed: "x",
              problem: "p",
              fix: "f",
              note: "n",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("the machine vocabulary comes from the schema, not a word list", () => {
    const words = planMachineWords();
    for (const word of [
      "evidenceNeeded",
      "situationRefs",
      "openQuestions",
      "TOOL_PROPOSAL",
      "APP_ACTION",
      "WORKFORCE",
      "TASK",
      "RESEARCH",
      "DOCUMENTS",
    ]) {
      expect(words.has(word)).toBe(true);
    }
    // Plain-word keys are also English: never refused for being a key.
    for (const plain of ["goal", "title", "why", "due", "steps", "note"]) {
      expect(words.has(plain)).toBe(false);
    }
  });

  it("renders the note rule and the own-ask rule for the reviewer", () => {
    const rendered = renderPrompt(createDefaultPromptRegistry(), {
      task: "PLAN_REVIEW",
      operatingMode: "CONTINUOUS_INTELLIGENCE",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "You are reviewing, not writing.",
      variables: {
        side: "FOUNDER",
        focus: "COVERAGE_AND_SPECIFICITY",
        today: "2026-10-30",
        ask: "Plan my raise over 8 weeks",
        situation:
          "WHAT Q REMEMBERS [MEMORY]\nF31 (USER_CLAIM) Remembered: 2026-10-30 8-week raise plan: Q said it would first gather the current position, then draft a plan for two reviews before presenting it.",
        publicFindings: "",
        allowedActions: "propose_email: drafts an email (needs your approval)",
        plan: JSON.stringify({ goal: "Raise", steps: [] }),
      },
    });
    const text = rendered.messages.map((one) => one.content).join("\n");
    expect(rendered.outputSchema).toBe(PlanReviewResultV4Schema);
    expect(text).toContain("note is for the person");
    expect(text).toContain("never an edit to the plan's text");
    expect(text).toContain("remembered note of this same ask");
  });
});
