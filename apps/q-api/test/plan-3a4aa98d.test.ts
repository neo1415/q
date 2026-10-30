import { describe, expect, it } from "vitest";
import type { PlanReviewResult } from "@capital-q/q-core";

import {
  EARLIER_DRAFT_KEPT,
  betterRound,
  mergedPoints,
  noteVocabulary,
  personLines,
  personNote,
  planReadyLine,
  redraftChanges,
  redraftLine,
  runPlanJob,
  type PlanJobPayload,
  type ReviewPoint,
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
 * Live 2026-10-30 (production 66bfeefe9, plan job 3a4aa98d, plan
 * c13eabef, "Plan my raise over 8 weeks"): round 1 scored 91/87, the
 * redraft 88/76 with R2 naming an invented fact on step 9 (F31-F33), and
 * the redraft was delivered. The card listed 17 points, the reviewers'
 * fixes verbatim: "Remove … from step 10's evidenceNeeded list", "Replace
 * the propose_email action with a task …", step 3 four times, step 9
 * four times. Steps and fixes below are the stored plan's and round 2's.
 */
const STEPS = [
  [
    "s1",
    "Approve, change or decline each of the two pending messages to Aster Africa Ventures",
  ],
  [
    "s2",
    "Approve, change or decline the pending LedgerBridge company-profile update",
  ],
  [
    "s3",
    "Review your current LedgerBridge position and confirm the raise, identity, revenue, cash, burn and runway figures",
  ],
  [
    "s4",
    "Provide three months of LedgerBridge revenue evidence and reconcile the September revenue claim",
  ],
  [
    "s5",
    "Confirm LedgerBridge’s September 2026 MRR, merchants, processed payments and net revenue retention",
  ],
  [
    "s6",
    "Prepare an exploratory initial meeting with Aster Africa Ventures for your approval",
  ],
  [
    "s7",
    "Complete LedgerBridge company verification and prepare cap-table and company-document evidence",
  ],
  [
    "s8",
    "Research the Nigerian B2B payments market, alternatives and applicable Nigerian regulation",
  ],
  [
    "s9",
    "Review the draft eight-week raise plan and draft LedgerBridge’s revised seed deck and one-page raise summary",
  ],
  [
    "s10",
    "File the revised LedgerBridge seed deck and one-page raise summary in the data room",
  ],
  [
    "s11",
    "Approve sharing only the filed revised LedgerBridge seed deck with Aster Africa Ventures",
  ],
  [
    "s12",
    "Review the eight-week raise outcome and choose the next path for LedgerBridge",
  ],
].map(([key = "", title = ""]) => ({ key, title }));

const p = (
  reviewer: "R1" | "R2",
  item: ReviewPoint["item"],
  stepKey: string | null,
  fix: string,
  refs: readonly string[] = [],
): ReviewPoint => ({
  reviewer,
  item,
  stepKey,
  problem: "(round 2's problem)",
  fix,
  refs,
});

/** Round 2's points, as stored (R1 then R2), with the refs their fixes name. */
const LIVE: readonly ReviewPoint[] = [
  p("R1", "citesFacts", "s3", "Add F72 and F73 to s3's cites.", ["F72", "F73"]),
  p("R1", "citesFacts", "s4", "Add F64 and F71 to s4's cites.", ["F64", "F71"]),
  p("R1", "citesFacts", "s9", "Add F66 and F69 to s9's cites.", ["F66", "F69"]),
  p(
    "R1",
    "asksNothingKnown",
    "s3",
    "Replace “Confirmation that the raise remains USD 1.2 million on a seed SAFE” with a request to identify and resolve any change from the active USD 1.2 million seed SAFE objective before investor use.",
  ),
  p(
    "R1",
    "asksNothingKnown",
    "s10",
    "Remove “Confirmation that the financial report, market note and customer risk note remain unshared” from s10's evidenceNeeded list.",
  ),
  p(
    "R1",
    "asksNothingKnown",
    "s11",
    "Remove “Confirmation that the financial report, market note and customer risk note are excluded” from s11's evidenceNeeded list and retain only the approval to share the revised seed deck with Aster Africa Ventures.",
  ),
  p(
    "R1",
    "situationCoverage",
    null,
    "Add a step that resolves the pending approval for the proposed initial Aster Africa Ventures meeting, or explain why the existing proposal is being replaced by the meeting proposed in s6.",
  ),
  p(
    "R1",
    "feasibility",
    "s8",
    "Replace the s8 action kind and role with the listed workforce research action for researching the Nigerian B2B payments market, alternatives and applicable Nigerian regulation.",
  ),
  p(
    "R1",
    "feasibility",
    "s9",
    "Replace the s9 action kind and role with the listed workforce documents action for drafting LedgerBridge's revised seed deck and one-page raise summary.",
  ),
  p(
    "R2",
    "noInventedFacts",
    "s9",
    "Replace “The second recorded review should test the draft raise plan” with “The two planned reviews should test the draft raise plan before materials are presented.”",
    ["F31", "F32", "F33"],
  ),
  p(
    "R2",
    "citesFacts",
    "s3",
    "Add F72 and F73 to the cites for the cash and monthly net burn confirmation.",
    ["F72", "F73"],
  ),
  p(
    "R2",
    "citesFacts",
    "s9",
    "Add F66 to the cites for the finance-plan revision.",
    ["F66"],
  ),
  p(
    "R2",
    "citesFacts",
    "s9",
    "Add F69 to the cites for the non-founder roles, hiring plans and adviser position requirement.",
    ["F69"],
  ),
  p(
    "R2",
    "asksNothingKnown",
    "s3",
    "Remove “confirmation that the raise remains USD 1.2 million on a seed SAFE” from the evidence needed and retain a request only to identify any change to the recorded raise objective or instrument.",
  ),
  p(
    "R2",
    "situationCoverage",
    "s3",
    "Add a reconciliation of the three-month runway claim against the recorded cash and monthly net burn, and state which figure remains uncertain.",
    ["F72", "F73"],
  ),
  p(
    "R2",
    "feasibility",
    "s1",
    "Replace the propose_email action with a task for the person to approve, change or decline each pending Aster Africa Ventures card, keeping the two decisions separate.",
  ),
  p(
    "R2",
    "roleCorrectWording",
    null,
    "Replace “held back from Q” with “not available for your review” and remove other internal references to Q from the plan text.",
  ),
];

const VOCABULARY = noteVocabulary("FOUNDER");
const KEYS = new Set(STEPS.map((step) => step.key));

describe("defect 1: the person never reads the writer's fixes", () => {
  it("the live round, without notes: one line per step, code's words, no fix", () => {
    const lines = personLines({
      points: LIVE,
      steps: STEPS,
      vocabulary: VOCABULARY,
    });
    // 17 points on the card became one line per step (s1, s3, s4, s8, s9,
    // s10, s11) and the two on the plan as a whole.
    expect(lines).toHaveLength(9);
    expect(lines.filter((line) => line.startsWith("Step 3, "))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("Step 9, "))).toHaveLength(1);
    expect(lines).toContain(
      `Step 9, “${STEPS[8]?.title ?? ""}”: The reviews still question: a statement your records do not hold; which of your records it rests on; whether it can be done as written, in this order and time.`,
    );
    const all = lines.join("\n");
    for (const leaked of [
      "evidenceNeeded",
      "propose_email",
      "action kind",
      "cites",
      "Replace",
      "Remove",
      "F72",
      "s9",
    ]) {
      expect(all).not.toContain(leaked);
    }
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(300);
  });

  it("a reviewer's plain note is what the person reads, under the step's title", () => {
    const noted = LIVE.map((point) =>
      point.stepKey === "s3" &&
      point.reviewer === "R2" &&
      point.item === "situationCoverage"
        ? {
            ...point,
            note: "Your three-month runway is not yet checked against the cash and monthly burn you told Q.",
          }
        : point.stepKey === "s3"
          ? {
              ...point,
              note: "Your runway is not yet checked against the cash and monthly burn you told Q.",
            }
          : point,
    );
    const step3 = personLines({
      points: noted,
      steps: STEPS,
      vocabulary: VOCABULARY,
    }).filter((line) => line.startsWith("Step 3, "));
    // Four s3 points from two reviewers, two distinct notes, one line.
    expect(step3).toEqual([
      `Step 3, “${STEPS[2]?.title ?? ""}”: Your runway is not yet checked against the cash and monthly burn you told Q. Your three-month runway is not yet checked against the cash and monthly burn you told Q.`,
    ]);
  });

  it("a note written over the plan's JSON is refused by code-known vocabulary", () => {
    // The live fixes, had a reviewer put them in its note.
    for (const fix of [
      "Remove the confirmation from step 10's evidenceNeeded list.",
      "Replace the propose_email action with a task for you.",
      "Add your cash figure (F72) to the sources.",
      "Make s9 a DOCUMENTS draft.",
      "The step is a WORKFORCE action, not a TASK.",
    ]) {
      expect(personNote(fix, VOCABULARY, KEYS)).toBeNull();
    }
    // Plain words pass, whatever English words they use.
    for (const note of [
      "Your runway is not yet checked against the cash and monthly burn you told Q.",
      "Nothing yet decides the meeting with Aster Africa Ventures that is already waiting for you.",
      "The goal, title and due date of this task are still yours to set.",
    ]) {
      expect(personNote(note, VOCABULARY, KEYS)).toBe(note);
    }
  });

  it("the writer still gets every fix: merged by step, each distinct fix kept", () => {
    const merged = mergedPoints(LIVE);
    const s3 = merged.filter((point) => point.stepKey === "s3");
    const s9 = merged.filter((point) => point.stepKey === "s9");
    // Merged for the writer already (R1 and R2 on one step are one point):
    // the near-duplicates reached the person only because the card split
    // each merged point back into one line per distinct fix (eachFix).
    expect(s3).toHaveLength(2);
    expect(s9).toHaveLength(2);
    const text = merged.map(redraftLine).join("\n");
    for (const point of LIVE) expect(text).toContain(point.fix);
  });
});

describe("defect 2: a revision that scores worse does not replace its draft", () => {
  it("live: round 1 [91, 87] beats round 2 [88, 76] with an invented fact", () => {
    const round1 = {
      round: 1,
      reviews: [
        { score: 91, integrityFailed: false },
        { score: 87, integrityFailed: false },
      ],
    };
    const round2 = {
      round: 2,
      reviews: [
        { score: 88, integrityFailed: false },
        { score: 76, integrityFailed: true },
      ],
    };
    expect(betterRound(round1, round2)).toBe(round1);
    // Better on both, or equal: the revision (it carries more fixes).
    const round3 = { ...round2, round: 3, reviews: round1.reviews };
    expect(betterRound(round1, round3)).toBe(round3);
    // A named integrity failure outweighs a higher total.
    const high = {
      round: 4,
      reviews: [
        { score: 98, integrityFailed: true },
        { score: 98, integrityFailed: false },
      ],
    };
    expect(betterRound(round1, high)).toBe(round1);
    // Two completed reviews beat one.
    const one = { round: 5, reviews: [{ score: 99, integrityFailed: false }] };
    expect(betterRound(round1, one)).toBe(round1);
  });

  it("logs what a redraft changed by keys and refs (live s9 cites F31-F33)", () => {
    expect(
      redraftChanges(
        [{ key: "s9", cites: ["F35", "F60"] }],
        [
          { key: "s9", cites: ["F31", "F32", "F33", "F35", "F60"] },
          { key: "s12", cites: ["F39"] },
        ],
      ),
    ).toEqual({
      added: ["s12"],
      removed: [],
      cites: [{ key: "s9", added: ["F31", "F32", "F33"], removed: [] }],
    });
  });

  it("the job delivers the better-scoring draft and says so", async () => {
    const invented: PlanReviewResult = {
      ...review(13, "situationCoverage"),
      noInventedFacts: {
        score: 0,
        defects: [
          {
            stepKey: "s2",
            problem: "It calls Q's own review of the draft a recorded review.",
            fix: "Remove “the second recorded review”.",
          },
        ],
      },
    };
    const revised = {
      ...FOUNDER_PLAN,
      steps: FOUNDER_PLAN.steps.map((one, index) =>
        index === 0 ? { ...one, title: "The revised first step" } : one,
      ),
    };
    const plans = memoryPlanStore();
    const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
    const { models, calls } = fakePlanModels({
      writes: [FOUNDER_PLAN, revised],
      reviews: [review(9), review(13), review(12), invented],
    });
    const payload: PlanJobPayload = {
      kind: "PLAN",
      ownerUserId: founder.userId,
      ask: "Plan my raise over 8 weeks",
      summary: "Your plan: Plan my raise over 8 weeks",
      subject: { side: "FOUNDER", companyId: COMPANY },
      research: "NONE",
      deliverable: "PLAN",
      mode: "NEW",
      planId: null,
      fromVersion: null,
      directionId: null,
    };
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
    expect(calls.filter((call) => call.task === "WRITE")).toHaveLength(2);
    expect(outcome.status).toBe("OFFERED");
    if (outcome.status !== "OFFERED") return;
    const plan = plans.latest(outcome.planId);
    expect(plan?.steps[0]?.title).toBe(FOUNDER_PLAN.steps[0]?.title);
    expect(plan?.review?.reviews.map((one) => one.score)).toEqual([91, 87]);
    expect(plan?.review?.openPoints[0]).toBe(EARLIER_DRAFT_KEPT);
    if (plan === undefined) return;
    expect(planReadyLine(plan, null)).toContain(
      "It's the earlier draft: its revision scored lower in review",
    );
  });
});
