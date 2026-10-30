import { describe, expect, it } from "vitest";

import {
  PLAN_REVIEW_V3,
  PLAN_REVIEW_V4,
  PLAN_RUBRIC_V1,
  PLAN_WRITE_V3,
  PLAN_WRITE_V4,
  PlanReviewResultSchema,
  PlanReviewResultV2Schema,
  REVIEW_FIREWALL_V4,
  WRITE_APPROVAL_V4,
  WRITE_FEASIBLE_V4,
  WRITE_GROUNDED_TAIL_V4,
  WRITE_ORDER_V4,
  createPromptRegistry,
  PROMPT_DEFINITIONS,
  planReviewScore,
  planReviewVerdict,
  type PlanReviewResult,
} from "../src/index.js";

const full = (): PlanReviewResult => {
  const items = Object.fromEntries(
    Object.entries(PLAN_RUBRIC_V1).map(([key, max]) => [
      key,
      { score: max, defects: [] },
    ]),
  ) as unknown as Omit<PlanReviewResult, "firewall" | "score">;
  return { ...items, firewall: { held: true, defects: [] }, score: 100 };
};

describe("PLAN_WRITE v4 / PLAN_REVIEW v4 (plan job 37655270)", () => {
  it("are the active versions; v3 is kept, deprecated", () => {
    const registry = createPromptRegistry(PROMPT_DEFINITIONS);
    const ids = registry.list().map((record) => record.versionId);
    expect(ids).toContain("plan-write/v4");
    expect(ids).toContain("plan-review/v4");
    expect(PLAN_WRITE_V4.status).toBe("ACTIVE");
    expect(PLAN_REVIEW_V4.status).toBe("ACTIVE");
  });

  it("the writer decides what already waits for approval first, no longer a Q-startable step first", () => {
    expect(PLAN_WRITE_V4.template).toContain(WRITE_ORDER_V4);
    expect(PLAN_WRITE_V4.template).not.toContain(
      "When anything can start now, the first step is one Q can start now",
    );
    expect(WRITE_ORDER_V4).toContain(
      "approve, change or decline that very card",
    );
    expect(PLAN_WRITE_V3.template).toContain(
      "the first step is one Q can start now",
    );
  });

  it("the writer words only an approved action 'for your approval', cites activity only when stated, and files a revised document before sharing it", () => {
    for (const rule of [
      WRITE_APPROVAL_V4,
      WRITE_FEASIBLE_V4,
      WRITE_GROUNDED_TAIL_V4,
    ]) {
      expect(PLAN_WRITE_V4.template).toContain(rule);
    }
    expect(WRITE_FEASIBLE_V4).toContain("filed in the data room");
    // The bar and the checklist are unchanged.
    expect(PLAN_WRITE_V4.template).toContain("99/100");
    expect(PLAN_WRITE_V4.output).toEqual(PLAN_WRITE_V3.output);
  });

  it("the reviewer must name the step and the words that expose private material", () => {
    expect(PLAN_REVIEW_V4.template).toContain(REVIEW_FIREWALL_V4);
    expect(PLAN_REVIEW_V4.template).toContain('"the person"');
    expect(PLAN_REVIEW_V4.output.schema).toBe(PlanReviewResultV2Schema);
    expect(PLAN_REVIEW_V4.output.schemaVersion).toBe(2);
    expect(PLAN_REVIEW_V3.output.schema).toBe(PlanReviewResultSchema);
    const named = {
      ...full(),
      firewall: {
        held: false,
        defects: [
          {
            stepKey: "s3",
            exposed: "Aster's partner thinks the team is weak",
            problem: "Step 3 quotes the investor's private note.",
            fix: "Remove the investor's private note from step 3.",
          },
        ],
      },
    };
    expect(PlanReviewResultV2Schema.safeParse(named).success).toBe(true);
    // A firewall defect without the exposed words is refused.
    expect(
      PlanReviewResultV2Schema.safeParse({
        ...named,
        firewall: {
          held: false,
          defects: [{ stepKey: "s3", problem: "x", fix: "y" }],
        },
      }).success,
    ).toBe(false);
  });
});

describe("planReviewVerdict: integrity held to what is named", () => {
  it("an unnamed firewall fail (live R1 round 2: 15/15 invented, no defect) is not fatal, and is reported", () => {
    const silent = { ...full(), firewall: { held: false, defects: [] } };
    expect(planReviewScore(silent).fatal).toBe(true);
    expect(planReviewVerdict(silent)).toEqual({
      score: 100,
      fatal: false,
      passes: true,
      unnamed: ["firewall"],
    });
  });

  it("a named leak stays fatal at any total", () => {
    const leak: PlanReviewResult = {
      ...full(),
      firewall: {
        held: false,
        defects: [
          {
            stepKey: "s2",
            problem: "Step 2 states the investor's private decision.",
            fix: "Remove it.",
          },
        ],
      },
    };
    expect(planReviewVerdict(leak)).toMatchObject({
      score: 100,
      fatal: true,
      passes: false,
      unnamed: [],
    });
    // A named defect with held left true is still a breach.
    expect(
      planReviewVerdict({
        ...leak,
        firewall: { ...leak.firewall, held: true },
      }).fatal,
    ).toBe(true);
  });

  it("an invented fact is fatal when named, an open point when not", () => {
    const named: PlanReviewResult = {
      ...full(),
      noInventedFacts: {
        score: 14,
        defects: [
          { stepKey: "s1", problem: "A date not held.", fix: "Remove it." },
        ],
      },
    };
    expect(planReviewVerdict(named)).toMatchObject({
      fatal: true,
      passes: false,
    });
    const unnamed: PlanReviewResult = {
      ...full(),
      noInventedFacts: { score: 14, defects: [] },
    };
    expect(planReviewVerdict(unnamed)).toMatchObject({
      score: 99,
      fatal: false,
      unnamed: ["noInventedFacts"],
    });
  });
});
