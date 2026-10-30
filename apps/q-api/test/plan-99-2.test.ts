import { describe, expect, it } from "vitest";
import { QPlanSchema, situationFacts } from "@capital-q/contracts";

import {
  FIRST_DRAFT_ONLY,
  cappedPoints,
  mergedPoints,
  personPoint,
  planReadyLine,
  pointText,
  redraftLine,
  runPlanJob,
  waitingPoint,
  type PlanJobInput,
  type PlanJobPayload,
  type ReviewPoint,
} from "../src/composition/workforce/plan-job.js";
import { PLAN_WRITE_BUDGET } from "../src/composition/workforce/models.js";
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
import {
  LIVE_32E70DB7_REVIEW,
  LIVE_32E70DB7_SITUATION,
  LIVE_32E70DB7_STEPS,
} from "./plan-live-32e70db7.js";

/**
 * Plan job 32e70db7 / plan 08ce8485 (live on 84ed976f6, 2026-10-30): round
 * 1 scored 86/94 with 16 points; redraft 1 hit the 90 s limit; the round-1
 * draft was filed while the card said "Draft 2"; 11 points plus "And 5
 * more" were shown, the chat said "and 10 more"; F30 (a profile update
 * waiting for approval) was covered by no step and not among those shown.
 */
const steps = LIVE_32E70DB7_STEPS;
const facts = new Map(
  situationFacts(LIVE_32E70DB7_SITUATION).map((fact) => [
    fact.ref,
    fact.statement,
  ]),
);
const [R1, R2] = LIVE_32E70DB7_REVIEW.reviews;

/** The stored fixes back as points; the rubric item from their place and the item notes. */
function points(
  reviewer: "R1" | "R2",
  fixes: readonly string[],
  items: readonly ReviewPoint["item"][],
  refs: Readonly<Record<number, readonly string[]>> = {},
): ReviewPoint[] {
  return fixes.map((text, index) => {
    const match = /^\[([^\]]+)\]\s*(.*)$/su.exec(text);
    return {
      reviewer,
      item: items[index] ?? "feasibility",
      stepKey: match?.[1] ?? null,
      problem: "",
      fix: match?.[2] ?? text,
      ...(refs[index] === undefined ? {} : { refs: refs[index] }),
    };
  });
}

const R1_POINTS = points(
  "R1",
  R1?.fixes ?? [],
  [
    "citesFacts",
    "citesFacts",
    "specificity",
    "specificity",
    "specificity",
    "situationCoverage",
    "situationCoverage",
    "situationCoverage",
    "situationCoverage",
    "ownerClassification",
    "feasibility",
    "feasibility",
  ],
  // PLAN_REVIEW v5 has each defect name its refs; this one named none in
  // its words (v4). As v5 asks, its gap is readiness for governance (F53).
  { 6: ["F53"] },
);
const R2_POINTS = points("R2", R2?.fixes ?? [], [
  "situationCoverage",
  "situationCoverage",
  "ownerClassification",
  "feasibility",
]);

describe("job 32e70db7: what the person reads", () => {
  it("is the stored run: 12 + 4 points, and F30 decided by no step", () => {
    expect(R1_POINTS).toHaveLength(12);
    expect(R2_POINTS).toHaveLength(4);
    expect(steps.some((step) => step.cites.includes("F30"))).toBe(false);
  });

  it("merges what both raised: organisation verification, F30, steps 7 and 8, each once", () => {
    const waiting = waitingPoint(steps, LIVE_32E70DB7_SITUATION);
    expect(waiting?.refs).toEqual(["F30"]);
    const merged = mergedPoints([
      ...(waiting === null ? [] : [waiting]),
      ...R1_POINTS,
      ...R2_POINTS,
    ]);
    // 17 (with code's F30 point) less: R1's and R2's F30 points into
    // code's, organisation verification, step 7, step 8.
    expect(merged).toHaveLength(12);
    expect(merged[0]?.reviewer).toBe("CODE");
    expect(merged[0]?.alsoFixes).toHaveLength(2);
    for (const key of ["s7", "s8"]) {
      expect(
        merged.filter(
          (point) =>
            point.stepKey === key &&
            (point.item === "ownerClassification" ||
              point.item === "citesFacts"),
        ),
      ).toHaveLength(1);
    }
    const said = merged.map((point) =>
      personPoint(pointText({ ...point, alsoFixes: [] }), steps, facts),
    );
    expect(
      said.filter(
        (point) =>
          !point.startsWith("Step") &&
          /organisation.verification/iu.test(point),
      ),
    ).toHaveLength(1);
    expect(
      said.filter((point) => point.includes("Update your company profile")),
    ).toHaveLength(1);
    expect(said[0]).toBe(
      "Open the plan with a step that asks you to approve, change or decline the approval “Update your company profile” waiting for you on its card, before any new draft of the same thing.",
    );
  });

  it("a waiting approval no step decides is shown first, so a cap never hides it", () => {
    const open = cappedPoints(
      [
        FIRST_DRAFT_ONLY,
        ...mergedPoints([
          ...[waitingPoint(steps, LIVE_32E70DB7_SITUATION)].flatMap((one) =>
            one === null ? [] : [one],
          ),
          ...R1_POINTS,
          ...R2_POINTS,
        ]).map((point) =>
          personPoint(pointText({ ...point, alsoFixes: [] }), steps, facts),
        ),
      ],
      12,
    );
    expect(open[0]).toBe(FIRST_DRAFT_ONLY);
    expect(open[1]).toContain("Update your company profile");
    expect(open[11]).toBe("And 2 more points the reviews raised.");
  });

  it("names are whole and short; a note is never cut inside a quote, and none is lost", () => {
    const said = R1_POINTS.map((point) =>
      personPoint(pointText(point), steps, facts, "Tunde Bello"),
    );
    // Live: "Add your deck's the ask section to step 6's sources."
    expect(said[0]).toBe(
      "Step 6: Add your deck's ask section to step 6's sources.",
    );
    // Live point 4 kept only F40 of F40, F53 and F34.
    expect(said[3]).toBe(
      // All three facts, whole: the two longest said briefly to fit 300.
      "Step 6: Name the specific unknowns to address: LedgerBridge's regulatory/payment responsibilities, governance and identity status, finance controls, and what evidence can be shared without exposing private documents, citing the investor's interest, the readiness reading and what Q remembers.",
    );
    // Live point 5 lost its closing quote and F58.
    expect(said[4]).toContain(
      "citing the investor's interest and your current raise.",
    );
    // Live point 9: "the record “Remembered” and what Q remembers of…".
    expect(said[8]).toBe(
      "State whether the prepared Aster update and LedgerBridge positioning between payment gateways and accounting tools are inputs to the revised materials, citing what Q remembers of “LedgerBridge 12-month financial model”, what you told Q on 2026-10-29 and what Q remembers of “LedgerBridge runway”.",
    );
    for (const point of said) {
      expect(point.length).toBeLessThanOrEqual(300);
      expect(point.split("“").length).toBe(point.split("”").length);
      expect(point).not.toMatch(/\bthe person\b|\bTunde\b|\bF\d+\b/u);
    }
    // The stored notes show both defects as they reached the person.
    const live = LIVE_32E70DB7_REVIEW.openPoints;
    expect(live).toContain(
      "Step 6: Add your deck's the ask section to step 6's sources.",
    );
    expect(live.at(-1)).toBe("And 5 more points the reviews raised.");
  });

  it("the chat line and the card count the same points", () => {
    const plan = QPlanSchema.parse({
      planId: "08ce8485-d3a1-4db9-a782-00af6de6b2f5",
      version: 1,
      side: "FOUNDER",
      goal: "Raise",
      situationSummary: "Where things stand.",
      situationRefs: [...new Set(steps.flatMap((step) => step.cites))],
      steps,
      openQuestions: [],
      review: LIVE_32E70DB7_REVIEW,
      status: "OFFERED",
      supersedes: null,
      createdAt: "2026-10-30T07:29:01.000Z",
    });
    // Card: 11 listed and "And 5 more" = 16; the line shows 2: 14 more.
    expect(planReadyLine(plan, null)).toContain("; and 14 more on the card.");
  });
});

describe("job 32e70db7: the redraft", () => {
  it("is lean: the change wanted, merged, by ref; never the problem or a fact's text", () => {
    const merged = mergedPoints([...R1_POINTS, ...R2_POINTS]);
    const line = redraftLine(
      merged.find((point) => point.stepKey === "s7") ?? {
        stepKey: null,
        item: "feasibility",
        problem: "",
        fix: "",
      },
    );
    expect(
      line.startsWith("[s7] Add an explicit founder-finishing action"),
    ).toBe(true);
    expect(line).toContain(" Also: State the person's finishing action");
    const text = merged.map(redraftLine).join("\n");
    expect(text.length).toBeLessThan(3_500);
    expect(text).not.toContain("Remembered:");
    expect(text).toContain("F30");
  });

  it("has room: 120 s, 1.6x the slowest write served (73 s); the live 90 s was 1.25x", () => {
    expect(PLAN_WRITE_BUDGET.attemptTimeoutMs).toBe(120_000);
  });

  it("when it does not come back, the first draft is shown as the first draft, never as Draft 2", async () => {
    const plans = memoryPlanStore();
    const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
    const { models } = fakePlanModels({
      writes: [FOUNDER_PLAN, null],
      reviews: [review(8), review(6)],
    });
    const stages: Parameters<NonNullable<PlanJobInput["progress"]>>[0][] = [];
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
        payload: PAYLOAD,
        progress: (stage) => {
          stages.push(stage);
        },
      },
    );
    expect(outcome.status).toBe("OFFERED");
    if (outcome.status !== "OFFERED") return;
    const plan = plans.latest(outcome.planId);
    expect(plan?.review?.redrafts).toBe(0);
    expect(plan?.review?.openPoints[0]).toBe(FIRST_DRAFT_ONLY);
    expect(outcome.line).toContain(
      "It's the first draft: its revision couldn't finish in time",
    );
    expect(outcome.line).not.toContain("Draft 2");
    const planning = stages.filter((one) => one.stage === "PLANNING").at(-1);
    expect(planning).toMatchObject({ stage: "PLANNING", draft: 1 });
  });
});

const PAYLOAD: PlanJobPayload = {
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
