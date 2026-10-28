import { describe, expect, it } from "vitest";

import {
  Q_PLAN_RUBRIC_ITEMS,
  Q_PLAN_RUBRIC_WEIGHTS,
  Q_SITUATION_SOURCES,
  Q_SITUATION_SOURCES_BY_SIDE,
  Q_VISIBLE_STAGES,
  Q_VISIBLE_STAGE_LABELS,
  QPlanBlockSchema,
  QPlanReviewSchema,
  QPlanReviewSummarySchema,
  QPlanSchema,
  QResultBlockSchema,
  QSituationDossierSchema,
  QTeamThreadAppendSchema,
  QTeamThreadEntrySchema,
  situationFacts,
  workforceExpected,
  type QPlan,
  type QPlanReview,
  type QSituationDossier,
  type QSituationFact,
} from "../src/index.js";

function nth<T>(list: T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item ${String(index)}`);
  return item;
}

const PLAN_ID = "7f0c3a52-2c55-4c71-9a4a-6f1e2d3c4b5a";
const JOB_ID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const REL_ID = "2c3d4e5f-6071-4829-9bac-1d2e3f4a5b6c";

const fact = (
  ref: string,
  overrides: Partial<QSituationFact> = {},
): QSituationFact => ({
  ref,
  statement: "Lagos Ventures left a note: they want to see churn by cohort.",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  asOf: "2026-10-27T09:00:00Z",
  provenance: {
    tool: "list_incoming_interest",
    record: { kind: "RELATIONSHIP", id: REL_ID },
    url: null,
  },
  label: "relationship_shared",
  category: null,
  ...overrides,
});

const founderDossier = (): QSituationDossier => ({
  version: "situation/v1",
  side: "FOUNDER",
  asOf: "2026-10-28T10:00:00Z",
  sections: [
    {
      source: "INTEREST",
      status: "READ",
      reason: null,
      facts: [fact("F1")],
      truncated: false,
    },
    {
      source: "CAPITAL",
      status: "READ",
      reason: null,
      facts: [
        fact("F2", {
          statement: "Raising $1.5M seed; $600k committed.",
          truthClass: "USER_CLAIM",
          provenance: {
            tool: "get_capital_objective",
            record: null,
            url: null,
          },
          label: "founder_private",
          category: "RAISE_TARGET",
        }),
      ],
      truncated: false,
    },
    {
      source: "PUBLIC",
      status: "READ",
      reason: null,
      facts: [
        fact("F3", {
          statement: "Nigeria's central bank issued new open-banking rules.",
          truthClass: "VERIFIED",
          evidenceStatus: "EXTERNALLY_VERIFIED",
          asOf: "2026-10-20",
          provenance: {
            tool: "research_public_web",
            record: { kind: "PUBLIC_PAGE", id: "cbn.gov.ng" },
            url: "https://www.cbn.gov.ng/open-banking",
          },
          label: "public_external",
        }),
      ],
      truncated: false,
    },
    {
      source: "DECK",
      status: "UNAVAILABLE",
      reason: "TIMED_OUT",
      facts: [],
      truncated: false,
    },
    {
      source: "MANDATE",
      status: "NOT_APPLICABLE",
      reason: null,
      facts: [],
      truncated: false,
    },
  ],
  unknowns: ["DECK"],
  publicTopics: ["Nigeria open banking", "SME lending fintech"],
});

const review = (reviewer: "R1" | "R2", full = true): QPlanReview => {
  const items = Q_PLAN_RUBRIC_ITEMS.map((item) => ({
    item,
    score:
      Q_PLAN_RUBRIC_WEIGHTS[item] - (full || item !== "SPECIFICITY" ? 0 : 5),
    max: Q_PLAN_RUBRIC_WEIGHTS[item],
    note: "",
  }));
  const score = items.reduce((total, row) => total + row.score, 0);
  return {
    reviewer,
    round: 1,
    score,
    passed: score >= 99,
    items,
    fixes: full ? [] : ["Name the investor in step 2."],
    integrityFailed: false,
    promptVersion: "plan-review/v1",
  };
};

const plan = (): QPlan =>
  QPlanSchema.parse({
    planId: PLAN_ID,
    version: 1,
    side: "FOUNDER",
    goal: "Close my seed round by March.",
    situationSummary:
      "Two investors are interested; one wants churn data; the deck could not be read.",
    situationRefs: ["F1", "F2", "F3"],
    steps: [
      {
        key: "churn_cohorts",
        title: "Send Lagos Ventures churn by cohort",
        why: "They asked for it in their interest note (F1).",
        cites: ["F1"],
        owner: "TOGETHER",
        action: { kind: "WORKFORCE", roles: ["DOCUMENTS"] },
        needsApproval: true,
        due: "2026-11-04",
        evidenceNeeded: ["Cohort churn table for 2025-2026"],
        status: "TODO",
        boardItemId: null,
        proposalId: null,
        reminderId: null,
        jobId: null,
      },
      {
        key: "follow_up",
        title: "Book a call with Lagos Ventures",
        why: "Once they have the numbers, the round needs $900k more (F2).",
        cites: ["F1", "F2"],
        owner: "Q",
        action: { kind: "TOOL_PROPOSAL", tool: "propose_meeting" },
        needsApproval: true,
        due: null,
        evidenceNeeded: [],
        status: "TODO",
        waitsFor: [
          { kind: "STEP_DONE", stepKey: "churn_cohorts" },
          { kind: "THEY_REPLIED", relationshipId: REL_ID },
        ],
        boardItemId: null,
        proposalId: null,
        reminderId: null,
        jobId: null,
      },
    ],
    openQuestions: ["Is the March date fixed by a runway constraint?"],
    review: {
      rubricVersion: "plan-rubric/v1",
      threshold: 99,
      reviews: [review("R1"), review("R2")],
      redrafts: 0,
      fullyReviewed: true,
      openPoints: [],
    },
    status: "OFFERED",
    supersedes: null,
    createdAt: "2026-10-28T10:01:00Z",
  });

describe("QSituationDossierSchema", () => {
  it("round-trips a founder dossier", () => {
    const dossier = founderDossier();
    const parsed = QSituationDossierSchema.parse(
      JSON.parse(JSON.stringify(dossier)),
    );
    expect(parsed).toEqual(dossier);
    expect(situationFacts(parsed).map((f) => f.ref)).toEqual([
      "F1",
      "F2",
      "F3",
    ]);
  });

  it("keeps an unreadable source as not known, never as none", () => {
    const dossier = founderDossier();
    const withFacts = structuredClone(dossier);
    withFacts.sections[3] = {
      ...nth(withFacts.sections, 3),
      facts: [fact("F9")],
    };
    expect(QSituationDossierSchema.safeParse(withFacts).success).toBe(false);
    const unlisted = { ...dossier, unknowns: [] };
    expect(QSituationDossierSchema.safeParse(unlisted).success).toBe(false);
    const noReason = structuredClone(dossier);
    noReason.sections[3] = { ...nth(noReason.sections, 3), reason: null };
    expect(QSituationDossierSchema.safeParse(noReason).success).toBe(false);
  });

  it("never holds the other side's private material", () => {
    const founder = founderDossier();
    nth(founder.sections, 0).facts = [
      fact("F1", { label: "investor_private" }),
    ];
    expect(QSituationDossierSchema.safeParse(founder).success).toBe(false);

    const investor: QSituationDossier = {
      version: "situation/v1",
      side: "INVESTOR",
      asOf: "2026-10-28T10:00:00Z",
      sections: [
        {
          source: "RELATIONSHIPS",
          status: "READ",
          reason: null,
          facts: [
            fact("F1", { label: "founder_private", category: "CASH_POSITION" }),
          ],
          truncated: false,
        },
      ],
      unknowns: [],
      publicTopics: [],
    };
    expect(QSituationDossierSchema.safeParse(investor).success).toBe(false);
    nth(investor.sections, 0).facts = [fact("F1")];
    expect(QSituationDossierSchema.safeParse(investor).success).toBe(true);
  });

  it("reads a side's own sources only", () => {
    const founder = founderDossier();
    founder.sections[4] = {
      source: "MANDATE",
      status: "READ",
      reason: null,
      facts: [],
      truncated: false,
    };
    expect(QSituationDossierSchema.safeParse(founder).success).toBe(false);
    for (const side of ["FOUNDER", "INVESTOR"] as const) {
      for (const source of Q_SITUATION_SOURCES_BY_SIDE[side]) {
        expect(Q_SITUATION_SOURCES).toContain(source);
      }
    }
    expect(Q_SITUATION_SOURCES_BY_SIDE.FOUNDER).not.toContain("MANDATE");
    expect(Q_SITUATION_SOURCES_BY_SIDE.INVESTOR).not.toContain("CAPITAL");
  });

  it("labels each fact once, and only public facts carry a page", () => {
    const duplicate = founderDossier();
    nth(duplicate.sections, 1).facts = [fact("F1")];
    expect(QSituationDossierSchema.safeParse(duplicate).success).toBe(false);
    const leaked = founderDossier();
    nth(leaked.sections, 0).facts = [
      fact("F1", {
        provenance: {
          tool: "list_incoming_interest",
          record: null,
          url: "https://example.com/",
        },
      }),
    ];
    expect(QSituationDossierSchema.safeParse(leaked).success).toBe(false);
    const unsourced = founderDossier();
    nth(unsourced.sections, 2).facts = [
      fact("F3", { label: "public_external" }),
    ];
    expect(QSituationDossierSchema.safeParse(unsourced).success).toBe(false);
  });
});

describe("QPlanSchema", () => {
  it("round-trips a reviewed plan", () => {
    const value = plan();
    expect(QPlanSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(nth(value.steps, 0).waitsFor).toEqual([]);
  });

  it("drops nothing silently: an uncited or unresolvable step fails", () => {
    const value = plan();
    const uncited = structuredClone(value);
    nth(uncited.steps, 0).cites = [];
    expect(QPlanSchema.safeParse(uncited).success).toBe(false);
    const invented = structuredClone(value);
    nth(invented.steps, 0).cites = ["F42"];
    expect(QPlanSchema.safeParse(invented).success).toBe(false);
  });

  it("keeps step keys unique and waits only on earlier steps", () => {
    const value = plan();
    const twice = structuredClone(value);
    nth(twice.steps, 1).key = "churn_cohorts";
    nth(twice.steps, 1).waitsFor = [];
    expect(QPlanSchema.safeParse(twice).success).toBe(false);
    const forward = structuredClone(value);
    nth(forward.steps, 0).waitsFor = [
      { kind: "STEP_DONE", stepKey: "follow_up" },
    ];
    expect(QPlanSchema.safeParse(forward).success).toBe(false);
  });

  it("never gives Q a bare task, and is reviewed before it is offered", () => {
    const value = plan();
    const qTask = structuredClone(value);
    nth(qTask.steps, 0).owner = "Q";
    nth(qTask.steps, 0).action = { kind: "TASK" };
    expect(QPlanSchema.safeParse(qTask).success).toBe(false);
    expect(QPlanSchema.safeParse({ ...value, review: null }).success).toBe(
      false,
    );
    expect(
      QPlanSchema.safeParse({ ...value, review: null, status: "DRAFT" })
        .success,
    ).toBe(true);
  });

  it("chains versions", () => {
    const value = plan();
    expect(
      QPlanSchema.safeParse({ ...value, version: 2, supersedes: 1 }).success,
    ).toBe(true);
    expect(
      QPlanSchema.safeParse({ ...value, version: 2, supersedes: null }).success,
    ).toBe(false);
    expect(
      QPlanSchema.safeParse({ ...value, version: 1, supersedes: 1 }).success,
    ).toBe(false);
  });
});

describe("plan reviews", () => {
  it("weights the rubric to 100", () => {
    const total = Object.values(Q_PLAN_RUBRIC_WEIGHTS).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBe(100);
  });

  it("decides passing from the bar and integrity, never from the reviewer's say-so", () => {
    expect(QPlanReviewSchema.safeParse(review("R1")).success).toBe(true);
    const short = review("R1", false);
    expect(short.passed).toBe(false);
    expect(
      QPlanReviewSchema.safeParse({ ...short, passed: true }).success,
    ).toBe(false);
    expect(
      QPlanReviewSchema.safeParse({ ...review("R2"), integrityFailed: true })
        .success,
    ).toBe(false);
    expect(
      QPlanReviewSchema.safeParse({
        ...review("R2"),
        integrityFailed: true,
        passed: false,
      }).success,
    ).toBe(true);
    expect(
      QPlanReviewSchema.safeParse({ ...review("R1"), score: 98 }).success,
    ).toBe(false);
  });

  it("offers a plan not fully reviewed only with what is open", () => {
    const summary = {
      rubricVersion: "plan-rubric/v1",
      threshold: 99,
      reviews: [review("R1"), review("R2", false)],
      redrafts: 2,
      fullyReviewed: false,
      openPoints: [],
    };
    expect(QPlanReviewSummarySchema.safeParse(summary).success).toBe(false);
    expect(
      QPlanReviewSummarySchema.safeParse({
        ...summary,
        openPoints: ["Step 2 names no investor."],
      }).success,
    ).toBe(true);
    expect(
      QPlanReviewSummarySchema.safeParse({ ...summary, fullyReviewed: true })
        .success,
    ).toBe(false);
  });
});

describe("the plan card and the team thread", () => {
  it("is a closed result block with three affordances", () => {
    const block = {
      kind: "PLAN",
      planId: PLAN_ID,
      version: 1,
      title: "Close my seed round by March",
      steps: 2,
      reviewed: true,
      affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
    };
    expect(QResultBlockSchema.parse(block)).toEqual(block);
    expect(
      QPlanBlockSchema.safeParse({
        ...block,
        affordances: ["EXECUTE", "EXECUTE"],
      }).success,
    ).toBe(false);
    expect(
      QPlanBlockSchema.safeParse({ ...block, affordances: ["DELETE"] }).success,
    ).toBe(false);
    expect(QPlanBlockSchema.safeParse({ ...block, steps: 0 }).success).toBe(
      false,
    );
  });

  it("lets the person, and only the person, give direction", () => {
    const entry = {
      id: JOB_ID,
      planId: PLAN_ID,
      jobId: null,
      kind: "DIRECTION",
      author: "PERSON",
      stepKey: null,
      factRef: null,
      text: "Leave the Lagos funds out for now.",
      seq: 3,
      createdAt: "2026-10-28T10:05:00Z",
    };
    expect(QTeamThreadEntrySchema.parse(entry)).toEqual(entry);
    expect(
      QTeamThreadEntrySchema.safeParse({ ...entry, author: "PLANNER" }).success,
    ).toBe(false);
    expect(
      QTeamThreadEntrySchema.safeParse({ ...entry, kind: "NOTE" }).success,
    ).toBe(false);
    expect(
      QTeamThreadEntrySchema.safeParse({ ...entry, planId: null }).success,
    ).toBe(false);
    expect(
      QTeamThreadAppendSchema.safeParse({
        planId: null,
        jobId: JOB_ID,
        kind: "FINDING",
        author: "RESEARCH",
        stepKey: "churn_cohorts",
        factRef: "F3",
        text: "New open-banking rules apply from January.",
        idempotencyKey: "thread:job:finding:1",
      }).success,
    ).toBe(true);
  });
});

describe("planning stages", () => {
  it("adds the four planning stages with plain labels", () => {
    for (const stage of [
      "GATHERING_SITUATION",
      "READING_DOCUMENTS",
      "DRAFTING_PLAN",
      "REVIEWING_PLAN",
    ] as const) {
      expect(Q_VISIBLE_STAGES).toContain(stage);
      expect(Q_VISIBLE_STAGE_LABELS[stage]).toMatch(/^[A-Z][a-z ]+$/u);
    }
    expect(workforceExpected("PLAN")).toEqual({
      kind: "PLAN",
      minMinutes: 1,
      maxMinutes: 2,
    });
  });
});
