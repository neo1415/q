import { describe, expect, it } from "vitest";

import {
  Q_PLAN_OPEN_POINTS_MAX,
  QPlanReviewSummarySchema,
  type QPlan,
  type QPlanStep,
} from "@capital-q/contracts";
import {
  DEFAULT_COMMUNICATION_PROFILE,
  PlanReviewResultV3Schema,
  createDefaultPromptRegistry,
  renderPrompt,
  type PlanReviewResultV3,
} from "@capital-q/q-core";

import {
  PLAN_JOB_TIME_BUDGET_MS,
  PLAN_PROMPT_VERSION,
  anotherRedraft,
  codeCheckLines,
  codeChecks,
  eachFix,
  integrityReason,
  mergedPoints,
  personPoint,
  planReadyLine,
  redraftShape,
  reviewPoints,
  runPlanJob,
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
  dossierOf,
  fakeAssembler,
  fakePlanModels,
  founder,
  memoryPlanStore,
} from "./plan-fixtures.js";

/**
 * Live 2026-10-30, production q-api a513ebf8c: plan job ea7508c9 (plan
 * 01f706cf, 218 s on the server). Round 1 82/69 (R2's integrity flagged,
 * no reason kept), round 2 92/90, no second redraft ("points not specific
 * or too many"), 12 open points; the card listed 5.
 *
 * R1's and R2's round-2 defects below are the run's own fixes (review.json)
 * on their rubric items (the stored notes), with refs as v5 asks for them.
 */

type Defect = PlanReviewResultV3["specificity"]["defects"][number];
const defect = (
  stepKey: string | null,
  fix: string,
  refs: readonly string[],
  problem = "The plan falls short here.",
): Defect => ({ stepKey, problem, fix, refs: [...refs] });

function result(
  over: Partial<Omit<PlanReviewResultV3, "score" | "firewall">> & {
    readonly firewall?: PlanReviewResultV3["firewall"];
  },
): PlanReviewResultV3 {
  const base: PlanReviewResultV3 = {
    situationCoverage: { score: 15, defects: [] },
    specificity: { score: 20, defects: [] },
    citesFacts: { score: 15, defects: [] },
    ownerClassification: { score: 10, defects: [] },
    feasibility: { score: 10, defects: [] },
    noInventedFacts: { score: 15, defects: [] },
    asksNothingKnown: { score: 10, defects: [] },
    roleCorrectWording: { score: 5, defects: [] },
    firewall: { held: true, defects: [] },
    score: 100,
  };
  const merged = { ...base, ...over };
  const score =
    merged.situationCoverage.score +
    merged.specificity.score +
    merged.citesFacts.score +
    merged.ownerClassification.score +
    merged.feasibility.score +
    merged.noInventedFacts.score +
    merged.asksNothingKnown.score +
    merged.roleCorrectWording.score;
  return PlanReviewResultV3Schema.parse({ ...merged, score });
}

const ASTER = ["F3", "F16", "F22"];

const R1_ROUND2 = result({
  situationCoverage: {
    score: 13,
    defects: [
      defect(
        null,
        "Add dated steps for the Aster follow-up, recording its outcome and agreed next action, and for the next investor action through 24 December; keep broader outreach conditional because no other named prospects are held.",
        ASTER,
      ),
    ],
  },
  specificity: {
    score: 19,
    defects: [
      defect(
        "s9",
        "Name the specific LedgerBridge gaps to address: historical financial statements, gross margin, unit economics, currency mix, burn, runway, acquisition mechanics and the assumptions behind the 400-merchant and USD 150,000 MRR targets.",
        ["F40"],
      ),
    ],
  },
  ownerClassification: {
    score: 9,
    defects: [
      defect(
        "s3",
        "Make this a person-owned approval task for the existing proposal, or state that Q will prepare a new meeting proposal for the person's approval and remove the claim that it resolves the existing approval.",
        ["F22"],
      ),
    ],
  },
  feasibility: {
    score: 7,
    defects: [
      defect(
        "s5",
        "Move the evidence and verification work to the recorded 3–4 November deadlines, or state the dependency and explain why the earlier deadlines cannot be met.",
        ["F4", "F5"],
      ),
      defect(
        "s12",
        "Rename the step to prepare and submit the Aster Africa Ventures meeting proposal for approval, then add a subsequent approved scheduling step if booking is required.",
        ["F22"],
      ),
    ],
  },
  roleCorrectWording: {
    score: 4,
    defects: [
      defect(
        "s10",
        "Replace it with plain wording such as “your fundraising materials and data-room record.”",
        [],
        "The step says “data-room record”, an internal phrase.",
      ),
    ],
  },
});

const R2_ROUND2 = result({
  situationCoverage: {
    score: 13,
    defects: [
      defect(
        null,
        "Add a step or explicit checkpoint to reconcile whether the 140 figure means paying customers, active merchants, or both before using it in the deck or Aster materials.",
        ["F28", "F47"],
      ),
      defect(
        "s12",
        "Add the concrete outcome sought from Aster's initial conversation, such as testing fit against its stated operating-metrics, regulatory-setup and fundraising-objective questions, followed by a dated decision on whether to continue.",
        ["F16"],
      ),
    ],
  },
  specificity: {
    score: 19,
    defects: [
      defect(
        "s4",
        "Specify that the research must address the regulatory setup for LedgerBridge's Nigerian activities and alternatives to its stated position between payment gateways and accounting tools, while leaving conclusions unknown until sourced.",
        ["F39"],
      ),
    ],
  },
  feasibility: {
    score: 6,
    defects: [
      defect(
        null,
        "Add dated week-seven and week-eight steps covering Aster follow-up, any approved broader outreach, outstanding evidence, and the next fundraising decision, without assuming that an investor has replied.",
        ASTER,
      ),
      defect(
        "s1",
        "State what each pending message is intended to resolve, and make the unresolved September reconciliation and founder or organisation verification dependencies explicit before either message is approved.",
        ["F28", "F29"],
      ),
      defect(
        "s8",
        "Change this deliverable to a sourced outcome metric if evidence is supplied, or an explicitly labelled outcome gap and evidence request; do not require an unsupported quantified result.",
        ["F61"],
      ),
      defect(
        "s12",
        "Make the step propose a meeting time for the person's approval, then state that booking occurs only after that approval and Aster's acceptance.",
        ["F22"],
      ),
    ],
  },
});

/** R2's date-only point: gone once the reviewer knows today (v6). */
const REBASE = defect(
  null,
  "Rebase every due date from the review date, preserve the dependency order, and extend the final follow-up through the end of the eight-week window.",
  [],
);

const STEPS: QPlanStep[] = Array.from({ length: 12 }, (_, index) => ({
  key: `s${String(index + 1)}`,
  title: `Step ${String(index + 1)}`,
  why: "Its reason.",
  cites: ["F3"],
  owner: "YOU",
  action: { kind: "TASK" },
  due: null,
  waitsFor: [],
  evidenceNeeded: [],
  needsApproval: false,
  status: "TODO",
  jobId: null,
  boardItemId: null,
  proposalId: null,
  reminderId: null,
}));

const REMINDERS = {
  F4: 'Reminder "Provide three months of LedgerBridge revenue evidence and reconcile the September traction claims for internal review" due 2026-11-03T08:00:00.000Z.',
  F5: 'Reminder "Complete founder identity verification and restate LedgerBridge\'s current revenue, cash, burn and runway figures" due 2026-11-03T08:00:00.000Z.',
  F6: 'Reminder "Validate the evidence and status of LedgerBridge\'s September 2026 traction claims" due 2026-11-03T08:00:00.000Z.',
} as const;
const FACTS = new Map<string, string>(Object.entries(REMINDERS));

describe("1. the reviewers are told today's date (PLAN_REVIEW v6)", () => {
  it("the job sends today, and the call renders and validates against the active version", async () => {
    const plans = memoryPlanStore();
    const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
    const passing = result({});
    const { models } = fakePlanModels({
      writes: [FOUNDER_PLAN],
      reviews: [passing, passing],
    });
    const sent: Record<string, unknown>[] = [];
    const registry = createDefaultPromptRegistry();
    const reviewPlan: typeof models.reviewPlan = (who, trace, variables) => {
      sent.push({ ...variables });
      // The real prompt, as models.ts renders it: refused if a variable
      // the active version declares is missing.
      const rendered = renderPrompt(registry, {
        task: "PLAN_REVIEW",
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes: "You are reviewing, not writing.",
        variables,
      });
      const text = rendered.messages.map((one) => one.content).join("\n");
      expect(text).toContain(
        "TODAY is 2026-10-30: judge every date against TODAY.",
      );
      // The answer is checked by the active version's own schema.
      expect(rendered.outputSchema).toBe(PlanReviewResultV3Schema);
      return models.reviewPlan(who, trace, variables);
    };
    const payload: PlanJobPayload = {
      kind: "PLAN",
      ownerUserId: founder.userId,
      ask: "Plan my raise over the next 8 weeks",
      summary: "Your plan: plan my raise over the next 8 weeks",
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
        models: { ...models, reviewPlan },
        store: plans.store,
        documents: () => Promise.resolve([]),
        now: () => new Date("2026-10-30T10:16:33.000Z"),
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
    expect(sent).toHaveLength(2);
    for (const one of sent) expect(one.today).toBe("2026-10-30");
  });
});

describe("2. the chat's count and the card's list are one list", () => {
  it("12 open points: the chat names 2 and says 10 more; the card holds all 12", () => {
    const openPoints = Array.from(
      { length: 12 },
      (_, index) => `Step ${String(index + 1)}: Change it.`,
    );
    const plan = {
      steps: STEPS,
      review: { fullyReviewed: false, openPoints },
    } as unknown as QPlan;
    const line = planReadyLine(plan, null);
    expect(line).toContain("; and 10 more on the card.");
    // The card's list holds them all (the web card lists every one).
    expect(Q_PLAN_OPEN_POINTS_MAX).toBeGreaterThanOrEqual(15);
    expect(
      QPlanReviewSummarySchema.safeParse({
        rubricVersion: "plan-rubric/v1",
        threshold: 99,
        reviews: [],
        redrafts: 1,
        fullyReviewed: false,
        openPoints: Array.from(
          { length: 15 },
          (_, index) => `Point ${String(index + 1)}.`,
        ),
      }).success,
    ).toBe(true);
  });
});

describe("3. merging keeps every distinct fix", () => {
  const points = [
    ...reviewPoints(R1_ROUND2, "R1"),
    ...reviewPoints(R2_ROUND2, "R2"),
  ];
  const merged = mergedPoints(points);
  const said = merged
    .flatMap(eachFix)
    .map((point) => personPoint(point, STEPS, FACTS, "Tunde Bello"));

  it("R2's two step-12 fixes and its weeks 7-8 ask reach the person, under the step", () => {
    expect(merged.length).toBe(10);
    expect(said).toHaveLength(13);
    const step12 = said.filter((point) => point.startsWith("Step 12:"));
    expect(step12).toEqual([
      "Step 12: Rename the step to prepare and submit the Aster Africa Ventures meeting proposal for approval, then add a subsequent approved scheduling step if booking is required.",
      "Step 12: Add the concrete outcome sought from Aster's initial conversation, such as testing fit against its stated operating-metrics, regulatory-setup and fundraising-objective questions, followed by a dated decision on whether to continue.",
      "Step 12: Make the step propose a meeting time for your approval, then state that booking occurs only after that approval and Aster's acceptance.",
    ]);
    // Listed together, under the step.
    const first = said.indexOf(step12[0] ?? "");
    expect(said.slice(first, first + 3)).toEqual(step12);
    const weeks = said.findIndex((point) =>
      point.startsWith("Add dated week-seven and week-eight steps"),
    );
    expect(weeks).toBe(
      said.findIndex((point) => point.startsWith("Add dated steps for")) + 1,
    );
  });

  it("an identical ask is said once", () => {
    const twice = mergedPoints([
      ...reviewPoints(R1_ROUND2, "R1"),
      ...reviewPoints(R1_ROUND2, "R2"),
    ]).flatMap(eachFix);
    expect(twice).toHaveLength(reviewPoints(R1_ROUND2, "R1").length);
  });
});

describe("4. plain words for the person", () => {
  const section = dossierOf("FOUNDER", {});
  const dossier = {
    ...section,
    sections: [
      ...section.sections.filter((one) => one.source !== "SCHEDULE"),
      {
        source: "SCHEDULE" as const,
        status: "READ" as const,
        facts: (["F4", "F5", "F6"] as const).map((ref) => ({
          ref,
          statement: REMINDERS[ref],
          truthClass: "VERIFIED" as const,
          evidenceStatus: "PLATFORM_VERIFIED" as const,
          label: "personal_private" as const,
          category: null,
          asOf: "2026-11-03T08:00:00.000Z",
          provenance: {
            url: null,
            tool: "list_schedule",
            record: null,
          },
        })),
      },
    ],
  } as unknown as typeof section;
  const plan = { steps: [], situationRefs: [], openQuestions: [] };
  const grounding = { droppedCites: 0, droppedSteps: 0 };

  it("an unused section is named as the person knows it, each reminder once", () => {
    const lines = codeCheckLines(plan, dossier, grounding);
    const schedule = lines.find((line) => line.writer.includes("SCHEDULE"));
    // The writer still reads the prompt's own section name.
    expect(schedule?.writer).toBe(
      "Nothing in the plan uses SCHEDULE (F4, F5, F6): use it, or say in an open question why it does not matter.",
    );
    expect(codeChecks(plan, dossier, grounding)).toContain(schedule?.writer);
    const said = personPoint(schedule?.person ?? "", STEPS, FACTS);
    expect(said).toBe(
      "No step uses your schedule (your reminders): a step should use it, or the plan should say why it does not matter.",
    );
    expect(said).not.toMatch(/SCHEDULE|your reminder and your reminder/u);
  });

  it("two reminders that fit are each quoted once, under one kind", () => {
    const said = personPoint(
      "No step uses your schedule (F6 and F5): a step should use it.",
      STEPS,
      FACTS,
    );
    expect(said).toBe(
      "No step uses your schedule (your reminders “Validate the evidence and status of LedgerBridge's September 2026 traction claims” and “Complete founder identity verification and restate LedgerBridge's current revenue, cash, burn and runway figures”): a step should use it.",
    );
  });
});

describe("5. the stored prompt version is the registry's", () => {
  it("names the active PLAN_WRITE and PLAN_REVIEW versions", () => {
    const registry = createDefaultPromptRegistry();
    expect(PLAN_PROMPT_VERSION).toBe(
      `PLAN_WRITE@${String(registry.getActive("PLAN_WRITE").definition.version)}+PLAN_REVIEW@${String(registry.getActive("PLAN_REVIEW").definition.version)}`,
    );
    expect(PLAN_PROMPT_VERSION).toBe("PLAN_WRITE@4+PLAN_REVIEW@6");
  });
});

describe("6. the second redraft: this run's round 2", () => {
  // The run's timings: gather 774, write 58437, review1 49888, redraft1
  // 57078, review2 51227 ms.
  const elapsed = 774 + 58_437 + 49_888 + 57_078 + 51_227;
  const input = {
    redrafts: 1,
    scores: [92, 90],
    elapsedMs: elapsed,
    lastRedraftMs: 57_078,
    lastReviewMs: 51_227,
  };
  const round2 = [
    ...reviewPoints(R1_ROUND2, "R1"),
    ...reviewPoints(R2_ROUND2, "R2"),
  ];

  it("as it ran: 3 points on no step (one of them the date mistake) stopped it", () => {
    const rebase = {
      reviewer: "R2" as const,
      item: "feasibility" as const,
      ...REBASE,
    };
    expect(redraftShape([...round2, rebase])).toEqual({
      merged: 11,
      unstepped: 3,
    });
    expect(anotherRedraft({ ...input, points: [...round2, rebase] })).toEqual({
      go: false,
      reason: "points not specific or too many",
    });
  });

  it("with the date known, the same round redrafts once more within the budget", () => {
    expect(redraftShape(round2)).toEqual({ merged: 10, unstepped: 2 });
    expect(anotherRedraft({ ...input, points: round2 })).toEqual({
      go: true,
      reason: "within reach",
    });
    expect(elapsed + 57_078 + 51_227).toBeLessThanOrEqual(
      PLAN_JOB_TIME_BUDGET_MS,
    );
  });
});

describe("7. why integrity was flagged, without the words", () => {
  it("names the item, step and refs, never the problem or the exposed words", () => {
    const flagged = result({
      noInventedFacts: {
        score: 10,
        defects: [
          defect(
            "s6",
            "Say the runway as their estimate.",
            ["F73"],
            "The step states a private runway of three months as fact.",
          ),
        ],
      },
      firewall: {
        held: false,
        defects: [
          {
            stepKey: "s7",
            problem: "It quotes Aster's private note.",
            fix: "Remove it.",
            exposed: "Aster's partner thinks the margin is weak",
            refs: ["F16"],
          },
        ],
      },
    });
    const reason = integrityReason(flagged);
    expect(reason).toEqual([
      {
        item: "firewall",
        defects: [{ stepKey: "s7", refs: ["F16"], exposedNamed: true }],
      },
      {
        item: "noInventedFacts",
        score: 10,
        defects: [{ stepKey: "s6", refs: ["F73"] }],
      },
    ]);
    const logged = JSON.stringify(reason);
    expect(logged).not.toMatch(/margin|runway|private note/u);
    expect(integrityReason(result({}))).toEqual([]);
  });
});
