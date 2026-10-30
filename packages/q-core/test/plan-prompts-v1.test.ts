import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMUNICATION_PROFILE,
  PLAN_F03_ASK,
  PLAN_READ_V1,
  PLAN_REVIEW_BAR,
  PLAN_WRITE_PERSON_SIDE,
  PLAN_REVIEW_V1,
  PLAN_RUBRIC_V1,
  PLAN_WRITE_FOUNDER_EXAMPLE,
  PLAN_WRITE_INVESTOR_EXAMPLE,
  PLAN_WRITE_V1,
  PlanReadResultSchema,
  PlanReviewResultSchema,
  PlanWriteResultSchema,
  PlanWriteStepSchema,
  UNTRUSTED_OPEN,
  createDefaultPromptRegistry,
  planReviewScore,
  renderPrompt,
  type PlanReviewResult,
} from "../src/index.js";

/**
 * Situation-first planning (design 2026-10-28, lane B slice S3): the plan
 * writer, its independent reviewer and the uploaded-plan reader.
 */

const render = (
  task: "PLAN_WRITE" | "PLAN_REVIEW" | "PLAN_READ",
  variables: Record<string, unknown>,
): string =>
  renderPrompt(createDefaultPromptRegistry(), {
    task,
    operatingMode: "ASSESSMENT",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes: "test",
    variables,
  })
    .messages.map((message) => message.content)
    .join("\n");

const SITUATION =
  "INTEREST (READ)\nF1 [USER_CLAIM] Kestrel Ventures: 'We need unit economics per clinic.'\nDECK (READ)\nF2 [Q_INFERENCE] Business model 1/5.";

/** The worked examples' step lines, as the model is shown them. */
const exampleSteps = (example: string): unknown[] =>
  example
    .split("\n")
    .filter((line) => line.startsWith('{"key"'))
    .map((line) => JSON.parse(line) as unknown);

const STEP = {
  key: "S1",
  title: "Send Kestrel Ventures per-clinic unit economics",
  why: "Kestrel asked for them before a call (F1); the deck lacks them (F2).",
  cites: ["F1", "F2"],
  owner: "TOGETHER",
  action: { kind: "TASK" },
  due: "2026-11-04",
  evidenceNeeded: [],
};

const fullReview = (): PlanReviewResult => ({
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
});

describe("PLAN_WRITE v1", () => {
  it("is registered (v4 is active, as reasoning work), structured", () => {
    const record = createDefaultPromptRegistry().getActive("PLAN_WRITE");
    expect(record.versionId).toBe("plan-write/v4");
    expect(record.definition.taskClass).toBe("EVIDENCE_SYNTHESIS");
    expect(PLAN_WRITE_V1.taskClass).toBe("STRUCTURED_EXTRACTION");
    expect(PLAN_WRITE_V1.output).toMatchObject({
      kind: "STRUCTURED",
      schemaName: "PlanWriteResult",
      schemaVersion: 1,
    });
  });

  it("renders with the ask, the dossier and findings fenced as data", () => {
    const text = render("PLAN_WRITE", {
      side: "FOUNDER",
      mode: "NEW",
      today: "2026-10-28",
      ask: "How do I improve my chances with investors?",
      situation: SITUATION,
      publicFindings: "",
      allowedActions: "propose_connection_request: ask to connect",
      priorPlan: "",
      fixes: "",
    });
    expect(text).toContain(
      "You write a plan for one person on Capital Q: a FOUNDER",
    );
    expect(text).toContain(`${UNTRUSTED_OPEN} source="situation">>>`);
    expect(text).toContain(`${UNTRUSTED_OPEN} source="ask">>>`);
    expect(text).toContain("counted from TODAY (2026-10-28)");
    expect(text).not.toMatch(/\{\{/u);
  });

  it("asks for specific, cited, honest steps", () => {
    const t = PLAN_WRITE_V1.template;
    expect(t).toMatch(/never generic/u);
    expect(t).toMatch(/at least one, written exactly as given/u);
    expect(t).toMatch(/Unknown stays unknown/u);
    expect(t).toMatch(/never as verified fact\. No confidence percentages/u);
    expect(t).toMatch(/never "none" and never a weakness/u);
    expect(t).toMatch(/Never name an action that is not listed/u);
  });

  it("carries a founder and an investor worked example that the schema accepts", () => {
    expect(PLAN_WRITE_V1.template).toContain(PLAN_WRITE_FOUNDER_EXAMPLE);
    expect(PLAN_WRITE_V1.template).toContain(PLAN_WRITE_INVESTOR_EXAMPLE);
    // The owner's founder case: the investor's note, the deck gap, the
    // reworded description, an intro and a regulation.
    expect(PLAN_WRITE_FOUNDER_EXAMPLE).toMatch(/their note/u);
    expect(PLAN_WRITE_FOUNDER_EXAMPLE).toMatch(/Reword your description to/u);
    expect(PLAN_WRITE_FOUNDER_EXAMPLE).toMatch(/Request an introduction/u);
    expect(PLAN_WRITE_FOUNDER_EXAMPLE).toMatch(/Digital Health Act/u);
    expect(PLAN_WRITE_INVESTOR_EXAMPLE).toMatch(/better deal flow/u);
    const founder = exampleSteps(PLAN_WRITE_FOUNDER_EXAMPLE);
    const investor = exampleSteps(PLAN_WRITE_INVESTOR_EXAMPLE);
    expect(founder).toHaveLength(5);
    expect(investor).toHaveLength(3);
    for (const step of [...founder, ...investor]) {
      expect(PlanWriteStepSchema.safeParse(step).success).toBe(true);
    }
    const plan = PlanWriteResultSchema.parse({
      goal: "Improve my chances with investors",
      side: "FOUNDER",
      situationSummary:
        "Kestrel asked for unit economics; the deck lacks them.",
      situationRefs: ["F1", "F3"],
      steps: founder,
      openQuestions: [
        "Whether Harbor Angels are still reviewing is not known.",
      ],
    });
    expect(plan.steps.map((step) => step.owner)).toEqual([
      "TOGETHER",
      "YOU",
      "YOU",
      "Q",
      "YOU",
    ]);
  });

  it("refuses a step without a cite, an unknown owner, an invented ref shape or a loose date", () => {
    expect(PlanWriteStepSchema.safeParse(STEP).success).toBe(true);
    expect(PlanWriteStepSchema.safeParse({ ...STEP, cites: [] }).success).toBe(
      false,
    );
    expect(
      PlanWriteStepSchema.safeParse({ ...STEP, owner: "UNKNOWN" }).success,
    ).toBe(false);
    expect(
      PlanWriteStepSchema.safeParse({ ...STEP, cites: ["fact one"] }).success,
    ).toBe(false);
    expect(
      PlanWriteStepSchema.safeParse({ ...STEP, due: "next week" }).success,
    ).toBe(false);
    expect(PlanWriteStepSchema.safeParse({ ...STEP, due: null }).success).toBe(
      true,
    );
    expect(
      PlanWriteStepSchema.safeParse({
        ...STEP,
        action: { kind: "WORKFORCE", roles: ["LEAD"] },
      }).success,
    ).toBe(false);
  });

  it("holds at most 12 steps", () => {
    const steps = Array.from({ length: 13 }, (_, i) => ({
      ...STEP,
      key: `S${String(i + 1)}`,
    }));
    expect(
      PlanWriteResultSchema.safeParse({
        goal: "g",
        side: "FOUNDER",
        situationSummary: "s",
        situationRefs: ["F1"],
        steps,
      }).success,
    ).toBe(false);
  });
});

/**
 * Addendum 3 (owner 2026-10-28): the live F03 ask was refused with "tell me
 * who it's about and what you want at the end". From the person's side,
 * the subject is their own company and the deliverable is in the ask.
 */
describe("PLAN_WRITE v1, from the person's side (addendum 3, F03)", () => {
  it("states rules 1-4 and 6 in the system text, with the F03 ask as the deliverable example", () => {
    expect(PLAN_WRITE_V1.template).toContain(PLAN_WRITE_PERSON_SIDE);
    const rules = PLAN_WRITE_PERSON_SIDE;
    expect(rules).toMatch(/1\. Never ask for what you already know/u);
    expect(rules).toMatch(
      /A founder's ask is about their own company unless they name another/u,
    );
    expect(rules).toMatch(/2\. Infer the deliverable from the ask\./u);
    expect(rules).toContain(PLAN_F03_ASK);
    expect(rules).toMatch(/do not ask what they want at the end/u);
    expect(rules).toMatch(/3\. Something useful at once/u);
    expect(rules).toMatch(/4\. Plain words for their side/u);
    expect(rules).toContain('"questions for the founder"');
    expect(rules).toMatch(/6\. Clarify by meaning, not by quiz/u);
    expect(rules).toMatch(/ONE plain question offering both readings/u);
  });

  it("renders the F03 ask for a founder", () => {
    const text = render("PLAN_WRITE", {
      side: "FOUNDER",
      mode: "NEW",
      today: "2026-10-28",
      ask: PLAN_F03_ASK,
      situation:
        "DATA_ROOM (READ)\nF1 [USER_CLAIM] Pitch deck v3 (uploaded 2026-10-27): 2025 revenue USD 410k.\nF2 [USER_CLAIM] Financials 2025.xlsx: 2025 revenue USD 380k.",
      publicFindings: "",
      allowedActions: "read_company_document: read one of their documents",
      priorPlan: "",
      fixes: "",
    });
    expect(text).toContain(
      `${UNTRUSTED_OPEN} source="ask">>>\n${PLAN_F03_ASK}`,
    );
  });

  it("an F03 plan resolves to their own documents and starts, with no clarification", () => {
    const plan = PlanWriteResultSchema.parse({
      goal: "Review my uploaded deck and financials and confirm the facts before the record changes",
      side: "FOUNDER",
      situationSummary:
        "Your deck and your 2025 financials are uploaded; they report different 2025 revenue (USD 410k vs 380k).",
      situationRefs: ["F1", "F2"],
      steps: [
        {
          key: "S1",
          title:
            "Read your deck and 2025 financials and extract the material company facts",
          why: "Both documents are uploaded (F1, F2) and you asked for their facts before your record changes.",
          cites: ["F1", "F2"],
          owner: "Q",
          action: { kind: "TOOL_PROPOSAL", tool: "read_company_document" },
          due: "2026-10-28",
          evidenceNeeded: [],
        },
        {
          key: "S2",
          title:
            "Confirm 2025 revenue: your deck says USD 410k, your financials USD 380k",
          why: "The two documents disagree (F1, F2); your record changes only with the figure you confirm.",
          cites: ["F1", "F2"],
          owner: "YOU",
          action: { kind: "TASK" },
          due: "2026-10-30",
          evidenceNeeded: ["which figure is right, and for which period"],
        },
      ],
    });
    expect(plan.clarification).toBeNull();
    expect(plan.steps[0]?.owner).toBe("Q");
  });

  it("asks at most one plain question, with its default, when two readings differ", () => {
    const parsed = PlanWriteResultSchema.parse({
      goal: "g",
      side: "FOUNDER",
      situationSummary: "s",
      situationRefs: ["F1"],
      steps: [STEP],
      clarification: {
        question:
          "Should I check only the deck, or the deck and your financials?",
        default: "The deck and your financials",
      },
    });
    expect(parsed.clarification?.default).toBe("The deck and your financials");
    expect(
      PlanWriteResultSchema.safeParse({
        ...parsed,
        clarification: { question: "Who is this about?" },
      }).success,
    ).toBe(false);
  });

  it("the reviewer scores asking for what Q knows and role-incorrect wording", () => {
    expect(PLAN_RUBRIC_V1.asksNothingKnown).toBe(10);
    expect(PLAN_RUBRIC_V1.roleCorrectWording).toBe(5);
    expect(PLAN_REVIEW_V1.template).toMatch(/not who it is about/u);
    expect(PLAN_REVIEW_V1.template).toMatch(/no internal words/u);
    expect(
      planReviewScore({
        ...fullReview(),
        asksNothingKnown: {
          score: 0,
          defects: [
            {
              stepKey: null,
              problem: "Asks who the review is about; it is their own company.",
              fix: "Drop the question; review their uploaded deck and financials.",
            },
          ],
        },
      }),
    ).toEqual({ score: 90, fatal: false, passes: false });
  });
});

describe("PLAN_REVIEW v1", () => {
  it("is registered and active, independent, and never rewrites the plan", () => {
    expect(
      createDefaultPromptRegistry().getActive("PLAN_REVIEW").versionId,
    ).toBe("plan-review/v4");
    const t = PLAN_REVIEW_V1.template;
    expect(t).toMatch(/independent reviewer/u);
    expect(t).toMatch(/you must not rewrite it/u);
    expect(t).toMatch(/plan-rubric\/v1/u);
    for (const [item, max] of Object.entries(PLAN_RUBRIC_V1)) {
      expect(t).toContain(`${item} (0-${String(max)})`);
    }
    expect(t).toMatch(/firewall: held is false/u);
  });

  it("renders for both foci", () => {
    for (const focus of [
      "COVERAGE_AND_SPECIFICITY",
      "FEASIBILITY_AND_INVENTED_FACTS",
    ]) {
      const text = render("PLAN_REVIEW", {
        side: "INVESTOR",
        focus,
        ask: "How do I get better deal flow?",
        situation: SITUATION,
        publicFindings: "",
        allowedActions: "my_board: the work board",
        plan: JSON.stringify({ steps: [STEP] }),
      });
      expect(text).toContain(`YOUR FOCUS: ${focus}`);
      expect(text).toContain(`${UNTRUSTED_OPEN} source="plan">>>`);
    }
  });

  it("weights the rubric to 100 and bars at 99", () => {
    expect(
      Object.values(PLAN_RUBRIC_V1).reduce((sum, max) => sum + max, 0),
    ).toBe(100);
    expect(PLAN_REVIEW_BAR).toBe(99);
  });

  it("refuses a score above an item's maximum", () => {
    const review = fullReview();
    expect(PlanReviewResultSchema.safeParse(review).success).toBe(true);
    expect(
      PlanReviewResultSchema.safeParse({
        ...review,
        specificity: { score: 21, defects: [] },
      }).success,
    ).toBe(false);
  });

  it("code recomputes the total, and integrity failures are fatal", () => {
    expect(planReviewScore(fullReview())).toEqual({
      score: 100,
      fatal: false,
      passes: true,
    });
    const generic: PlanReviewResult = {
      ...fullReview(),
      specificity: {
        score: 15,
        defects: [
          {
            stepKey: "S2",
            problem: "'Improve your deck' fits any founder.",
            fix: "Name the Business model slide and Kestrel's request (F1).",
          },
        ],
      },
      // The reviewer's own total is never trusted.
      score: 100,
    };
    expect(planReviewScore(generic)).toEqual({
      score: 95,
      fatal: false,
      passes: false,
    });
    expect(
      planReviewScore({
        ...fullReview(),
        noInventedFacts: { score: 14, defects: [] },
      }),
    ).toMatchObject({ fatal: true, passes: false });
    expect(
      planReviewScore({
        ...fullReview(),
        firewall: { held: false, defects: [] },
      }),
    ).toMatchObject({ score: 100, fatal: true, passes: false });
  });
});

describe("PLAN_READ v1", () => {
  it("is registered and active, and renders the document as data", () => {
    expect(createDefaultPromptRegistry().getActive("PLAN_READ").versionId).toBe(
      "plan-read/v1",
    );
    const text = render("PLAN_READ", {
      side: "FOUNDER",
      today: "2026-10-28",
      documentName: "Q4 plan.docx",
      documentText: "1. Finish the deck by November. 2. Talk to five funds.",
      allowedActions: "propose_reminder: a reminder",
    });
    expect(text).toContain(`${UNTRUSTED_OPEN} source="documentText">>>`);
    expect(PLAN_READ_V1.template).toMatch(/Never guess an owner/u);
    expect(PLAN_READ_V1.template).toMatch(/copied exactly/u);
  });

  it("reads owners best-effort (UNKNOWN allowed), with a quote, and nothing when unreadable", () => {
    const read = PlanReadResultSchema.parse({
      readable: true,
      goal: "Close the seed round",
      side: "FOUNDER",
      situationSummary: null,
      steps: [
        {
          key: "S1",
          title: "Finish the deck",
          why: "The document sets it for November.",
          owner: "UNKNOWN",
          action: { kind: "TASK" },
          due: null,
          quote: "Finish the deck by November.",
        },
      ],
      openQuestions: ["Who finishes the deck is not stated."],
    });
    expect(read.steps[0]?.cites).toEqual([]);
    expect(read.situationRefs).toEqual([]);
    expect(
      PlanReadResultSchema.safeParse({
        ...read,
        steps: [{ ...read.steps[0], quote: undefined }],
      }).success,
    ).toBe(false);
    expect(
      PlanReadResultSchema.parse({
        readable: false,
        goal: null,
        side: null,
        situationSummary: null,
      }).steps,
    ).toEqual([]);
  });
});
