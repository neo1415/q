import { z } from "zod";

import { createUuidIdSchema, UuidSchema } from "../common/ids.js";
import { LocalDateSchema, UtcTimestampSchema } from "../common/time.js";
import { QSituationFactRefSchema, QSituationSideSchema } from "./situation.js";
import { WorkforceAgentRoleSchema } from "./workforce.js";

/**
 * Situation-first planning (owner 2026-10-28): the plan Q writes for a
 * person's goal, from their situation dossier, reviewed twice before it is
 * offered. It is the person's own (personal_private), never evidence, and
 * never used in ranking or matching.
 *
 * Every step says why, citing dossier facts by `F<n>` (code drops any
 * citation that does not resolve). Who owns a step and whether it needs
 * approval are decided by CODE from the action's tool class and the app
 * action registry; a model may only suggest them. A version is never
 * rewritten: a change is the next version, and a changed plan needs the
 * person's approval again (approval binds to {planId, version, stepKeys}).
 */

export const QPlanIdSchema = createUuidIdSchema("QPlanId");
export type QPlanId = z.infer<typeof QPlanIdSchema>;

export const Q_PLAN_STEPS_MAX = 12;
export const Q_PLAN_OPEN_QUESTIONS_MAX = 6;
export const Q_PLAN_SUMMARY_MAX = 600;

/** A step's stable key across versions (a kept step keeps its key). */
export const QPlanStepKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/u, "a step key is lower_snake_case");
export type QPlanStepKey = z.infer<typeof QPlanStepKeySchema>;

/** Q does it; YOU (the person) do it; or TOGETHER (Q prepares, you act). */
export const Q_PLAN_STEP_OWNERS = ["Q", "YOU", "TOGETHER"] as const;
export type QPlanStepOwner = (typeof Q_PLAN_STEP_OWNERS)[number];
export const QPlanStepOwnerSchema = z.enum(Q_PLAN_STEP_OWNERS);

export const Q_PLAN_STEP_STATUSES = [
  "TODO",
  /** An approval card is prepared and waits on the person. */
  "PROPOSED",
  /** The person's move. */
  "WAITING_YOU",
  "DOING",
  "DONE",
  "SKIPPED",
] as const;
export type QPlanStepStatus = (typeof Q_PLAN_STEP_STATUSES)[number];

/** A registered app action name (`schedule.reminder.create`). */
const AppActionNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,4}$/u);
/** A Q tool's name (`propose_reminder`). */
const ToolNameSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/u);

/**
 * What a step does when executed. TOOL_PROPOSAL: a typed Q tool prepares an
 * approval card (`propose_*`). APP_ACTION: a registered application action
 * (a board task, a reminder). WORKFORCE: Q's workforce runs it as a job
 * with these roles (the approved-plan runner). TASK: the person does it;
 * Q only tracks it. Nothing here is executable by itself: execution goes
 * through Prepare -> Recommend -> Approval -> Execute.
 */
export const QPlanStepActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TOOL_PROPOSAL"), tool: ToolNameSchema }).strict(),
  z
    .object({ kind: z.literal("APP_ACTION"), name: AppActionNameSchema })
    .strict(),
  z
    .object({
      kind: z.literal("WORKFORCE"),
      roles: z.array(WorkforceAgentRoleSchema).min(1).max(4),
    })
    .strict(),
  z.object({ kind: z.literal("TASK") }).strict(),
]);
export type QPlanStepAction = z.infer<typeof QPlanStepActionSchema>;

/**
 * Addendum 2 (owner 2026-10-28): a step waits on a CONDITION over the
 * person's records, never on a named event. The orchestrator re-evaluates
 * every open plan's conditions on any domain event for the tenant (as the
 * person), confirms in the team thread and fires the dependent steps. Each
 * condition is decided by code from a typed read; none is a model's
 * judgement. Additive.
 */
export const QPlanConditionSchema = z.discriminatedUnion("kind", [
  /** Another step of this plan is DONE. */
  z
    .object({ kind: z.literal("STEP_DONE"), stepKey: QPlanStepKeySchema })
    .strict(),
  /** A board task is DONE. */
  z
    .object({ kind: z.literal("BOARD_TASK_DONE"), boardItemId: UuidSchema })
    .strict(),
  /** A meeting is booked in this relationship. */
  z
    .object({ kind: z.literal("MEETING_BOOKED"), relationshipId: UuidSchema })
    .strict(),
  /** A document is shared in this relationship (any, or this one). */
  z
    .object({
      kind: z.literal("DOCUMENT_SHARED"),
      relationshipId: UuidSchema,
      documentId: UuidSchema.nullable(),
    })
    .strict(),
  /** The other side replied in this relationship since the step began. */
  z
    .object({ kind: z.literal("THEY_REPLIED"), relationshipId: UuidSchema })
    .strict(),
  /** An approval was decided (approved or declined). */
  z
    .object({ kind: z.literal("APPROVAL_DECIDED"), proposalId: UuidSchema })
    .strict(),
  /** A calendar day has come. */
  z.object({ kind: z.literal("DATE_REACHED"), on: LocalDateSchema }).strict(),
]);
export type QPlanCondition = z.infer<typeof QPlanConditionSchema>;
export const Q_PLAN_CONDITIONS_MAX = 4;

export const QPlanStepSchema = z
  .object({
    key: QPlanStepKeySchema,
    title: z.string().trim().min(1).max(160),
    /**
     * Why this step, for this person, in plain words. Room for two full
     * sentences (live 2026-10-29: at 300 nearly every why was cut
     * mid-sentence, "payback,…"). Additive: older versions still parse.
     */
    why: z.string().trim().min(1).max(600),
    /** The situation facts the why rests on. At least one. */
    cites: z.array(QSituationFactRefSchema).min(1).max(8),
    owner: QPlanStepOwnerSchema,
    action: QPlanStepActionSchema,
    /** Decided by code from the action's class, never by a model. */
    needsApproval: z.boolean(),
    due: LocalDateSchema.nullable(),
    /** What would show the step worked (or what it needs first). */
    evidenceNeeded: z.array(z.string().trim().min(1).max(200)).max(6),
    status: z.enum(Q_PLAN_STEP_STATUSES),
    /** All of these must hold before the step starts. Empty: it can start. */
    waitsFor: z
      .array(QPlanConditionSchema)
      .max(Q_PLAN_CONDITIONS_MAX)
      .default([]),
    /** What the step became once accepted or executed. Additive. */
    boardItemId: UuidSchema.nullable(),
    proposalId: UuidSchema.nullable(),
    reminderId: z.string().trim().min(1).max(64).nullable(),
    jobId: UuidSchema.nullable(),
  })
  .strict()
  .refine((step) => new Set(step.cites).size === step.cites.length, {
    message: "a step cites a fact once",
    path: ["cites"],
  })
  .refine((step) => step.action.kind !== "TASK" || step.owner !== "Q", {
    message: "a task is the person's: Q-owned steps name what Q runs",
    path: ["owner"],
  });
export type QPlanStep = z.infer<typeof QPlanStepSchema>;

// --- review -----------------------------------------------------------------

export const Q_PLAN_RUBRIC_VERSION = "plan-rubric/v1" as const;
/** The bar a plan must reach in every review to be offered as reviewed. */
export const Q_PLAN_REVIEW_THRESHOLD = 99;
export const Q_PLAN_MAX_REDRAFTS = 2;
/**
 * At most this many open points on a draft. 20 since 2026-10-30 (plan job
 * ea7508c9): with each reviewer's distinct fix kept under its step, a
 * second-round draft held 15; at 12 the last were folded into a count.
 */
export const Q_PLAN_OPEN_POINTS_MAX = 20;

/**
 * plan-rubric/v1, weighted to 100. NO_INVENTED_FACTS is integrity: any
 * failure there fails the review whatever the score.
 */
export const Q_PLAN_RUBRIC_ITEMS = [
  "SITUATION_COVERAGE",
  "SPECIFICITY",
  "STEPS_CITE_FACTS",
  "OWNER_CLASSIFICATION",
  "FEASIBILITY_ORDER",
  "NO_INVENTED_FACTS",
] as const;
export type QPlanRubricItem = (typeof Q_PLAN_RUBRIC_ITEMS)[number];
export const Q_PLAN_RUBRIC_WEIGHTS: Readonly<Record<QPlanRubricItem, number>> =
  {
    SITUATION_COVERAGE: 20,
    SPECIFICITY: 25,
    STEPS_CITE_FACTS: 15,
    OWNER_CLASSIFICATION: 10,
    FEASIBILITY_ORDER: 15,
    NO_INVENTED_FACTS: 15,
  };
export const Q_PLAN_INTEGRITY_ITEMS: readonly QPlanRubricItem[] = [
  "NO_INVENTED_FACTS",
];

/** Two independent reviewers: coverage/specificity, feasibility/invention. */
export const Q_PLAN_REVIEWERS = ["R1", "R2"] as const;
export type QPlanReviewer = (typeof Q_PLAN_REVIEWERS)[number];

export const QPlanRubricScoreSchema = z
  .object({
    item: z.enum(Q_PLAN_RUBRIC_ITEMS),
    score: z.number().int().min(0).max(25),
    max: z.number().int().min(1).max(25),
    note: z.string().trim().max(300),
  })
  .strict()
  .refine((row) => row.score <= row.max, {
    message: "a score is out of its weight",
  })
  .refine((row) => row.max === Q_PLAN_RUBRIC_WEIGHTS[row.item], {
    message: "the weight is the rubric's",
    path: ["max"],
  });
export type QPlanRubricScore = z.infer<typeof QPlanRubricScoreSchema>;

export const QPlanReviewSchema = z
  .object({
    reviewer: z.enum(Q_PLAN_REVIEWERS),
    /** 1 = the first draft; each redraft is the next round. */
    round: z
      .number()
      .int()
      .min(1)
      .max(Q_PLAN_MAX_REDRAFTS + 1),
    score: z.number().int().min(0).max(100),
    passed: z.boolean(),
    items: z.array(QPlanRubricScoreSchema).length(Q_PLAN_RUBRIC_ITEMS.length),
    /** Numbered fixes handed back to the planner. */
    fixes: z.array(z.string().trim().min(1).max(300)).max(12),
    integrityFailed: z.boolean(),
    promptVersion: z.string().trim().min(1).max(64),
  })
  .strict()
  .superRefine((review, ctx) => {
    const items = new Set(review.items.map((row) => row.item));
    if (items.size !== Q_PLAN_RUBRIC_ITEMS.length) {
      ctx.addIssue({
        code: "custom",
        message: "every rubric item once",
        path: ["items"],
      });
    }
    const sum = review.items.reduce((total, row) => total + row.score, 0);
    if (sum !== review.score) {
      ctx.addIssue({
        code: "custom",
        message: "the score is the items' sum",
        path: ["score"],
      });
    }
    const passes =
      review.score >= Q_PLAN_REVIEW_THRESHOLD && !review.integrityFailed;
    if (review.passed !== passes) {
      ctx.addIssue({
        code: "custom",
        message: "passing is decided by the bar and integrity, not stated",
        path: ["passed"],
      });
    }
  });
export type QPlanReview = z.infer<typeof QPlanReviewSchema>;

export const QPlanReviewSummarySchema = z
  .object({
    rubricVersion: z.literal(Q_PLAN_RUBRIC_VERSION),
    threshold: z.number().int().min(0).max(100),
    /** The latest round's review by each reviewer. */
    reviews: z.array(QPlanReviewSchema).max(Q_PLAN_REVIEWERS.length),
    redrafts: z.number().int().min(0).max(Q_PLAN_MAX_REDRAFTS),
    /** Both reviewers passed the same version. Otherwise offered as a draft. */
    fullyReviewed: z.boolean(),
    /** What is still open when it is not fully reviewed, in plain words. */
    openPoints: z
      .array(z.string().trim().min(1).max(300))
      .max(Q_PLAN_OPEN_POINTS_MAX),
  })
  .strict()
  .refine(
    (summary) =>
      summary.fullyReviewed ===
      (summary.reviews.length === Q_PLAN_REVIEWERS.length &&
        summary.reviews.every((review) => review.passed)),
    {
      message: "fully reviewed means both reviewers passed",
      path: ["fullyReviewed"],
    },
  )
  .refine((summary) => summary.fullyReviewed || summary.openPoints.length > 0, {
    message: "a plan not fully reviewed says what is open",
    path: ["openPoints"],
  });
export type QPlanReviewSummary = z.infer<typeof QPlanReviewSummarySchema>;

/**
 * The notices a plan's open points open with (plan-job.ts): which draft is
 * shown and why. They say what the card holds, not a point to fix.
 */
export const Q_PLAN_EARLIER_DRAFT_KEPT =
  "This is the earlier draft: its revision scored lower in review, so this draft is shown, with the reviews of this draft.";
export const Q_PLAN_FIRST_DRAFT_ONLY =
  "This is the first draft: its revision could not finish in time, so the reviews below are of this draft.";

/** Code's own cap line for points past the stored maximum. */
export function qPlanMorePointsLine(more: number): string {
  return `And ${String(more)} more point${more === 1 ? "" : "s"} the reviews raised.`;
}
const MORE_POINTS_LINE = /^And (\d+) more points? the reviews raised\.$/u;
const STEP_CONTINUED_LINE = /^Step (\d+), continued: (.*)$/su;
const STEP_HEAD_LINE = /^Step (\d+), /u;

/**
 * The open points as one list, for the card and for Q's line alike (live
 * 2026-10-31: chat "and 6 more on the card", card "Show all 9 points" --
 * the card counted the draft notice as a point, the chat did not). A
 * step's "continued" point folds into its step's line; the draft notice
 * is apart; code's cap line is a count, not a point. `count` is every
 * point the reviews raised: the listed ones and those the cap stands for.
 * Code's own stored lines only: nothing a person wrote is read here.
 */
export function qPlanReviewPoints(openPoints: readonly string[]): {
  readonly notice: string | null;
  readonly points: readonly string[];
  readonly more: number;
  readonly count: number;
} {
  let notice: string | null = null;
  let more = 0;
  const points: string[] = [];
  for (const point of openPoints) {
    if (
      point === Q_PLAN_EARLIER_DRAFT_KEPT ||
      point === Q_PLAN_FIRST_DRAFT_ONLY
    ) {
      notice ??= point;
      continue;
    }
    const capped = MORE_POINTS_LINE.exec(point);
    if (capped !== null) {
      more += Number(capped[1] ?? 0);
      continue;
    }
    const continued = STEP_CONTINUED_LINE.exec(point);
    const previous = points.at(-1);
    if (
      continued !== null &&
      previous !== undefined &&
      STEP_HEAD_LINE.exec(previous)?.[1] === continued[1]
    ) {
      points[points.length - 1] = `${previous} ${continued[2] ?? ""}`.trim();
      continue;
    }
    points.push(point);
  }
  return { notice, points, more, count: points.length + more };
}

// --- dynamic specialists (addendum 1) ------------------------------------------

/**
 * Addendum 1 (owner 2026-10-28): when a Q-owned step is work no built-in
 * role covers, the coordinator defines a specialist for it -- a plain,
 * addressable name the Team page shows, what it is for, the typed tools it
 * may use, worked examples and a budget. Its tools are a SUBSET of the
 * run's context-eligible tools (code intersects them; never wider), it is
 * created only under the person's approval of the plan version that names
 * it, kept with that version, and run by the same job runner as any
 * built-in role. Never arbitrary code, SQL or network access.
 */
export const Q_SPECIALIST_TOOLS_MAX = 8;
export const QSpecialistDefinitionSchema = z
  .object({
    /** The step it does (one specialist per step). */
    stepKey: QPlanStepKeySchema,
    /** Plain and addressable ("Grant scout"); never an internal role name. */
    name: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} '&-]*$/u, "a plain name"),
    purpose: z.string().trim().min(1).max(300),
    /** Typed Q tool names; a subset of the run's eligible tools. */
    tools: z.array(ToolNameSchema).min(1).max(Q_SPECIALIST_TOOLS_MAX),
    examples: z.array(z.string().trim().min(1).max(300)).max(3),
    /** At most this much model spend, in US dollars. */
    budgetUsd: z.number().min(0).max(0.5),
    maxModelCalls: z.number().int().min(1).max(6),
  })
  .strict()
  .refine(
    (definition) => new Set(definition.tools).size === definition.tools.length,
    {
      message: "each tool once",
      path: ["tools"],
    },
  );
export type QSpecialistDefinition = z.infer<typeof QSpecialistDefinitionSchema>;

// --- the plan -----------------------------------------------------------------

export const Q_PLAN_STATUSES = [
  "DRAFT",
  "OFFERED",
  "ACCEPTED",
  "ON_BOARD",
  "EXECUTING",
  "DONE",
  "SUPERSEDED",
] as const;
export type QPlanStatus = (typeof Q_PLAN_STATUSES)[number];
export const QPlanStatusSchema = z.enum(Q_PLAN_STATUSES);

export const QPlanSchema = z
  .object({
    planId: QPlanIdSchema,
    version: z.number().int().min(1).max(1000),
    side: QSituationSideSchema,
    /** The person's goal, in their words as the reader read it. */
    goal: z.string().trim().min(1).max(500),
    situationSummary: z.string().trim().min(1).max(Q_PLAN_SUMMARY_MAX),
    /** The dossier facts the plan rests on (every step's cites among them). */
    situationRefs: z.array(QSituationFactRefSchema).max(120),
    steps: z.array(QPlanStepSchema).min(1).max(Q_PLAN_STEPS_MAX),
    /** What Q needs the person to answer before (or while) it proceeds. */
    openQuestions: z
      .array(z.string().trim().min(1).max(300))
      .max(Q_PLAN_OPEN_QUESTIONS_MAX),
    /** Null until reviewed. */
    review: QPlanReviewSummarySchema.nullable(),
    status: QPlanStatusSchema,
    /** The version this one replaces; null for the first. */
    supersedes: z.number().int().min(1).max(999).nullable(),
    createdAt: UtcTimestampSchema,
    /**
     * Addendum 1: specialists this version defines for its Q-owned
     * WORKFORCE steps no built-in role covers. Approved with the version.
     * Additive.
     */
    specialists: z.array(QSpecialistDefinitionSchema).max(4).optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const stepKeys = new Set(plan.steps.map((step) => step.key));
    (plan.specialists ?? []).forEach((specialist, index) => {
      const step = plan.steps.find((one) => one.key === specialist.stepKey);
      if (
        !stepKeys.has(specialist.stepKey) ||
        step?.owner === "YOU" ||
        step?.action.kind !== "WORKFORCE"
      ) {
        ctx.addIssue({
          code: "custom",
          message: "a specialist does a Q-owned WORKFORCE step of the plan",
          path: ["specialists", index, "stepKey"],
        });
      }
    });
    const keys = new Set<string>();
    const refs = new Set(plan.situationRefs);
    plan.steps.forEach((step, index) => {
      if (keys.has(step.key)) {
        ctx.addIssue({
          code: "custom",
          message: "step keys are unique",
          path: ["steps", index, "key"],
        });
      }
      step.waitsFor.forEach((condition, conditionIndex) => {
        // A step waits only on a step listed before it: no cycles.
        if (condition.kind === "STEP_DONE" && !keys.has(condition.stepKey)) {
          ctx.addIssue({
            code: "custom",
            message: "a step waits only on an earlier step of the plan",
            path: ["steps", index, "waitsFor", conditionIndex],
          });
        }
      });
      keys.add(step.key);
      step.cites.forEach((cite, citeIndex) => {
        if (!refs.has(cite)) {
          ctx.addIssue({
            code: "custom",
            message: "a step cites only the plan's situation facts",
            path: ["steps", index, "cites", citeIndex],
          });
        }
      });
    });
    if ((plan.version === 1) !== (plan.supersedes === null)) {
      ctx.addIssue({
        code: "custom",
        message: "only the first version supersedes nothing",
        path: ["supersedes"],
      });
    }
    if (plan.supersedes !== null && plan.supersedes >= plan.version) {
      ctx.addIssue({
        code: "custom",
        message: "a version supersedes an earlier one",
        path: ["supersedes"],
      });
    }
    if (plan.status !== "DRAFT" && plan.review === null) {
      ctx.addIssue({
        code: "custom",
        message: "a plan is reviewed before it is offered",
        path: ["review"],
      });
    }
  });
export type QPlan = z.infer<typeof QPlanSchema>;

// --- the card ------------------------------------------------------------------

/**
 * The plan card's three affordances: run the Q-owned steps (with tasks and
 * reminders for yours, under one approval bound to the exact version), put
 * every step on the board without running anything, or say what to change
 * (a new version). Closed.
 */
export const Q_PLAN_AFFORDANCES = [
  "EXECUTE",
  "PUT_ON_BOARD",
  "CHANGE",
] as const;
export type QPlanAffordance = (typeof Q_PLAN_AFFORDANCES)[number];
export const QPlanAffordanceSchema = z.enum(Q_PLAN_AFFORDANCES);

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
/** The person's words to a plan (a change), bounded as a thread entry is. */
const Q_TEAM_THREAD_TEXT_MAX_FOR_NOTE = 1_000;

/**
 * Execute (S5): ONE approval bound to the exact plan version -- its id,
 * version, the sha-256 of its stored body and the step keys it runs. A
 * changed plan is a new version with a new body, so an approval of the old
 * one can never run the new one: Execute is asked again.
 */
export const Q_PLAN_EXECUTE = "q.plan.execute" as const;
export const QPlanExecutePayloadSchema = z
  .object({
    ownerUserId: UuidSchema,
    planId: QPlanIdSchema,
    version: z.number().int().min(1).max(1000),
    bodySha256: Sha256Schema,
    stepKeys: z.array(QPlanStepKeySchema).min(1).max(Q_PLAN_STEPS_MAX),
    /** For the card: the goal, as the plan states it. */
    goal: z.string().trim().min(1).max(500),
    /**
     * What the card shows and the approval binds to: each step, who does
     * it, when, and whether it will ask again before anything goes out.
     */
    steps: z
      .array(
        z
          .object({
            key: QPlanStepKeySchema,
            title: z.string().trim().min(1).max(160),
            owner: QPlanStepOwnerSchema,
            due: LocalDateSchema.nullable(),
            needsApproval: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(Q_PLAN_STEPS_MAX),
    /**
     * Addendum 1: the specialists this approval creates, by name, with the
     * only tools each may use. Part of the binding. Additive.
     */
    specialists: z
      .array(
        z
          .object({
            stepKey: QPlanStepKeySchema,
            name: z.string().trim().min(2).max(60),
            tools: z.array(ToolNameSchema).min(1).max(Q_SPECIALIST_TOOLS_MAX),
          })
          .strict(),
      )
      .max(4)
      .optional(),
  })
  .strict()
  .refine(
    (payload) =>
      payload.steps.length === payload.stepKeys.length &&
      payload.steps.every(
        (step, index) => step.key === payload.stepKeys[index],
      ),
    { message: "the steps shown are the steps run", path: ["steps"] },
  );
export type QPlanExecutePayload = z.infer<typeof QPlanExecutePayloadSchema>;

/** `POST /v1/q/plans/:planId/decide`: one of the card's three affordances. */
export const QPlanDecisionRequestSchema = z.discriminatedUnion("affordance", [
  z
    .object({
      affordance: z.literal("EXECUTE"),
      version: z.number().int().min(1).max(1000),
      /** The body the card showed: the approval binds to it. */
      bodySha256: Sha256Schema,
    })
    .strict(),
  z
    .object({
      affordance: z.literal("PUT_ON_BOARD"),
      version: z.number().int().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      affordance: z.literal("CHANGE"),
      version: z.number().int().min(1).max(1000),
      /** What to change, in the person's words. */
      note: z.string().trim().min(1).max(Q_TEAM_THREAD_TEXT_MAX_FOR_NOTE),
    })
    .strict(),
]);
export type QPlanDecisionRequest = z.infer<typeof QPlanDecisionRequestSchema>;

export const Q_PLAN_DECISION_OUTCOMES = [
  /** Execute: the one approval card for this exact version is waiting. */
  "AWAITING_APPROVAL",
  /** Executed: Q's steps started or prepared, yours on the board. */
  "EXECUTING",
  "ON_BOARD",
  /** The change is being made: a new version follows. */
  "CHANGING",
  /** The card showed an older version (or body): nothing was done. */
  "STALE",
  "NOT_FOUND",
  "FAILED",
] as const;
export const QPlanDecisionResultSchema = z
  .object({
    outcome: z.enum(Q_PLAN_DECISION_OUTCOMES),
    /** One plain line for the person, code-worded. */
    message: z.string().trim().min(1).max(600),
    /** The plan's current version after the decision. */
    version: z.number().int().min(1).max(1000).nullable(),
    /** CHANGING: the job writing the next version. */
    jobId: UuidSchema.nullable(),
    /** AWAITING_APPROVAL: the approval card's action. Additive. */
    actionId: UuidSchema.nullable().optional(),
  })
  .strict();
export type QPlanDecisionResult = z.infer<typeof QPlanDecisionResultSchema>;

/**
 * `GET /v1/q/plans/:planId[?version=n]`: the plan as its owner reads it,
 * with the body hash an Execute binds to and the team thread's status
 * lines (code-worded, never an author's role or reasoning).
 */
export const QPlanViewSchema = z
  .object({
    plan: QPlanSchema,
    bodySha256: Sha256Schema,
    /** The newest version: only it can be executed. */
    current: z.boolean(),
    headVersion: z.number().int().min(1).max(1000),
    status: QPlanStatusSchema,
    lines: z
      .array(
        z
          .object({
            at: UtcTimestampSchema,
            text: z.string().trim().min(1).max(Q_TEAM_THREAD_TEXT_MAX_FOR_NOTE),
          })
          .strict(),
      )
      .max(20),
    /**
     * The facts the plan cites, as the person's own situation stated them
     * when the plan was written: what a step's "why" link opens. Refs stay
     * data and never appear in the plan's words (live 2026-10-29: "(F23)"
     * on every step). Additive.
     */
    facts: z
      .array(
        z
          .object({
            ref: QSituationFactRefSchema,
            statement: z.string().trim().min(1).max(1_000),
            truthClass: z.string().trim().min(1).max(32),
          })
          .strict(),
      )
      .max(120)
      .optional(),
  })
  .strict();
export type QPlanView = z.infer<typeof QPlanViewSchema>;

export const Q_PLAN_PATH = "/v1/q/plans/:planId" as const;
export const Q_PLAN_DECIDE_PATH = "/v1/q/plans/:planId/decide" as const;

// --- the team thread -------------------------------------------------------------

/**
 * The team thread (a blackboard the orchestrator routes, never
 * peer-to-peer): notes on steps, findings, questions to the person, the
 * person's direction, and code-worded status lines. Specialists never
 * address each other; every entry is typed, bounded and re-authorised by
 * the orchestrator. Only STATUS lines are shown to the person, and never
 * an author's role.
 */
export const Q_TEAM_THREAD_KINDS = [
  "NOTE",
  "FINDING",
  /** A question for the person. */
  "QUESTION",
  /** The person's direction to running work. */
  "DIRECTION",
  "STATUS",
] as const;
export type QTeamThreadKind = (typeof Q_TEAM_THREAD_KINDS)[number];

export const Q_TEAM_THREAD_AUTHORS = [
  "PLANNER",
  "RESEARCH",
  "WRITER",
  "REVIEWER",
  "LIAISON",
  "WORKER",
  "PERSON",
] as const;
export type QTeamThreadAuthor = (typeof Q_TEAM_THREAD_AUTHORS)[number];

export const Q_TEAM_THREAD_TEXT_MAX = 1_000;
/** What an executor reads before its next action. */
export const Q_TEAM_THREAD_READ_MAX_ENTRIES = 20;
export const Q_TEAM_THREAD_READ_MAX_CHARS = 4_000;

const threadRefinements = <
  T extends {
    readonly kind: QTeamThreadKind;
    readonly author: QTeamThreadAuthor;
    readonly planId: string | null;
    readonly jobId: string | null;
  },
>(
  schema: z.ZodType<T>,
) =>
  schema
    .refine((entry) => entry.planId !== null || entry.jobId !== null, {
      message: "an entry belongs to a plan or a job",
      path: ["planId"],
    })
    .refine(
      (entry) => (entry.kind === "DIRECTION") === (entry.author === "PERSON"),
      {
        message: "the person gives direction, and only the person",
        path: ["kind"],
      },
    );

const ThreadEntryFields = {
  planId: QPlanIdSchema.nullable(),
  jobId: UuidSchema.nullable(),
  kind: z.enum(Q_TEAM_THREAD_KINDS),
  author: z.enum(Q_TEAM_THREAD_AUTHORS),
  stepKey: QPlanStepKeySchema.nullable(),
  factRef: QSituationFactRefSchema.nullable(),
  text: z.string().trim().min(1).max(Q_TEAM_THREAD_TEXT_MAX),
} as const;

export const QTeamThreadEntrySchema = threadRefinements(
  z
    .object({
      id: UuidSchema,
      ...ThreadEntryFields,
      /** Position in its thread, from 1. */
      seq: z.number().int().min(1),
      createdAt: UtcTimestampSchema,
    })
    .strict(),
);
export type QTeamThreadEntry = z.infer<typeof QTeamThreadEntrySchema>;

/** What the orchestrator appends. A retried append writes nothing. */
export const QTeamThreadAppendSchema = threadRefinements(
  z
    .object({
      ...ThreadEntryFields,
      idempotencyKey: z.string().trim().min(8).max(200),
    })
    .strict(),
);
export type QTeamThreadAppend = z.infer<typeof QTeamThreadAppendSchema>;
