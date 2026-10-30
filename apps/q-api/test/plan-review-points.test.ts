import { describe, expect, it } from "vitest";
import type { PlanReviewResult } from "@capital-q/q-core";

import {
  FIREWALL_UNNAMED,
  mergedPoints,
  personPoint,
  redraftFixes,
  reviewFixes,
  reviewOf,
  reviewPoints,
  runPlanJob,
  wordClip,
  type PlanJobPayload,
} from "../src/composition/workforce/plan-job.js";
import {
  COMPANY,
  FOUNDER_DOSSIER,
  FOUNDER_PLAN,
  JOB,
  LEAD_RUN,
  RUN,
  TENANT,
  contextOf,
  fakeAssembler,
  fakePlanModels,
  founder,
  memoryPlanStore,
  review,
} from "./plan-fixtures.js";

/**
 * Live 2026-10-30 (plan job dd352104, reviews 97 and 81 after one
 * redraft): every reviewer fix was cut at 300 characters together with its
 * problem, so the redraft and the person read "... source-", "Ledge",
 * "after the revised de"; the same point came once from each reviewer; and
 * R1's fatal verdict (firewall not held, no defect named) reached nobody.
 * These are the live defects' own words.
 */
const S1_PROBLEM =
  "The step’s evidenceNeeded states that completed deck work will be recorded, but its cites do not include the ref showing the pitch deck is already uploaded and visible to Q.";
const S1_FIX_R1 =
  "Add F1 to s1’s cites, or change the evidenceNeeded wording to refer only to the cited evidence-building and source-gathering work that is still to be done.";
const S1_FIX_R2 =
  "Add F1 to s1's cites, or remove the statement about completed deck work.";
const S3_PROBLEM =
  "The plan notes that an Aster Africa Ventures message is awaiting approval but does not resolve, send, or explicitly defer that open request, leaving a relevant waiting action unplanned.";
const S3_FIX =
  "Add a decision for the pending Aster message: either place its approval and sending after the revised deck is shared, or leave it unsent and say why, before the meeting is proposed.";

function withDefects(
  base: PlanReviewResult,
  item: "citesFacts" | "situationCoverage" | "feasibility",
  off: number,
  defects: PlanReviewResult["citesFacts"]["defects"],
): PlanReviewResult {
  return {
    ...base,
    [item]: { score: base[item].score - off, defects },
    score: base.score - off,
  };
}

const R1 = withDefects(
  withDefects(review(0), "citesFacts", 1, [
    { stepKey: "s1", problem: S1_PROBLEM, fix: S1_FIX_R1 },
  ]),
  "situationCoverage",
  1,
  [{ stepKey: "s3", problem: S3_PROBLEM, fix: S3_FIX }],
);
const R2 = withDefects(review(0), "citesFacts", 2, [
  { stepKey: "s1", problem: S1_PROBLEM, fix: S1_FIX_R2 },
]);

describe("review points: split first, never cut mid-word, once across reviewers", () => {
  it("stores each fix split from its problem, whole or cut at a word", () => {
    const fixes = reviewFixes(R1);
    expect(fixes).toEqual([`[s1] ${S1_FIX_R1}`, `[s3] ${S3_FIX}`]);
    const long = reviewFixes(
      withDefects(review(0), "feasibility", 1, [
        {
          stepKey: "s2",
          problem: "x",
          fix: `${"Make the dependency explicit for the founder figures ".repeat(7)}obtaining`,
        },
      ]),
    );
    expect(long[0]?.length).toBeLessThanOrEqual(300);
    const body = (long[0] ?? "").replace(/^\[s2\] /u, "").replace(/…$/u, "");
    expect(long[0]?.endsWith("…")).toBe(true);
    expect(
      `${"Make the dependency explicit for the founder figures ".repeat(7)}obtaining`[
        body.length
      ],
    ).toBe(" ");
  });

  it("wordClip never ends inside a word", () => {
    const text =
      "Name Aster Africa Ventures and specify that each new follow-up concerns LedgerBridge materials and the criteria used to choose them";
    for (const max of [40, 60, 77, 80, 100]) {
      const clipped = wordClip(text, max);
      expect(clipped.length).toBeLessThanOrEqual(max);
      const body = clipped.replace(/…$/u, "");
      expect(text.startsWith(body)).toBe(true);
      expect([" ", undefined]).toContain(text[body.length]);
    }
    expect(wordClip("short", 300)).toBe("short");
  });

  it("the same step and rubric item from both reviewers is one point, both fixes kept for the redraft", () => {
    const merged = mergedPoints([
      ...reviewPoints(R1, "R1"),
      ...reviewPoints(R2, "R2"),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      stepKey: "s1",
      item: "citesFacts",
      fix: S1_FIX_R1,
      alsoFix: S1_FIX_R2,
    });
    // An exact repeat (whatever the quotes or spacing) is dropped too.
    expect(
      mergedPoints([...reviewPoints(R2, "R1"), ...reviewPoints(R2, "R2")]).map(
        (point) => point.alsoFix,
      ),
    ).toEqual([null]);
  });

  it("a firewall verdict with no defect named is said, and stays fatal", () => {
    const silent: PlanReviewResult = {
      ...review(0),
      firewall: { held: false, defects: [] },
    };
    const mapped = reviewOf(silent, "R1", 1, "PLAN_WRITE@3+PLAN_REVIEW@3");
    expect(mapped.passed).toBe(false);
    expect(mapped.integrityFailed).toBe(true);
    expect(reviewPoints(silent, "R1")).toEqual([
      { reviewer: "R1", item: "firewall", stepKey: null, ...FIREWALL_UNNAMED },
    ]);
    expect(mapped.fixes).toHaveLength(1);
  });

  it("the person reads the whole fix, with no cut word", () => {
    const point = personPoint(`[s3] ${S3_PROBLEM} Fix: ${S3_FIX}`, [
      { key: "s1" },
      { key: "s2" },
      { key: "s3" },
    ]);
    expect(point).toBe(`Step 3: ${S3_FIX}`);
  });

  it("the redraft's fixes keep every point whole, leaving out what does not fit", () => {
    const long = "word ".repeat(300).trim();
    const out = redraftFixes(["first point", long, "third point"], 1_000);
    expect(out.text).toBe("1. first point\n2. third point");
    expect(out.left).toBe(1);
  });
});

describe("the plan job hands the reviewers' points on whole", () => {
  const payload: PlanJobPayload = {
    kind: "PLAN",
    ownerUserId: founder.userId,
    ask: "plan my raise over 8 weeks",
    summary: "Your plan: plan my raise over 8 weeks",
    subject: { side: "FOUNDER", companyId: COMPANY },
    research: "NONE",
    deliverable: "PLAN",
    mode: "NEW",
    planId: null,
    fromVersion: null,
    directionId: null,
  };

  it("redraft and open points carry the full fixes, once each", async () => {
    const plans = memoryPlanStore();
    const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
    const { models, calls } = fakePlanModels({
      writes: [FOUNDER_PLAN, FOUNDER_PLAN],
      reviews: [R1, R2, R1, R2],
    });
    const outcome = await runPlanJob(
      {
        assembler,
        toolContext: (actor) => Promise.resolve(contextOf(actor)),
        models,
        store: plans.store,
        documents: () => Promise.resolve([]),
        now: () => new Date("2026-10-30T04:00:00.000Z"),
      },
      {
        actor: founder,
        owner: { tenantId: TENANT, userId: founder.userId },
        jobId: JOB,
        leadRunId: LEAD_RUN,
        runId: RUN,
        payload,
      },
    );
    expect(outcome.status).toBe("OFFERED");
    if (outcome.status !== "OFFERED") return;
    const redraft = calls[3];
    expect(redraft?.mode).toBe("REDRAFT");
    // Whole: the end of each fix reaches the writer.
    expect(redraft?.fixes).toContain(S1_FIX_R1);
    expect(redraft?.fixes).toContain(S1_FIX_R2);
    expect(redraft?.fixes).toContain(S3_FIX);
    // Once: step 1's point is one numbered point carrying both fixes.
    expect(redraft?.fixes?.split(S1_PROBLEM).length).toBe(2);

    const plan = plans.latest(outcome.planId);
    const open = plan?.review?.openPoints ?? [];
    expect(open.filter((point) => point.startsWith("Step 1:"))).toHaveLength(1);
    expect(open).toContain(`Step 3: ${S3_FIX}`);
    for (const point of open) {
      expect(point).not.toMatch(/\w-$|\bde$|\bLedge$|\bwh$/u);
    }
  });
});
