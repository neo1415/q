import { describe, expect, it } from "vitest";

import { situationFacts } from "@capital-q/contracts";
import {
  PLAN_REVIEW_V2,
  PLAN_WRITE_V2,
  PlanWriteResultV2Schema,
  TURN_READER_V71,
  createDefaultPromptRegistry,
} from "@capital-q/q-core";
import { acceptStructuredOutput } from "@capital-q/model-gateway";

import {
  codeChecks,
  personPoint,
  planReadyLine,
  runPlanJob,
  sentenceClip,
  withoutRefs,
  type PlanJobPayload,
} from "../src/composition/workforce/plan-job.js";
import { toldStatement } from "../src/composition/workforce/plan-figures.js";
import {
  boardMessage,
  citedFacts,
  planBoardKey,
} from "../src/composition/workforce/plans.js";
import { statusLine } from "../src/composition/workforce/plan-thread.js";
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
 * Plan live run 1 (production d79f70f3e, 2026-10-29): the defects found,
 * each as a test of its root cause.
 */

const ASK = "how do I improve my chances of getting investment";
const payload: PlanJobPayload = {
  kind: "PLAN",
  ownerUserId: founder.userId,
  ask: ASK,
  summary: `Your plan: ${ASK}`,
  subject: { side: "FOUNDER", companyId: COMPANY },
  research: "NONE",
  deliverable: "PLAN",
  mode: "NEW",
  planId: null,
  fromVersion: null,
  directionId: null,
};

function run(input: {
  readonly writes: Parameters<typeof fakePlanModels>[0]["writes"];
  readonly reviews: Parameters<typeof fakePlanModels>[0]["reviews"];
}) {
  const plans = memoryPlanStore();
  const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
  const { models, calls } = fakePlanModels(input);
  const figures = [
    {
      statement: toldStatement(
        "The founder said cash in the bank is USD 310,000.",
      ),
      truthClass: "USER_CLAIM" as const,
      evidenceStatus: "SELF_REPORTED" as const,
      asOf: "2026-10-28",
      provenance: { tool: "read_my_record", record: null, url: null },
      label: "founder_private" as const,
      category: null,
    },
  ];
  const outcome = runPlanJob(
    {
      assembler,
      toolContext: (actor) => Promise.resolve(contextOf(actor)),
      models,
      store: plans.store,
      figures: () => Promise.resolve(figures),
      now: () => new Date("2026-10-28T10:00:00.000Z"),
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
  return { outcome, plans, calls };
}

describe("defect 1: the board's key is a UUID", () => {
  it("is a stable UUID per step and version", () => {
    const key = "plan:d44f3d6c-6fb4-4761-be99-ee2154bfc67e:2:s1";
    expect(planBoardKey(key)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(planBoardKey(key)).toBe(planBoardKey(key));
    expect(planBoardKey(`${key}x`)).not.toBe(planBoardKey(key));
  });

  it("only what landed is said; a failure is never 'already there'", () => {
    expect(boardMessage({ placed: 0, already: 0, failed: 3, waiting: 1 })).toBe(
      "I couldn't put your 3 steps on your board just now, so nothing was added. Try again in a moment. My steps wait until you say go.",
    );
    expect(
      boardMessage({ placed: 2, already: 0, failed: 1, waiting: 0 }),
    ).toContain("On your board: 2 tasks");
    expect(
      boardMessage({ placed: 0, already: 3, failed: 0, waiting: 0 }),
    ).toBe("Your 3 tasks are already on your board.");
  });
});

describe("defect 2: PLAN_WRITE's output is accepted the way the model writes it", () => {
  const step = {
    key: "S1",
    title: "Send Aster the September revenue evidence",
    why: "Aster asked about operating metrics.",
    cites: ["F1"],
    owner: "YOU",
    action: { kind: "TASK" },
    due: null,
    evidenceNeeded: [],
  };
  const plan = (steps: unknown[]) =>
    JSON.stringify({
      goal: "Raise the seed",
      side: "FOUNDER",
      situationSummary: "Where things stand.",
      situationRefs: ["F1"],
      steps,
      openQuestions: [],
      clarification: null,
    });

  it("a list over its bound keeps its first items (live: evidenceNeeded, cites)", () => {
    const accepted = acceptStructuredOutput(
      plan([
        {
          ...step,
          evidenceNeeded: ["a", "b", "c", "d", "e", "f", "g"],
          cites: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"],
        },
      ]),
      PlanWriteResultV2Schema,
      { invalidListItems: "DROP" },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.steps[0]?.evidenceNeeded).toHaveLength(6);
    expect(accepted.value.steps[0]?.cites).toHaveLength(8);
  });

  it("a stray key on a step is left out, never the plan refused (live: steps.2:unrecognized_keys)", () => {
    const accepted = acceptStructuredOutput(
      plan([step, step, { ...step, "": "stray", notes: "x" }]),
      PlanWriteResultV2Schema,
      { invalidListItems: "DROP" },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.steps).toHaveLength(3);
  });

  it("a why of two full sentences fits (live: clipped at 300, 'payback,…')", () => {
    const why = `${"Aster asked about the business model and its unit economics. ".repeat(5)}`.trim();
    const accepted = acceptStructuredOutput(
      plan([{ ...step, why }]),
      PlanWriteResultV2Schema,
      { invalidListItems: "DROP" },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.steps[0]?.why).toBe(why);
  });

  it("a refused write is asked once more with the refused fields, within the six calls", async () => {
    const { outcome, calls } = run({
      writes: [
        { refused: ["steps.6.evidenceNeeded:too_big"] },
        FOUNDER_PLAN,
      ],
      reviews: [review(0)],
    });
    const done = await outcome;
    expect(done.status).toBe("OFFERED");
    const writes = calls.filter((call) => call.task === "WRITE");
    expect(writes).toHaveLength(2);
    expect(writes[1]?.fixes).toContain("steps.6.evidenceNeeded:too_big");
    expect(done.modelCalls).toBeLessThanOrEqual(6);
  });

  it("v2 prompts are the active ones, and are reasoning work, not extraction", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("PLAN_WRITE").definition.version).toBe(2);
    expect(registry.getActive("PLAN_REVIEW").definition.version).toBe(2);
    expect(PLAN_WRITE_V2.taskClass).toBe("EVIDENCE_SYNTHESIS");
    expect(PLAN_REVIEW_V2.taskClass).toBe("EVIDENCE_SYNTHESIS");
    for (const limit of [
      "at most 400 characters",
      "0 to 6 short items",
      "1 to 8 refs",
      "Only these fields",
    ]) {
      expect(PLAN_WRITE_V2.template).toContain(limit);
    }
  });
});

describe("defect 3: what the reviewers still want is said plainly", () => {
  it("a reviewer's point becomes the step's number and the change wanted", () => {
    const steps = [{ key: "s1" }, { key: "s2" }];
    expect(
      personPoint(
        "[s2] The step cites F26 for the report being private. Fix: Add F23 and explain why the report matters to Aster.",
        steps,
      ),
    ).toBe("Step 2: Add and explain why the report matters to Aster.");
  });

  it("the plan's ready line names what is still wanted", () => {
    const line = planReadyLine(
      {
        ...(FOUNDER_PLAN as never),
        planId: "d44f3d6c-6fb4-4761-be99-ee2154bfc67e",
        version: 1,
        steps: [],
        review: {
          rubricVersion: "plan-rubric/v1",
          threshold: 99,
          reviews: [],
          redrafts: 1,
          fullyReviewed: false,
          openPoints: ["Step 4: Name the Nigerian B2B payments market."],
        },
      } as never,
      null,
    );
    expect(line).toContain(
      "What they still want: Step 4: Name the Nigerian B2B payments market.",
    );
  });
});

describe("defect 4: reader v71 reads what they want at the end", () => {
  it("names the live misreadings as cases, by meaning", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(71);
    const text = TURN_READER_V71.template;
    expect(text).toContain(
      '"I need to hire a CFO before our seed close, sort it out"',
    );
    expect(text).toContain('"plan my next two weeks on Ledgerline" from an investor is OWN');
    expect(text).toContain(
      "Review the pitch deck and financial documents I've uploaded and tell me what investors will push back on\" is planAsk {kind NONE, subject OWN, deliverable ANALYSIS}",
    );
    expect(text).not.toContain("V70_PLAN_ASK");
  });
});

describe("defect 7: no fact codes or cut words reach the person", () => {
  it("refs are taken out of the words, the punctuation left tidy", () => {
    expect(
      withoutRefs(
        "Aster has expressed interest (F24), and missing revenue evidence is ranked first (F29, F31).",
      ),
    ).toBe(
      "Aster has expressed interest, and missing revenue evidence is ranked first.",
    );
    expect(withoutRefs("Cites F12 and P3 here.")).toBe("Cites and here.");
  });

  it("text is clipped at a sentence end, never mid-word", () => {
    const clipped = sentenceClip(
      "Investors will ask about retention. They will also ask about payback, margins and churn in detail.",
      60,
    );
    expect(clipped).toBe("Investors will ask about retention.");
    expect(sentenceClip("one two three four five six", 12)).toBe("one two.");
  });

  it("a written plan's words carry no refs; the refs stay as cites", async () => {
    const { outcome, plans } = run({
      writes: [FOUNDER_PLAN],
      reviews: [review(0)],
    });
    const done = await outcome;
    if (done.status !== "OFFERED") throw new Error("not offered");
    const plan = plans.latest(done.planId);
    expect(plan?.situationSummary).not.toMatch(/\bF\d+\b/u);
    for (const one of plan?.steps ?? []) {
      expect(`${one.title} ${one.why}`).not.toMatch(/\bF\d+\b/u);
      expect(one.cites.length).toBeGreaterThan(0);
    }
  });
});

describe("defect 8: their own figures are in the situation, as theirs", () => {
  it("a figure they told Q is quoted as theirs, a USER_CLAIM in CAPITAL", async () => {
    expect(
      toldStatement("The founder said monthly net burn is USD 65,000."),
    ).toBe("You told Q: monthly net burn is USD 65,000.");
    const { outcome, plans } = run({
      writes: [FOUNDER_PLAN],
      reviews: [review(0)],
    });
    const done = await outcome;
    if (done.status !== "OFFERED") throw new Error("not offered");
    const stored = await plans.store.read(
      { tenantId: TENANT, userId: founder.userId },
      done.planId,
    );
    const capital = (
      stored?.situation as {
        sections: { source: string; facts: { statement: string; truthClass: string }[] }[];
      }
    ).sections.find((section) => section.source === "CAPITAL");
    expect(capital?.facts).toContainEqual(
      expect.objectContaining({
        statement: "You told Q: cash in the bank is USD 310,000.",
        truthClass: "USER_CLAIM",
      }),
    );
  });

  it("the card's why opens the cited facts, and only those", () => {
    const facts = situationFacts(FOUNDER_DOSSIER);
    const cited = citedFacts(
      {
        situationRefs: [],
        steps: [{ cites: [facts[0]?.ref ?? "F1"] }],
      } as never,
      FOUNDER_DOSSIER,
    );
    expect(cited.map((one) => one.ref)).toEqual([facts[0]?.ref]);
  });
});

describe("defect 9: 'ready for your approval' only with an approval behind it", () => {
  const step = {
    key: "s1",
    title: "Write to Aster with the September figures",
  } as never;
  it("says Q will prepare it when no card exists", () => {
    expect(statusLine(step, "PROPOSED", false)).toBe(
      "Q will prepare it for your approval: Write to Aster with the September figures",
    );
    expect(statusLine(step, "PROPOSED")).toBe(
      "Ready for your approval: Write to Aster with the September figures",
    );
  });
});

describe("code checks before the reviewers spend points", () => {
  it("a step due before the step it waits for is a fix", () => {
    const fixes = codeChecks(
      {
        situationRefs: [],
        openQuestions: [],
        steps: [
          { key: "s1", due: "2026-11-05", waitsFor: [], cites: [], action: { kind: "TASK" }, needsApproval: false },
          {
            key: "s2",
            due: "2026-11-01",
            waitsFor: [{ kind: "STEP_DONE", stepKey: "s1" }],
            cites: [],
            action: { kind: "TASK" },
            needsApproval: false,
          },
        ] as never,
      },
      { ...FOUNDER_DOSSIER, sections: [] },
      { droppedCites: 0, droppedSteps: 0 },
    );
    expect(fixes[0]).toContain("[s2] It needs s1 done first but is due before it");
  });
});
