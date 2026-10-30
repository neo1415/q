import { describe, expect, it } from "vitest";

import {
  QPlanSchema,
  WORKFORCE_PLAN_LIVE_STEPS,
  type WorkforceLiveStageName,
} from "@capital-q/contracts";
import {
  countRoundTrip,
  createRoundTripCounter,
  withRoundTripCounter,
} from "@capital-q/database";
import { PLAN_F03_ASK } from "@capital-q/q-core";
import type { QToolCallOutcome, QToolPort } from "@capital-q/q-runtime";
import { createSituationAssembler } from "@capital-q/q-specialists";

import type { LivePatch } from "../src/composition/workforce/live.js";
import {
  classifyStep,
  deckFacts,
  groundPlan,
  planRoster,
  planStartLine,
  PLAN_JOB_MODEL_CALLS_MAX,
  reviewOf,
  runPlanJob,
  situationText,
  withFacts,
  type PlanJobPayload,
} from "../src/composition/workforce/plan-job.js";
import { routesToPlan } from "../src/composition/workforce/plans.js";
import {
  COMPANY,
  FOUNDER_DOSSIER,
  FOUNDER_PLAN,
  INVESTOR_DOSSIER,
  INVESTOR_ORG,
  INVESTOR_PLAN,
  JOB,
  LEAD_RUN,
  RUN,
  TENANT,
  contextOf,
  fakeAssembler,
  fakePlanModels,
  founder,
  investor,
  memoryPlanStore,
  review,
} from "./plan-fixtures.js";

/**
 * Situation-first planning S4: the plan job. The owner's founder example
 * end to end with fake models: stages in order, a plan whose every step
 * cites the situation, two reviews in parallel, one redraft on a defect,
 * the plan kept as a version, the card. Code owns owners, approval and
 * cites; at most six model calls; the dossier within its round trips.
 */

const founderPayload = (
  ask: string,
  over: Partial<PlanJobPayload> = {},
): PlanJobPayload => ({
  kind: "PLAN",
  ownerUserId: founder.userId,
  ask,
  summary: `Your plan: ${ask}`.slice(0, 400),
  subject: { side: "FOUNDER", companyId: COMPANY },
  research: "NONE",
  deliverable: "PLAN",
  mode: "NEW",
  planId: null,
  fromVersion: null,
  directionId: null,
  ...over,
});

function harness(input: {
  readonly dossier: typeof FOUNDER_DOSSIER;
  readonly writes: Parameters<typeof fakePlanModels>[0]["writes"];
  readonly reviews: Parameters<typeof fakePlanModels>[0]["reviews"];
  readonly deck?: readonly ReturnType<typeof deckFacts>[number][];
}) {
  const plans = memoryPlanStore();
  const { assembler, calls: assemblerCalls } = fakeAssembler(input.dossier);
  const { models, calls } = fakePlanModels(input);
  const stages: WorkforceLiveStageName[] = [];
  const progress = (patch: LivePatch) => {
    if (stages.at(-1) !== patch.stage) stages.push(patch.stage);
  };
  const dependencies = {
    assembler,
    toolContext: (actor: typeof founder) => Promise.resolve(contextOf(actor)),
    models,
    store: plans.store,
    documents: () => Promise.resolve(input.deck ?? []),
    now: () => new Date("2026-10-28T10:00:00.000Z"),
  };
  return { plans, assemblerCalls, calls, stages, progress, dependencies };
}

const ASK = "how do I improve my chances of getting investment";

describe("the plan job: the founder example end to end", () => {
  it("gathers, reads, drafts, reviews twice, redrafts once, keeps the plan and offers the card", async () => {
    const h = harness({
      dossier: FOUNDER_DOSSIER,
      writes: [FOUNDER_PLAN, FOUNDER_PLAN],
      // Round 1: R1 finds a specificity defect (92), R2 passes; round 2 both pass.
      reviews: [review(8), review(0), review(0), review(0)],
    });
    const outcome = await runPlanJob(h.dependencies, {
      actor: founder,
      owner: { tenantId: TENANT, userId: founder.userId },
      jobId: JOB,
      leadRunId: LEAD_RUN,
      runId: RUN,
      payload: founderPayload(ASK),
      progress: h.progress,
    });

    expect(outcome.status).toBe("OFFERED");
    if (outcome.status !== "OFFERED") return;
    // Stages in order: the plan's own step bar, a redraft between reviews.
    expect(h.stages).toEqual([
      "GATHERING",
      "READING_DOCUMENTS",
      "PLANNING",
      "REVIEWING_PLAN",
      "PLANNING",
      "REVIEWING_PLAN",
      "FILING",
    ]);
    for (const stage of h.stages) {
      expect(WORKFORCE_PLAN_LIVE_STEPS).toContain(stage);
    }
    // The subject is their own company, resolved by code, read as them.
    expect(h.assemblerCalls[0]).toEqual({
      kind: "assemble",
      subject: { side: "FOUNDER", companyId: COMPANY },
    });
    // Six model calls: write, two reviews, a redraft, two reviews.
    expect(outcome.modelCalls).toBe(6);
    expect(outcome.modelCalls).toBeLessThanOrEqual(PLAN_JOB_MODEL_CALLS_MAX);
    expect(h.calls.map((call) => call.task)).toEqual([
      "WRITE",
      "REVIEW",
      "REVIEW",
      "WRITE",
      "REVIEW",
      "REVIEW",
    ]);
    // The two reviews are independent: one per focus.
    expect(
      h.calls
        .filter((call) => call.task === "REVIEW")
        .map((call) => call.focus),
    ).toEqual([
      "COVERAGE_AND_SPECIFICITY",
      "FEASIBILITY_AND_INVENTED_FACTS",
      "COVERAGE_AND_SPECIFICITY",
      "FEASIBILITY_AND_INVENTED_FACTS",
    ]);
    // The redraft carries the reviewer's numbered defect.
    const redraft = h.calls[3];
    expect(redraft?.mode).toBe("REDRAFT");
    expect(redraft?.fixes).toContain(
      "1. [s2] The slide's step does not say which figures",
    );

    const plan = h.plans.latest(outcome.planId);
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    expect(QPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.version).toBe(1);
    expect(plan.status).toBe("OFFERED");
    expect(plan.review?.fullyReviewed).toBe(true);
    expect(
      plan.review?.reviews.map((one) => [one.reviewer, one.round, one.score]),
    ).toEqual([
      ["R1", 2, 100],
      ["R2", 2, 100],
    ]);
    expect(plan.review?.redrafts).toBe(1);
    // At least four specific steps, each citing the situation.
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    const facts = new Set(
      FOUNDER_DOSSIER.sections.flatMap((section) =>
        section.facts.map((fact) => fact.ref),
      ),
    );
    for (const step of plan.steps) {
      expect(step.cites.length).toBeGreaterThan(0);
      for (const cite of step.cites) expect(facts.has(cite)).toBe(true);
    }
    // The invented step (F42 only) is dropped; the invented cite F99 is dropped.
    expect(plan.steps.map((one) => one.key)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
    ]);
    expect(plan.steps[2]?.cites).toEqual(["F7"]);
    // Code decides owner and approval: a proposal is Q-prepared and asks
    // first; a "Q" task is the person's; TOGETHER kept with a proposal.
    expect(
      plan.steps.map((one) => [
        one.key,
        one.owner,
        one.action.kind,
        one.needsApproval,
      ]),
    ).toEqual([
      ["s1", "Q", "TOOL_PROPOSAL", true],
      ["s2", "YOU", "TASK", false],
      ["s3", "YOU", "TASK", false],
      ["s4", "Q", "TOOL_PROPOSAL", true],
      ["s5", "TOGETHER", "TOOL_PROPOSAL", true],
    ]);
    // A step that needs approval waits on the person's earlier step sharing its facts.
    expect(plan.steps[4]?.waitsFor).toEqual([]);
    // The card and Q's line, code's words.
    expect(outcome.block).toEqual({
      kind: "PLAN",
      planId: outcome.planId,
      version: 1,
      title: "Improve your chances of getting investment",
      steps: 5,
      reviewed: true,
      affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
    });
    expect(outcome.line).toContain("Your plan is ready: 5 steps");
    expect(outcome.line).toContain("First: Reply to Kestrel Ventures");
    expect(outcome.line).toContain(
      "Execute it, put it on your board, or tell me what to change.",
    );
    expect(outcome.line).not.toMatch(
      /\b(job|specialist|lane|workforce|agent)\b/iu,
    );
    // The team thread: status lines a person may see, in order.
    expect(
      h.plans.thread
        .filter((one) => one.kind === "STATUS")
        .map((one) => one.text),
    ).toEqual([
      "Gathering your situation",
      "Drafting the plan",
      "Reviewing the plan",
      "Reviewing the revised plan",
      "The plan is ready",
    ]);
    // The plan as delivered, for the report.
    console.info(
      `FOUNDER PLAN v${String(plan.version)} (${plan.review?.fullyReviewed === true ? "fully reviewed" : "draft"}, ${String(outcome.modelCalls)} model calls)\n${plan.steps
        .map(
          (one, index) =>
            `${String(index + 1)}. [${one.owner}${one.needsApproval ? ", asks first" : ""}] ${one.title} -- ${one.why} (${one.cites.join(", ")})${one.due === null ? "" : ` due ${one.due}`}`,
        )
        .join("\n")}`,
    );
  });

  it("offers a plan both reviews keep failing as a draft, with what is open, within nine calls", async () => {
    const h = harness({
      dossier: FOUNDER_DOSSIER,
      writes: [FOUNDER_PLAN],
      reviews: [review(10), review(4, "feasibility")],
    });
    const outcome = await runPlanJob(h.dependencies, {
      actor: founder,
      owner: { tenantId: TENANT, userId: founder.userId },
      jobId: JOB,
      leadRunId: LEAD_RUN,
      runId: RUN,
      payload: founderPayload(ASK),
    });
    expect(outcome.status).toBe("OFFERED");
    if (outcome.status !== "OFFERED") return;
    // 90 and 96 are within reach: one more redraft (write, 2 x 3 reviews,
    // 2 redrafts), then a draft.
    expect(outcome.modelCalls).toBe(9);
    const plan = h.plans.latest(outcome.planId);
    expect(plan?.review?.redrafts).toBe(2);
    expect(plan?.review?.fullyReviewed).toBe(false);
    expect(plan?.review?.openPoints.length).toBeGreaterThan(0);
    expect(outcome.block.reviewed).toBe(false);
    // Live 2026-10-29: the card said only "draft". It says what the
    // reviews still want, by step number, with no fact codes.
    expect(outcome.line).toContain(
      "It's a draft: the two reviews didn't pass it yet. What they still want:",
    );
    for (const point of plan?.review?.openPoints ?? []) {
      expect(point).not.toMatch(/\[s\w*\]|\bF\d+\b|Fix:/u);
    }
  });

  it("an invented fact is fatal in review whatever the total", () => {
    const fatal = review(1, "noInventedFacts");
    const mapped = reviewOf(fatal, "R2", 1, "PLAN_WRITE@1+PLAN_REVIEW@1");
    expect(mapped.score).toBe(99);
    expect(mapped.integrityFailed).toBe(true);
    expect(mapped.passed).toBe(false);
    // The contract's six items hold every point (sums preserved).
    expect(mapped.items.reduce((sum, row) => sum + row.score, 0)).toBe(99);
  });

  it("planning that fails still answers from what Q holds", async () => {
    const h = harness({
      dossier: FOUNDER_DOSSIER,
      writes: [null],
      reviews: [],
    });
    const outcome = await runPlanJob(h.dependencies, {
      actor: founder,
      owner: { tenantId: TENANT, userId: founder.userId },
      jobId: JOB,
      leadRunId: LEAD_RUN,
      runId: RUN,
      payload: founderPayload(ASK),
    });
    expect(outcome.status).toBe("ANSWERED");
    if (outcome.status !== "ANSWERED") return;
    expect(outcome.line).toContain("here is where things stand");
    expect(outcome.line).toContain("Kestrel Ventures");
    expect(outcome.line).not.toMatch(/nothing has started/iu);
  });

  it("a retried job keeps one plan: the version already written is delivered", async () => {
    const h = harness({
      dossier: FOUNDER_DOSSIER,
      writes: [FOUNDER_PLAN],
      reviews: [review(0)],
    });
    const input = {
      actor: founder,
      owner: { tenantId: TENANT, userId: founder.userId },
      jobId: JOB,
      leadRunId: LEAD_RUN,
      runId: RUN,
      payload: founderPayload(ASK),
    };
    const first = await runPlanJob(h.dependencies, input);
    const second = await runPlanJob(h.dependencies, input);
    expect(first.status).toBe("OFFERED");
    expect(second.status).toBe("OFFERED");
    if (first.status !== "OFFERED" || second.status !== "OFFERED") return;
    expect(second.planId).toBe(first.planId);
    expect(h.plans.versions.get(first.planId)?.length).toBe(1);
  });
});

describe("the exact F03 ask (addendum 3)", () => {
  it("reads as a review of their own documents, about their own company, and starts", async () => {
    // Live 2026-10-29: a review of their documents is that work, done by
    // the team job -- never a plan whose first step is the review.
    const reading = {
      kind: "NONE",
      research: "NONE",
      side: "FOUNDER",
      subject: "OWN",
      deliverable: "DOCUMENT_REVIEW",
    } as const;
    expect(routesToPlan(reading)).toBe(false);
    expect(routesToPlan({ ...reading, deliverable: "ANALYSIS" })).toBe(false);
    expect(
      routesToPlan({
        ...reading,
        kind: "GOAL",
        deliverable: "DOCUMENT_REVIEW",
      }),
    ).toBe(false);
    // The CFO curveball and an investor's two weeks on a pipeline company
    // are plans of their own.
    expect(
      routesToPlan({ ...reading, kind: "GOAL", deliverable: "PLAN" }),
    ).toBe(true);
    expect(
      routesToPlan({
        ...reading,
        kind: "GOAL",
        side: "INVESTOR",
        deliverable: "PLAN",
      }),
    ).toBe(true);
    const start = planStartLine(reading.deliverable, reading.research);
    expect(start).toContain("going through your documents now");
    expect(start).not.toMatch(
      /nothing has started|questions for the founder|who it's about|memo/iu,
    );

    const h = harness({
      dossier: FOUNDER_DOSSIER,
      writes: [
        {
          ...FOUNDER_PLAN,
          goal: "Confirm the facts from your deck and financials before your record changes",
          clarification: {
            question: "Should I also compare them with your profile?",
            default: "your deck and financial documents only",
          },
        },
      ],
      reviews: [review(0)],
      deck: deckFacts({
        sections: [
          {
            section: "BUSINESS_MODEL",
            status: "CONTRADICTORY",
            summary: "slide 6 says USD 40 per clinic, slide 11 says USD 55",
          },
          {
            section: "TRACTION",
            status: "PRESENT",
            summary: "120 clinics live",
          },
        ],
      }),
    });
    const outcome = await runPlanJob(h.dependencies, {
      actor: founder,
      owner: { tenantId: TENANT, userId: founder.userId },
      jobId: JOB,
      leadRunId: LEAD_RUN,
      runId: RUN,
      payload: founderPayload(PLAN_F03_ASK, { deliverable: "DOCUMENT_REVIEW" }),
    });
    expect(h.assemblerCalls[0]?.subject).toEqual({
      side: "FOUNDER",
      companyId: COMPANY,
    });
    expect(outcome.status).toBe("OFFERED");
    if (outcome.status !== "OFFERED") return;
    // The one question is asked with the default already followed.
    expect(outcome.line).toContain(
      "I went with your deck and financial documents only. Should I also compare them with your profile?",
    );
  });
});

describe("an investor's plan", () => {
  it("how do I get better deal flow: their own mandate, investor actions only", async () => {
    const h = harness({
      dossier: INVESTOR_DOSSIER,
      writes: [INVESTOR_PLAN],
      reviews: [review(0)],
    });
    const outcome = await runPlanJob(h.dependencies, {
      actor: investor,
      owner: { tenantId: TENANT, userId: investor.userId },
      jobId: JOB,
      leadRunId: LEAD_RUN,
      runId: RUN,
      payload: {
        ...founderPayload("how do I get better deal flow"),
        ownerUserId: investor.userId,
        subject: { side: "INVESTOR", investorOrganisationId: INVESTOR_ORG },
      },
      progress: h.progress,
    });
    expect(outcome.status).toBe("OFFERED");
    if (outcome.status !== "OFFERED") return;
    // No documents stage on the investor side.
    expect(h.stages).toEqual([
      "GATHERING",
      "PLANNING",
      "REVIEWING_PLAN",
      "FILING",
    ]);
    expect(outcome.modelCalls).toBe(3);
    const plan = h.plans.latest(outcome.planId);
    expect(plan?.side).toBe("INVESTOR");
    expect(
      plan?.steps.map((one) => [one.owner, one.action.kind, one.needsApproval]),
    ).toEqual([
      ["YOU", "TASK", false],
      ["TOGETHER", "APP_ACTION", true],
      ["Q", "WORKFORCE", true],
      ["YOU", "TASK", false],
    ]);
    // The roster never offers an investor a founder's actions.
    const names = planRoster("INVESTOR").map((entry) => entry.name);
    expect(names).not.toContain("propose_connection_request");
    expect(names).not.toContain("deck.read_again");
    expect(planRoster("FOUNDER").map((entry) => entry.name)).not.toContain(
      "investor.mandate.change",
    );
  });
});

describe("grounding and classification are code's", () => {
  it("an action outside the roster becomes the person's task", () => {
    const roster = planRoster("FOUNDER");
    expect(
      classifyStep(
        { owner: "Q", action: { kind: "TOOL_PROPOSAL", tool: "run_sql" } },
        roster,
      ),
    ).toEqual({ owner: "YOU", action: { kind: "TASK" }, needsApproval: false });
    expect(
      classifyStep(
        { owner: "Q", action: { kind: "WORKFORCE", roles: ["RESEARCH"] } },
        roster,
      ),
    ).toEqual({
      owner: "Q",
      action: { kind: "WORKFORCE", roles: ["RESEARCH"] },
      needsApproval: false,
    });
    expect(
      classifyStep(
        { owner: "Q", action: { kind: "WORKFORCE", roles: ["OUTREACH"] } },
        roster,
      ).needsApproval,
    ).toBe(true);
  });

  it("the situation is shown with refs and truth classes; unknown stays unknown", () => {
    const text = situationText(FOUNDER_DOSSIER);
    expect(text).toContain(
      "F4 (VERIFIED, as of 2026-10-27) Kestrel Ventures expressed interest",
    );
    expect(text).toContain(
      "F8 (USER_CLAIM, as of 2026-10-27) Raise: you report",
    );
    expect(text).toContain("DATA ROOM [DATA_ROOM]: UNAVAILABLE (not known)");
    expect(text).not.toContain("MANDATE");
  });

  it("deck facts land in the DECK section with refs after the last one", () => {
    const facts = deckFacts({
      sections: [
        { section: "BUSINESS_MODEL", status: "NOT_IN_DECK", summary: null },
      ],
    });
    const next = withFacts(FOUNDER_DOSSIER, "DECK", facts);
    const deck = next.sections.find((section) => section.source === "DECK");
    expect(deck?.facts.map((fact) => fact.ref)).toEqual(["F6", "F9"]);
    expect(deck?.facts[1]?.statement).toBe(
      "Q's reading of your deck found no business model section.",
    );
  });

  it("a written plan's refs are grounded: unresolved cites and steps without any are dropped", () => {
    const grounded = groundPlan({
      written: FOUNDER_PLAN,
      dossier: FOUNDER_DOSSIER,
      roster: planRoster("FOUNDER"),
    });
    expect(grounded.droppedSteps).toBe(1);
    expect(grounded.droppedCites).toBe(2);
  });
});

describe("speed budgets (addendum 4)", () => {
  it("assembling the founder's situation costs at most 25 round trips", async () => {
    const calls: string[] = [];
    const tools: QToolPort = {
      offer: () => Promise.resolve([]),
      execute: (proposal) => {
        calls.push(proposal.name);
        countRoundTrip();
        return Promise.resolve({
          callId: proposal.callId,
          toolName: proposal.name,
          toolVersion: 1,
          classification: "READ_ONLY",
          latencyMs: 0,
          status: "SUCCEEDED",
          failureCode: null,
          sensitivity: "CONFIDENTIAL",
          result: { ok: true, data: {} },
        } as QToolCallOutcome);
      },
    };
    const assembler = createSituationAssembler({
      tools,
      memory: () => {
        countRoundTrip();
        return Promise.resolve([]);
      },
      activity: () => {
        countRoundTrip();
        return Promise.resolve([]);
      },
    });
    const counter = createRoundTripCounter(RUN);
    await withRoundTripCounter(counter, () =>
      assembler.assemble({
        context: contextOf(founder),
        subject: { side: "FOUNDER", companyId: COMPANY },
        ask: ASK,
      }),
    );
    console.info(
      `situation round trips: ${String(counter.count)} (${String(calls.length)} tool reads)`,
    );
    expect(counter.count).toBeLessThanOrEqual(25);
  });
});
