import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * Situation-first planning (design 2026-10-28, lane B slice S3): the
 * person-level plan Q writes from a code-assembled Situation dossier
 * (PLAN_WRITE), the independent review of it (PLAN_REVIEW), and a plan
 * the person uploaded, read into the same shape (PLAN_READ).
 *
 * These are the prompts' OUTPUT shapes only. Their field names are the
 * design's `QPlanSchema` / `QPlanStepSchema` names exactly (contracts lane
 * A), so composition maps them 1:1; the stored plan adds what code owns
 * (planId, version, review, status, the step's status and the ids of what
 * it became). The model only suggests `owner`: code re-derives it from the
 * action's tool class and overrides it, and grounds every cite against the
 * dossier, dropping refs it cannot resolve.
 */

export const PLAN_WRITE_SCHEMA_NAME = "PlanWriteResult";
export const PLAN_WRITE_SCHEMA_VERSION = 1;
export const PLAN_REVIEW_SCHEMA_NAME = "PlanReviewResult";
export const PLAN_REVIEW_SCHEMA_VERSION = 1;
export const PLAN_READ_SCHEMA_NAME = "PlanReadResult";
export const PLAN_READ_SCHEMA_VERSION = 1;

export const PLAN_SIDES = ["FOUNDER", "INVESTOR"] as const;
export const PlanSideSchema = z.enum(PLAN_SIDES);
export type PlanSide = z.infer<typeof PlanSideSchema>;

export const PLAN_STEP_OWNERS = ["Q", "YOU", "TOGETHER"] as const;
export const PlanStepOwnerSchema = z.enum(PLAN_STEP_OWNERS);
export type PlanStepOwner = z.infer<typeof PlanStepOwnerSchema>;

/** PLAN_READ only: an uploaded plan may not say who does a step. */
export const PLAN_READ_STEP_OWNERS = [...PLAN_STEP_OWNERS, "UNKNOWN"] as const;

/**
 * The workforce roles a Q-owned WORKFORCE step may ask for: the
 * contracts' `WORKFORCE_AGENT_ROLES` less the internal LEAD, WRITER and
 * REVIEWER, which a plan never addresses (the orchestrator assigns them).
 */
export const PLAN_WORKFORCE_ROLES = [
  "OUTREACH",
  "MANDATE_WATCHER",
  "CONVERSATION",
  "SCHEDULER",
  "DOCUMENTS",
  "RESEARCH",
  "AD_HOC",
] as const;

/**
 * A dossier fact ref (`F<n>`, from the Situation dossier) or a public
 * finding ref (`P<n>`). Code resolves every one; an unresolved ref is
 * dropped, never trusted.
 */
export const PlanFactRefSchema = z.string().regex(/^[FP][1-9][0-9]{0,3}$/u);

/** A calendar date, YYYY-MM-DD (the contracts' LocalDate). */
export const PlanLocalDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u);

/**
 * What a step does. TOOL_PROPOSAL / APP_ACTION name one listed action
 * exactly (code refuses a name it does not hold); TASK is something the
 * person does; WORKFORCE hands Q's team a piece of work.
 */
export const PlanStepActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("TOOL_PROPOSAL"),
      tool: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      kind: z.literal("APP_ACTION"),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z.object({ kind: z.literal("TASK") }).strict(),
  z
    .object({
      kind: z.literal("WORKFORCE"),
      roles: z.array(z.enum(PLAN_WORKFORCE_ROLES)).min(1).max(4),
    })
    .strict(),
]);
export type PlanStepAction = z.infer<typeof PlanStepActionSchema>;

const stepKey = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/u);
const evidenceNeeded = z
  .array(z.string().trim().min(1).max(200))
  .max(5)
  .default([]);

export const PlanWriteStepSchema = z
  .object({
    /** Stable within the plan ("S1"); a REFINE keeps the person's keys. */
    key: stepKey,
    /** The concrete move: names the investor, the gap, the words to change. */
    title: z.string().trim().min(1).max(160),
    /** Why this step, for this person now, from the cited facts. */
    why: z.string().trim().min(1).max(300),
    /** The facts it rests on; at least one. */
    cites: z.array(PlanFactRefSchema).min(1).max(8),
    /** Suggested only; code re-derives it from the action and overrides. */
    owner: PlanStepOwnerSchema,
    action: PlanStepActionSchema,
    /** When, counted from today; null when the plan sets no date. */
    due: PlanLocalDateSchema.nullable(),
    /** What would show the step is done or worked. */
    evidenceNeeded,
  })
  .strict();
export type PlanWriteStep = z.infer<typeof PlanWriteStepSchema>;

export const PlanClarificationSchema = z
  .object({
    /** One plain question in the person's words, never a quiz. */
    question: z.string().trim().min(1).max(200),
    /** The reading the plan already follows if they do not answer. */
    default: z.string().trim().min(1).max(200),
  })
  .strict();
export type PlanClarification = z.infer<typeof PlanClarificationSchema>;

export const PlanWriteResultSchema = z
  .object({
    /** The goal in the person's terms. */
    goal: z.string().trim().min(1).max(300),
    side: PlanSideSchema,
    /** Where they stand now, from the dossier only. */
    situationSummary: z.string().trim().min(1).max(600),
    /** The facts the summary rests on. */
    situationRefs: z.array(PlanFactRefSchema).min(1).max(24),
    steps: z.array(PlanWriteStepSchema).min(1).max(12),
    /** What is not known and would change the plan, stated as unknown. */
    openQuestions: z
      .array(z.string().trim().min(1).max(300))
      .max(8)
      .default([]),
    /**
     * Addendum 3 rule 6: only when two readings of the ask differ in
     * effect -- ONE plain question, with the default this plan already
     * follows, so code asks it while starting the default. Null otherwise.
     */
    clarification: PlanClarificationSchema.nullable().default(null),
  })
  .strict();
export type PlanWriteResult = z.infer<typeof PlanWriteResultSchema>;

/** NEW: first draft; REDRAFT: fix the reviewers' numbered defects; REFINE: improve an uploaded plan. */
export const PLAN_WRITE_MODES = ["NEW", "REDRAFT", "REFINE"] as const;

export const PlanWriteVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    side: PlanSideSchema,
    mode: z.enum(PLAN_WRITE_MODES),
    /** YYYY-MM-DD, so due dates are counted from it. */
    today: PlanLocalDateSchema,
    /** What they asked, in their words. UNTRUSTED. */
    ask: z.string().trim().min(1).max(2_000),
    /** The Situation dossier as text: sections of facts with refs and truth class. UNTRUSTED. */
    situation: z.string().min(1).max(24_000),
    /** Public findings with their sources, refs P<n>; may be empty. UNTRUSTED. */
    publicFindings: z.string().max(8_000),
    /** The actions Q may name, one per line "name: what it does" (code-built roster). */
    allowedActions: z.string().min(1).max(8_000),
    /** REDRAFT / REFINE: the plan to work from, as JSON; empty for NEW. UNTRUSTED. */
    priorPlan: z.string().max(16_000),
    /** REDRAFT: the reviewers' numbered defects to fix; empty otherwise. UNTRUSTED. */
    fixes: z.string().max(6_000),
  })
  .strict();
export type PlanWriteVariables = z.infer<typeof PlanWriteVariablesSchema>;
export const PLAN_WRITE_UNTRUSTED = [
  "ask",
  "situation",
  "publicFindings",
  "priorPlan",
  "fixes",
] as const;

/**
 * plan-rubric/v1 (design B3 with addendum 3), weighted to 100 in the
 * `review-loop.ts` pattern. Addendum 3 adds asksNothingKnown (the plan
 * never asks the person for what Q already holds) and roleCorrectWording
 * (plain words for this person's side, no internal names); the design's
 * other weights were scaled down to make room. noInventedFacts is
 * integrity: anything below its maximum is fatal, as is a firewall
 * breach, whatever the total.
 */
export const PLAN_RUBRIC_VERSION = "plan-rubric/v1";
export const PLAN_RUBRIC_V1 = {
  situationCoverage: 15,
  specificity: 20,
  citesFacts: 15,
  ownerClassification: 10,
  feasibility: 10,
  noInventedFacts: 15,
  asksNothingKnown: 10,
  roleCorrectWording: 5,
} as const;
export type PlanRubricItem = keyof typeof PLAN_RUBRIC_V1;
/** The bar a plan clears before it is offered as reviewed (design B3). */
export const PLAN_REVIEW_BAR = 99;

export const PlanReviewDefectSchema = z
  .object({
    /** The step it concerns; null for the plan as a whole. */
    stepKey: stepKey.nullable(),
    problem: z.string().trim().min(1).max(300),
    /** The concrete change that fixes it. */
    fix: z.string().trim().min(1).max(300),
  })
  .strict();
export type PlanReviewDefect = z.infer<typeof PlanReviewDefectSchema>;

const rubricItem = (max: number) =>
  z
    .object({
      score: z.number().int().min(0).max(max),
      defects: z.array(PlanReviewDefectSchema).max(8).default([]),
    })
    .strict();

export const PlanReviewResultSchema = z
  .object({
    situationCoverage: rubricItem(PLAN_RUBRIC_V1.situationCoverage),
    specificity: rubricItem(PLAN_RUBRIC_V1.specificity),
    citesFacts: rubricItem(PLAN_RUBRIC_V1.citesFacts),
    ownerClassification: rubricItem(PLAN_RUBRIC_V1.ownerClassification),
    feasibility: rubricItem(PLAN_RUBRIC_V1.feasibility),
    noInventedFacts: rubricItem(PLAN_RUBRIC_V1.noInventedFacts),
    asksNothingKnown: rubricItem(PLAN_RUBRIC_V1.asksNothingKnown),
    roleCorrectWording: rubricItem(PLAN_RUBRIC_V1.roleCorrectWording),
    /** Firewall: false when the plan carries the other side's private data. */
    firewall: z
      .object({
        held: z.boolean(),
        defects: z.array(PlanReviewDefectSchema).max(8).default([]),
      })
      .strict(),
    /** The reviewer's total /100; code recomputes it (planReviewScore). */
    score: z.number().int().min(0).max(100),
  })
  .strict();
export type PlanReviewResult = z.infer<typeof PlanReviewResultSchema>;

/**
 * The review's score as code reads it: the items' sum (never the model's
 * stated total), and fatal when an integrity item failed.
 */
export function planReviewScore(review: PlanReviewResult): {
  readonly score: number;
  readonly fatal: boolean;
  readonly passes: boolean;
} {
  const items = Object.keys(PLAN_RUBRIC_V1) as PlanRubricItem[];
  const score = items.reduce((sum, item) => sum + review[item].score, 0);
  const fatal =
    !review.firewall.held ||
    review.firewall.defects.length > 0 ||
    review.noInventedFacts.score < PLAN_RUBRIC_V1.noInventedFacts;
  return { score, fatal, passes: !fatal && score >= PLAN_REVIEW_BAR };
}

// --- review v2 (plan job 37655270, 2026-10-30) ------------------------------------

/**
 * Live 2026-10-30 (plan d79a3147, round 2): R1 marked the firewall failed
 * while scoring noInventedFacts 15/15 and naming no defect, and no step
 * quotes private material. A fatal verdict must be checkable: a firewall
 * defect names the step (or null for the summary or open questions) and
 * what it exposes. `exposed` goes back to the writer only; the person is
 * never shown it (it could be the very material at issue).
 */
export const PLAN_REVIEW_V2_SCHEMA_VERSION = 2;
export const PlanFirewallDefectSchema = z
  .object({
    stepKey: stepKey.nullable(),
    /** The plan's own words that carry the private material, as written. */
    exposed: z.string().trim().min(1).max(300),
    problem: z.string().trim().min(1).max(300),
    fix: z.string().trim().min(1).max(300),
  })
  .strict();
export type PlanFirewallDefect = z.infer<typeof PlanFirewallDefectSchema>;

export const PlanReviewResultV2Schema = PlanReviewResultSchema.extend({
  firewall: z
    .object({
      held: z.boolean(),
      defects: z.array(PlanFirewallDefectSchema).max(8).default([]),
    })
    .strict(),
}).strict();
export type PlanReviewResultV2 = z.infer<typeof PlanReviewResultV2Schema>;

/**
 * The review's verdict with integrity held to what the reviewer named.
 * A firewall breach or an invented fact WITH a named defect is fatal,
 * whatever the total. The same verdict with nothing named cannot be
 * checked: it is not fatal, and comes back as `unnamed` so code logs it
 * and carries it as an open point -- never passed over in silence. The
 * firewall is not loosened: a named leak, however small, stays fatal.
 */
export function planReviewVerdict(review: PlanReviewResult): {
  readonly score: number;
  readonly fatal: boolean;
  readonly passes: boolean;
  readonly unnamed: readonly ("firewall" | "noInventedFacts")[];
} {
  const items = Object.keys(PLAN_RUBRIC_V1) as PlanRubricItem[];
  const score = items.reduce((sum, item) => sum + review[item].score, 0);
  const firewallFlag =
    !review.firewall.held || review.firewall.defects.length > 0;
  const inventedFlag =
    review.noInventedFacts.score < PLAN_RUBRIC_V1.noInventedFacts;
  const firewallNamed = review.firewall.defects.length > 0;
  const inventedNamed = review.noInventedFacts.defects.length > 0;
  const unnamed: ("firewall" | "noInventedFacts")[] = [];
  if (firewallFlag && !firewallNamed) unnamed.push("firewall");
  if (inventedFlag && !inventedNamed) unnamed.push("noInventedFacts");
  const fatal =
    (firewallFlag && firewallNamed) || (inventedFlag && inventedNamed);
  return {
    score,
    fatal,
    passes: !fatal && score >= PLAN_REVIEW_BAR,
    unnamed,
  };
}

/** R1 and R2 review the same plan independently, each leading on its own focus. */
export const PLAN_REVIEW_FOCI = [
  "COVERAGE_AND_SPECIFICITY",
  "FEASIBILITY_AND_INVENTED_FACTS",
] as const;

export const PlanReviewVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    side: PlanSideSchema,
    focus: z.enum(PLAN_REVIEW_FOCI),
    /** What they asked, in their words. UNTRUSTED. */
    ask: z.string().trim().min(1).max(2_000),
    /** The Situation dossier the plan was written from. UNTRUSTED. */
    situation: z.string().min(1).max(24_000),
    /** Public findings with sources; may be empty. UNTRUSTED. */
    publicFindings: z.string().max(8_000),
    /** The actions Q may name (code-built roster). */
    allowedActions: z.string().min(1).max(8_000),
    /** The plan under review, as JSON. UNTRUSTED. */
    plan: z.string().min(1).max(16_000),
  })
  .strict();
export type PlanReviewVariables = z.infer<typeof PlanReviewVariablesSchema>;
export const PLAN_REVIEW_UNTRUSTED = [
  "ask",
  "situation",
  "publicFindings",
  "plan",
] as const;

export const PlanReadStepSchema = z
  .object({
    key: stepKey,
    title: z.string().trim().min(1).max(160),
    /** The document's own reason, or what the step is evidently for. */
    why: z.string().trim().min(1).max(300),
    /** An uploaded plan has no dossier yet: empty until refined. */
    cites: z.array(PlanFactRefSchema).max(8).default([]),
    owner: z.enum(PLAN_READ_STEP_OWNERS),
    action: PlanStepActionSchema,
    /** Only a date the document states; null otherwise. */
    due: PlanLocalDateSchema.nullable(),
    evidenceNeeded,
    /** The document's words this step was read from, verbatim (code checks it). */
    quote: z.string().trim().min(1).max(300),
  })
  .strict();
export type PlanReadStep = z.infer<typeof PlanReadStepSchema>;

export const PlanReadResultSchema = z
  .object({
    /** False when the document is not a plan or cannot be read as one: nothing is saved. */
    readable: z.boolean(),
    /** The goal the document states; null when it states none. */
    goal: z.string().trim().min(1).max(300).nullable(),
    side: PlanSideSchema.nullable(),
    /** What the document says of the situation; null when it says nothing. */
    situationSummary: z.string().trim().min(1).max(600).nullable(),
    situationRefs: z.array(PlanFactRefSchema).max(0).default([]),
    steps: z.array(PlanReadStepSchema).max(12).default([]),
    openQuestions: z
      .array(z.string().trim().min(1).max(300))
      .max(8)
      .default([]),
  })
  .strict();
export type PlanReadResult = z.infer<typeof PlanReadResultSchema>;

export const PlanReadVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The side of the person who uploaded it. */
    side: PlanSideSchema,
    today: PlanLocalDateSchema,
    /** The document's name as uploaded. UNTRUSTED. */
    documentName: z.string().trim().min(1).max(300),
    /** The whole document's text. UNTRUSTED. */
    documentText: z.string().min(1).max(60_000),
    /** The actions Q may name (code-built roster). */
    allowedActions: z.string().min(1).max(8_000),
  })
  .strict();
export type PlanReadVariables = z.infer<typeof PlanReadVariablesSchema>;
export const PLAN_READ_UNTRUSTED = ["documentName", "documentText"] as const;

// --- v2 (plan live run 1, 2026-10-29) ------------------------------------------

/**
 * PLAN_WRITE v2's output: the v1 shape with limits the model can meet and
 * that match the stored plan's (contracts `QPlanStepSchema`): why has room
 * for two full sentences (live: nearly every v1 why was clipped at 300,
 * "payback,…"), evidenceNeeded and openQuestions are bounded as the stored
 * plan is (6), and a step's unknown key is left out rather than refusing
 * the plan (live: 7 of 19 writes refused whole for one overflowing list or
 * one stray key). Lists over their bound are cut to their first items by
 * the gateway (dropListItems), reported, never repaired.
 */
export const PLAN_WRITE_V2_SCHEMA_VERSION = 2;
export const PLAN_WHY_MAX = 600;
export const PLAN_LIST_MAX = 6;

export const PlanWriteStepV2Schema = z.object({
  key: stepKey,
  title: z.string().trim().min(1).max(160),
  why: z.string().trim().min(1).max(PLAN_WHY_MAX),
  cites: z.array(PlanFactRefSchema).min(1).max(8),
  owner: PlanStepOwnerSchema,
  action: PlanStepActionSchema,
  due: PlanLocalDateSchema.nullable(),
  evidenceNeeded: z
    .array(z.string().trim().min(1).max(200))
    .max(PLAN_LIST_MAX)
    .default([]),
});
export type PlanWriteStepV2 = z.infer<typeof PlanWriteStepV2Schema>;

export const PlanWriteResultV2Schema = z.object({
  goal: z.string().trim().min(1).max(300),
  side: PlanSideSchema,
  situationSummary: z.string().trim().min(1).max(600),
  situationRefs: z.array(PlanFactRefSchema).min(1).max(24),
  steps: z.array(PlanWriteStepV2Schema).min(1).max(12),
  openQuestions: z
    .array(z.string().trim().min(1).max(300))
    .max(PLAN_LIST_MAX)
    .default([]),
  clarification: PlanClarificationSchema.nullable().default(null),
});
export type PlanWriteResultV2 = z.infer<typeof PlanWriteResultV2Schema>;
