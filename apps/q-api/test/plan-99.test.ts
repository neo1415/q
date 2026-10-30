import { describe, expect, it } from "vitest";
import {
  Q_PLAN_OPEN_POINTS_MAX,
  situationFacts,
  type QPlanStep,
} from "@capital-q/contracts";
import type { PlanReviewResult } from "@capital-q/q-core";

import {
  FIREWALL_UNNAMED,
  PLAN_JOB_TIME_BUDGET_MS,
  anotherRedraft,
  cappedPoints,
  codeChecks,
  mergedPoints,
  personPoint,
  plainFactName,
  pointText,
  reviewOf,
  reviewPoints,
  runPlanJob,
  secondPerson,
  waitingPoint,
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
import {
  LIVE_37655270_OPEN_POINTS,
  LIVE_37655270_SITUATION,
  LIVE_37655270_STEPS,
} from "./plan-live-37655270.js";

/**
 * Plan job 37655270 / plan d79a3147 (live on 841f413d8, 2026-10-30):
 * "Plan my raise over 8 weeks", 229 s, round 1 81/73 (30 points), round 2
 * 92/92 (17 points), offered as a draft. The round-2 reviews below are the
 * stored ones (review.json): each fix verbatim, under the rubric item its
 * position and the stored item notes and scores place it in.
 */
const d = (stepKey: string | null, problem: string, fix: string) => ({
  stepKey,
  problem,
  fix,
});

const R1_ROUND2: PlanReviewResult = {
  situationCoverage: {
    score: 13,
    defects: [
      d(
        "s1",
        "The plan recognises a pending Aster Africa Ventures message but does not resolve whether the existing approved-for-review message should be approved, replaced, or withdrawn before a revised update is prepared.",
        "State that the existing pending Aster message will be superseded or reviewed first, and specify the approval or withdrawal decision before preparing any replacement.",
      ),
    ],
  },
  specificity: {
    score: 17,
    defects: [
      d(
        "s6",
        "The customer-outcome gap is described generically even though the situation identifies the relevant workflow problems: manual reconciliation and supplier payment delays for Nigerian distributors and merchants.",
        "Name the specific outcomes to quantify, such as reduced manual reconciliation effort and reduced supplier payment waiting time, and tie them to LedgerBridge's records.",
      ),
      d(
        "s12",
        "The final phase does not name the investors it covers.",
        "Name Aster Africa Ventures and any subsequently sourced investors, and define the stages and next actions for reply, first meeting, diligence, follow-up and round-status review.",
      ),
    ],
  },
  citesFacts: {
    score: 14,
    defects: [
      d(
        "s1",
        "F1 and F2 record evidence-item and source-registration activity but do not support the stated reason for revising the Aster update.",
        "Remove F1 and F2 from s1, or add a specific explanation of how those activities affect the update; retain F31, F28 and F40 as the supporting facts.",
      ),
    ],
  },
  ownerClassification: { score: 10, defects: [] },
  feasibility: {
    score: 8,
    defects: [
      d(
        "s12",
        "The plan assigns a single end date to a contingent eight-week operating phase without specifying when replies, meetings, diligence requests or status updates are reviewed, so the work cannot be reliably executed as written.",
        "Add explicit branches for an unapproved or unanswered Aster proposal and for requests concerning revenue evidence, founder verification, regulatory setup, or the held-back documents.",
      ),
      d(
        "s12",
        "No review cadence is set for the final phase.",
        "Set a review cadence and response deadlines for each investor event, with a named next action and owner for an Aster reply, a new meeting request, each diligence request and the final round-status review.",
      ),
      d(
        "s11",
        "Outreach has no selection checkpoint.",
        "Add a selection checkpoint after the sourced screen, specify how many investors can be prioritised within the period, then draft outreach only for the approved shortlist.",
      ),
    ],
  },
  noInventedFacts: { score: 15, defects: [] },
  asksNothingKnown: { score: 10, defects: [] },
  roleCorrectWording: { score: 5, defects: [] },
  // Live: integrity failed, 15/15 for invented facts, nothing named.
  firewall: { held: false, defects: [] },
  score: 92,
};

const R2_ROUND2: PlanReviewResult = {
  situationCoverage: {
    score: 14,
    defects: [
      d(
        "s10",
        "The plan does not make the already-pending Aster Africa Ventures message and meeting approvals an immediate decision point before proposing a later meeting.",
        "Add an initial step to review and approve, decline or replace the existing pending Aster proposals and messages in F28-F29; make the later meeting proposal conditional on that outcome.",
      ),
    ],
  },
  specificity: {
    score: 18,
    defects: [
      d(
        "s8",
        "The profile step does not identify which LedgerBridge profile fields or investor-facing claims must be checked against the recorded business, founder and raise facts.",
        "Name the specific profile fields to verify, including LedgerBridge’s Nigerian B2B payments positioning, Tunde Bello and Ada Okafor, the USD 1.2 million SAFE raise and any current traction figures.",
      ),
      d(
        "s12",
        "The final phase names no investor and no status fields.",
        "Name Aster Africa Ventures and define the status fields for each investor: response, meeting stage, diligence request, approved next action, evidence gap and relationship outcome.",
      ),
    ],
  },
  citesFacts: { score: 15, defects: [] },
  ownerClassification: { score: 10, defects: [] },
  feasibility: {
    score: 7,
    defects: [
      d(
        "s1",
        "The step says the update is being prepared for Tunde’s approval but marks the work as requiring no approval, leaving no defined approval action before the message can be used.",
        "Make this step explicitly draft-only and add a subsequent approval step, or change the action and approval status so Tunde must approve the revised Aster update before it is used or sent.",
      ),
      d(
        "s6",
        "The deck step does not say how unavailable metrics are labelled.",
        "State that Tunde should add verified figures where available and label each unavailable metric as unknown or an estimate, with a specific source or calculation method for any estimate.",
      ),
      d(
        "s9",
        "The revised deck that step 9 shares is never filed.",
        "Add a document-preparation and filing step after s6 and s7 that creates the revised seed deck as a distinct data-room document before s9.",
      ),
      d(
        "s10",
        "The meeting proposal ignores the approvals already pending.",
        "Resolve the pending Aster message and meeting approvals first, then either use the existing approved proposal or prepare a replacement with a due date that reflects the current pending state.",
      ),
    ],
  },
  noInventedFacts: { score: 15, defects: [] },
  asksNothingKnown: {
    score: 9,
    defects: [
      d(
        "s10",
        "The step proposes a new meeting while one is waiting.",
        "Ask Tunde to decide on the existing pending proposal first; prepare a new proposal only if it is declined, expires or is otherwise no longer usable.",
      ),
    ],
  },
  roleCorrectWording: {
    score: 4,
    defects: [
      d(
        "s1",
        "The step uses internal wording.",
        "Replace internal references such as “Q should revise it” with wording such as “Prepare a revised draft for your approval,” while retaining the owner classification in the plan structure.",
      ),
    ],
  },
  firewall: { held: true, defects: [] },
  score: 92,
};

const facts = new Map(
  situationFacts(LIVE_37655270_SITUATION).map((fact) => [
    fact.ref,
    fact.statement,
  ]),
);
const steps = LIVE_37655270_STEPS;

describe("1. an integrity verdict must name what it found (job 37655270)", () => {
  it("R1 round 2 (firewall failed, nothing named, 15/15 invented) is not fatal; it is said", () => {
    const mapped = reviewOf(R1_ROUND2, "R1", 2, "PLAN_WRITE@4+PLAN_REVIEW@4");
    expect(mapped.score).toBe(92);
    expect(mapped.integrityFailed).toBe(false);
    expect(mapped.passed).toBe(false);
    expect(reviewPoints(R1_ROUND2, "R1")[0]).toEqual({
      reviewer: "R1",
      item: "firewall",
      stepKey: null,
      ...FIREWALL_UNNAMED,
    });
  });

  it("a named leak stays fatal at 99, and its exposed words reach the writer, not the person", () => {
    const leak = {
      ...review(1),
      firewall: {
        held: false,
        defects: [
          {
            stepKey: "s4",
            exposed: "Aster's partner rates the team as weak",
            problem: "Step 4 states Aster's private assessment.",
            fix: "Remove Aster's private assessment from step 4.",
          },
        ],
      },
    };
    const mapped = reviewOf(leak, "R2", 2, "PLAN_WRITE@4+PLAN_REVIEW@4");
    expect(mapped.score).toBe(99);
    expect(mapped.integrityFailed).toBe(true);
    expect(mapped.passed).toBe(false);
    const [point] = reviewPoints(leak, "R2");
    expect(point?.item).toBe("firewall");
    const text = pointText({ ...(point ?? FIREWALL_UNNAMED_POINT) });
    expect(text).toContain("Aster's partner rates the team as weak");
    const said = personPoint(text, steps, facts);
    expect(said).toBe("Step 4: Remove Aster's private assessment from step 4.");
    expect(said).not.toContain("weak");
  });

  it("a passing review's unnamed flag is still carried to the plan's open points", async () => {
    const silentPass = {
      ...review(0),
      firewall: { held: false, defects: [] },
    };
    const plans = memoryPlanStore();
    const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
    const { models } = fakePlanModels({
      writes: [FOUNDER_PLAN],
      reviews: [silentPass, review(0)],
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
        payload: PAYLOAD,
      },
    );
    expect(outcome.status).toBe("OFFERED");
    if (outcome.status !== "OFFERED") return;
    const plan = plans.latest(outcome.planId);
    expect(plan?.review?.fullyReviewed).toBe(true);
    // The person reads code's own note, never the writer's fix.
    expect(plan?.review?.openPoints).toContain(FIREWALL_UNNAMED.note);
  });
});

describe("2. code checks what is structural of the writer's gaps", () => {
  const point = waitingPoint(steps, LIVE_37655270_SITUATION);

  it("(a) the two messages to Aster waiting for approval (F28, F29) and the profile change (F30) are not decided first", () => {
    expect(point).toMatchObject({
      reviewer: "CODE",
      stepKey: null,
      refs: ["F28", "F29", "F30"].filter((ref) => ref !== "F28"),
    });
    expect(point?.fix).toContain("approve, change or decline F29, F30");
  });

  it("only the structural check runs: no rule reads the step's words", () => {
    // Wording, cite support and filing order are judged by the writer's v4
    // rules and the reviewers; a share action carries no document id.
    const all = codeChecks(
      {
        steps,
        situationRefs: steps.flatMap((step) => step.cites),
        openQuestions: [],
      },
      LIVE_37655270_SITUATION,
      { droppedCites: 0, droppedSteps: 0 },
    );
    expect(all).toEqual([]);
  });

  it("a plan that decides the waiting items first passes", () => {
    const by = new Map(steps.map((step) => [step.key, step]));
    const take = (key: string): QPlanStep => {
      const step = by.get(key);
      if (step === undefined) throw new Error(key);
      return step;
    };
    const decide: QPlanStep = {
      ...take("s8"),
      key: "s0",
      owner: "YOU",
      action: { kind: "TASK" },
      needsApproval: false,
      title:
        "Approve, change or decline the two waiting messages to Aster Africa Ventures and the waiting profile change",
      why: "Two messages to Aster and a profile change are waiting on their cards; nothing goes out until you decide.",
      evidenceNeeded: ["Your decision on each card"],
      cites: ["F28", "F29", "F30"],
    };
    const fixed = [decide, ...["s1", "s2", "s3"].map(take)];
    expect(waitingPoint(fixed, LIVE_37655270_SITUATION)).toBeNull();
  });
});

describe("3. a second redraft only within reach, within about 330 s", () => {
  const points = [
    ...reviewPoints(R1_ROUND2, "R1"),
    ...reviewPoints(R2_ROUND2, "R2"),
  ];
  // The run's own timings: gather 809, write 73487, review1 41271,
  // redraft1 57168, review2 39204 ms.
  const elapsed = 809 + 73_487 + 41_271 + 57_168 + 39_204;

  it("round 2 (92/92, every point on a named step but the unnamed flag) gets one more: 212 s + 57 s + 39 s fits", () => {
    expect(
      anotherRedraft({
        redrafts: 1,
        scores: [92, 92],
        points,
        elapsedMs: elapsed,
        lastRedraftMs: 57_168,
        lastReviewMs: 39_204,
      }),
    ).toEqual({ go: true, reason: "within reach" });
    expect(elapsed + 57_168 + 39_204).toBeLessThanOrEqual(
      PLAN_JOB_TIME_BUDGET_MS,
    );
  });

  it("round 1 (81/73) always redrafts once; below 90 never twice", () => {
    expect(
      anotherRedraft({
        redrafts: 0,
        scores: [81, 73],
        points,
        elapsedMs: 115_000,
        lastRedraftMs: null,
        lastReviewMs: 41_271,
      }).go,
    ).toBe(true);
    expect(
      anotherRedraft({
        redrafts: 1,
        scores: [92, 88],
        points,
        elapsedMs: elapsed,
        lastRedraftMs: 57_168,
        lastReviewMs: 39_204,
      }),
    ).toEqual({ go: false, reason: "not within reach" });
  });

  it("stops when the time would run out, when points are vague, and after two", () => {
    const base = {
      redrafts: 1,
      scores: [92, 92],
      points,
      elapsedMs: elapsed,
      lastRedraftMs: 57_168,
      lastReviewMs: 39_204,
    };
    expect(anotherRedraft({ ...base, elapsedMs: 240_000 }).go).toBe(false);
    const vague = [1, 2, 3].map((n) => ({
      reviewer: "R1" as const,
      item: "specificity" as const,
      stepKey: null,
      problem: `The plan as a whole lacks ${String(n)}.`,
      fix: `Add ${String(n)}.`,
    }));
    expect(anotherRedraft({ ...base, points: [...points, ...vague] })).toEqual({
      go: false,
      reason: "points not specific or too many",
    });
    expect(anotherRedraft({ ...base, redrafts: 2 }).go).toBe(false);
  });
});

describe("4. the points the person reads (job 37655270)", () => {
  const merged = mergedPoints([
    ...reviewPoints(R1_ROUND2, "R1"),
    ...reviewPoints(R2_ROUND2, "R2"),
  ]);
  const said = merged.map((point) =>
    personPoint(
      pointText({ ...point, alsoFixes: [] }),
      steps,
      facts,
      "Tunde Bello",
    ),
  );

  it("fact labels are whole or plain names, never cut with an ellipsis", () => {
    const step1 = said.find((point) => point.startsWith("Step 1: Remove"));
    expect(step1).toBe(
      // Its five full names do not fit in 300 with the fix: each is said
      // briefly, whole, and none is cut (job 32e70db7's rule).
      "Step 1: Remove your recent activity and “You registered a source (9 times; latest 2026-10-30)” from step 1, or add a specific explanation of how those activities affect the update; retain what Q remembers, the waiting approval and the interest from “Aster Africa Ventures” as the supporting facts.",
    );
    for (const point of said) expect(point).not.toContain("…");
    // Live it read "…retain “Remembered: 2026-10-30 LedgerBridge 12-month
    // financial model: Tunde asked…”".
    expect(LIVE_37655270_OPEN_POINTS.join(" ")).toContain("Tunde asked…");
  });

  it("a range like F28-F29 is said once, meaningfully", () => {
    const step10 = said.find((point) => point.includes("Add an initial step"));
    expect(step10).toContain(
      "in both approvals “Message Aster Africa Ventures” waiting for you;",
    );
    expect(step10).not.toMatch(/”[-–]“/u);
    // Live: "...in “Waiting for your approval, not approved yet (nothing…”-“Waiting for…”".
    expect(LIVE_37655270_OPEN_POINTS.some((point) => /”-“/u.test(point))).toBe(
      true,
    );
  });

  it("the same step under the same rubric item is one point (R1's two on step 12's feasibility)", () => {
    const step12 = merged.filter(
      (point) => point.stepKey === "s12" && point.item === "feasibility",
    );
    expect(step12).toHaveLength(1);
    expect(step12[0]?.alsoFixes).toHaveLength(1);
    // 17 raised (as live). Merged: R1's two on step 12's feasibility, and
    // (job 32e70db7's rule) R2's points on steps 1, 6 and 12, which R1
    // also raised: 12 points.
    expect(merged).toHaveLength(12);
  });

  it("nothing is dropped silently: past the cap, the last place says how many more", () => {
    // The cap is Q_PLAN_OPEN_POINTS_MAX (20 since job ea7508c9).
    const many = [
      ...new Set(said),
      ...Array.from({ length: 10 }, (_, n) => `One more, ${String(n)}.`),
    ];
    const capped = cappedPoints(many);
    expect(many.length).toBeGreaterThan(Q_PLAN_OPEN_POINTS_MAX);
    expect(capped).toHaveLength(Q_PLAN_OPEN_POINTS_MAX);
    expect(capped[Q_PLAN_OPEN_POINTS_MAX - 1]).toBe(
      `And ${String(many.length - (Q_PLAN_OPEN_POINTS_MAX - 1))} more points the reviews raised.`,
    );
    expect(cappedPoints(many, 12)).toHaveLength(12);
    expect(cappedPoints(["a", "b"])).toEqual(["a", "b"]);
  });

  it("the person is 'you', never their name in the third person", () => {
    for (const point of said) expect(point).not.toMatch(/\bTunde\b/u);
    expect(said).toContain(
      "Step 10: Decide on the existing pending proposal first; prepare a new proposal only if it is declined, expires or is otherwise no longer usable.",
    );
    // R2's step 1 point is merged into R1's; said alone, it is "you".
    expect(
      personPoint(
        "[s1] x Fix: Make this step explicitly draft-only and add a subsequent approval step, or change the action and approval status so Tunde must approve the revised Aster update before it is used or sent.",
        steps,
        facts,
        "Tunde Bello",
      ),
    ).toContain("so you must approve the revised Aster update");
    expect(
      personPoint(
        "[s6] x Fix: State that Tunde should add verified figures where available and label each unavailable metric as unknown or an estimate, with a specific source or calculation method for any estimate.",
        steps,
        facts,
        "Tunde Bello",
      ),
    ).toBe(
      "Step 6: State that you should add verified figures where available and label each unavailable metric as unknown or an estimate, with a specific source or calculation method for any estimate.",
    );
    expect(
      secondPerson("The person approves the card; the person's deck."),
    ).toBe("You approve the card; your deck.");
  });

  it("plain names for the situation's kinds of fact", () => {
    const name = (ref: string) => plainFactName(facts.get(ref) ?? "").one;
    expect(name("F28")).toBe(
      "the approval “Message Aster Africa Ventures” waiting for you",
    );
    expect(name("F42")).toBe("your document “LedgerBridge seed deck”");
    expect(name("F16")).toBe(
      "your board task “Your part: Approve Q's proposed initial meeting with Aster Africa Ventures about LedgerBridge”",
    );
    expect(name("F61")).toBe("your deck's value proposition section");
  });
});

const FIREWALL_UNNAMED_POINT = {
  reviewer: "R1" as const,
  item: "firewall" as const,
  stepKey: null,
  ...FIREWALL_UNNAMED,
};

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
