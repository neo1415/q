import {
  WORKFORCE_PLAN_CANNOT_MAX_LENGTH as JOB_PLAN_CANNOT_MAX,
  WorkforceDocumentCritiqueRequestSchema,
  WorkforceOwnDocumentRequestSchema,
} from "@capital-q/contracts";
import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * Q's workforce (founder brief J1-J9, 2026-10-06): the lead Q plans a job
 * and hands its steps to specialist agents; every outward draft is graded
 * by a reviewer against the house and personal etiquette guides and
 * Capital Q's integrity rules, and goes back to the writer with feedback
 * when it falls below the bar.
 *
 * Four prompts, each a closed shape a model fills and code acts on:
 *
 *   DRAFT_REVIEW   the reviewer: a score per rubric criterion, a pass or
 *                  fail per integrity rule, and feedback for the writer.
 *                  Code computes the overall score and decides; the model
 *                  never says "send".
 *   DRAFT_REDRAFT  the writer's redraft from that feedback.
 *   REPLY_READER   what the other side's latest message means (a no, not
 *                  now, interest, a question, a request for a document, a
 *                  wish to meet) and its tone. Replaces the fixed phrase
 *                  lists that used to guess this (J7).
 *   JOB_PLAN       the lead Q: a goal decomposed into steps, each owned by
 *                  one agent role, with the tools it needs. Code bounds the
 *                  plan by the grant and the budget before anything runs.
 */

// ---------------------------------------------------------------------------
// The rubric
// ---------------------------------------------------------------------------

/**
 * Graded criteria, from the house guide (ADR 0050, built-in/v1) and the
 * person's own guide. Each is scored 0-5 by the reviewer; code weights them.
 */
export const DRAFT_RUBRIC_CRITERIA = [
  "WARM_OPENING",
  "ASK_TIMING",
  "ANSWERS_THEM",
  "CONCISE_AND_CALM",
  "READS_SIGNALS",
  "PERSONAL_STYLE",
] as const;
export type DraftRubricCriterion = (typeof DRAFT_RUBRIC_CRITERIA)[number];

/**
 * Capital Q's integrity rules: pass or fail, never averaged away. A draft
 * that fails one never passes, whatever it scores.
 */
export const DRAFT_INTEGRITY_RULES = [
  "GROUNDED",
  "NO_COMMITMENTS",
  "NOTHING_PRIVATE",
  "HONEST_IDENTITY",
] as const;
export type DraftIntegrityRule = (typeof DRAFT_INTEGRITY_RULES)[number];

export const DRAFT_CHANNELS = ["CHAT", "EMAIL"] as const;
export type DraftChannel = (typeof DRAFT_CHANNELS)[number];

/** Where the message sits in the conversation, read by code. */
export const DRAFT_STAGES = ["FIRST", "FOLLOW_UP", "REPLY"] as const;
export type DraftStage = (typeof DRAFT_STAGES)[number];

const DraftFrame = {
  ...TaskFrameSchema,
  /** The person Q writes for. Trusted (their own profile). */
  principalName: z.string().max(120),
  /** Who receives it. UNTRUSTED (the other side's own name). */
  counterpartName: z.string().max(200),
  channel: z.enum(DRAFT_CHANNELS),
  stage: z.enum(DRAFT_STAGES),
  /** What the message is for, in code's words. Trusted. */
  purpose: z.string().max(600),
  /**
   * What the message may state as fact: the approved brief or the
   * authorised material. UNTRUSTED (it quotes profiles and people).
   */
  material: z.string().max(6_000),
  /** The conversation so far, oldest first. UNTRUSTED. */
  thread: z.string().max(8_000),
};

// ---------------------------------------------------------------------------
// DRAFT_REVIEW
// ---------------------------------------------------------------------------

export const DRAFT_REVIEW_SCHEMA_NAME = "DraftReviewResult";
export const DRAFT_REVIEW_SCHEMA_VERSION = 1;

export const DraftReviewVariablesSchema = z
  .object({
    ...DraftFrame,
    /** The draft under review. UNTRUSTED (a model wrote it). */
    draft: z.string().max(4_000),
  })
  .strict();
export type DraftReviewVariables = z.infer<typeof DraftReviewVariablesSchema>;

export const DRAFT_REVIEW_UNTRUSTED = [
  "counterpartName",
  "material",
  "thread",
  "draft",
] as const;

export const DraftReviewResultSchema = z
  .object({
    criteria: z
      .array(
        z
          .object({
            criterion: z.enum(DRAFT_RUBRIC_CRITERIA),
            score: z.number().int().min(0).max(5),
            note: z.string().trim().max(300),
          })
          .strict(),
      )
      .max(DRAFT_RUBRIC_CRITERIA.length),
    integrity: z
      .array(
        z
          .object({
            rule: z.enum(DRAFT_INTEGRITY_RULES),
            ok: z.boolean(),
            note: z.string().trim().max(300),
          })
          .strict(),
      )
      .max(DRAFT_INTEGRITY_RULES.length),
    /** What the writer should change, concretely. Empty when nothing. */
    feedback: z.string().trim().max(1_000),
  })
  .strict();
export type DraftReviewResult = z.infer<typeof DraftReviewResultSchema>;

/**
 * v2 (Zino, 2026-10-08: Tensorgate offered "the deck, or 20 minutes this
 * week?" and Q answered "would you be open to connecting?"). The reviewer
 * now reads what code found still open in their latest message (a meeting,
 * a document, a question) and checks one more integrity rule,
 * RESPONDS_TO_THREAD, which is never averaged away.
 *
 * Its free text is bounded loosely and cut by code: live 2026-10-06/07 a
 * note a few characters over 300 refused the whole grade twice
 * (INVALID_MODEL_OUTPUT on both attempts), and the draft was held as
 * "couldn't be checked". Code keeps 300 per note and 1,000 of feedback.
 */
export const DRAFT_REVIEW_V2_SCHEMA_VERSION = 2;

export const DRAFT_INTEGRITY_RULES_V2 = [
  ...DRAFT_INTEGRITY_RULES,
  "RESPONDS_TO_THREAD",
] as const;
export type DraftIntegrityRuleV2 = (typeof DRAFT_INTEGRITY_RULES_V2)[number];

export const DraftReviewV2VariablesSchema = DraftReviewVariablesSchema.extend({
  /**
   * What their latest message left open, in code's fixed words ("They
   * offered or asked for a call or a meeting."). Trusted: code wrote it
   * from the thread; it never quotes them. "None." when nothing is open.
   */
  pendingAsks: z.string().max(600),
}).strict();
export type DraftReviewV2Variables = z.infer<
  typeof DraftReviewV2VariablesSchema
>;

export const DraftReviewResultV2Schema = z
  .object({
    criteria: z
      .array(
        z
          .object({
            criterion: z.enum(DRAFT_RUBRIC_CRITERIA),
            score: z.number().int().min(0).max(5),
            note: z.string().trim().max(2_000),
          })
          .strict(),
      )
      .max(DRAFT_RUBRIC_CRITERIA.length * 2),
    integrity: z
      .array(
        z
          .object({
            rule: z.enum(DRAFT_INTEGRITY_RULES_V2),
            ok: z.boolean(),
            note: z.string().trim().max(2_000),
          })
          .strict(),
      )
      .max(DRAFT_INTEGRITY_RULES_V2.length * 2),
    feedback: z.string().trim().max(4_000),
  })
  .strict();
export type DraftReviewResultV2 = z.infer<typeof DraftReviewResultV2Schema>;

// ---------------------------------------------------------------------------
// DRAFT_REDRAFT
// ---------------------------------------------------------------------------

export const DRAFT_REDRAFT_SCHEMA_NAME = "DraftRedraftResult";
export const DRAFT_REDRAFT_SCHEMA_VERSION = 1;

export const DraftRedraftVariablesSchema = z
  .object({
    ...DraftFrame,
    /** The draft that fell below the bar. UNTRUSTED. */
    draft: z.string().max(4_000),
    /** The reviewer's feedback. UNTRUSTED (a model wrote it). */
    feedback: z.string().max(2_000),
  })
  .strict();
export type DraftRedraftVariables = z.infer<typeof DraftRedraftVariablesSchema>;

export const DRAFT_REDRAFT_UNTRUSTED = [
  "counterpartName",
  "material",
  "thread",
  "draft",
  "feedback",
] as const;

export const DraftRedraftResultSchema = z
  .object({
    /** The new message, or null when nothing honest can be written. */
    body: z.string().trim().min(1).max(3_800).nullable(),
  })
  .strict();
export type DraftRedraftResult = z.infer<typeof DraftRedraftResultSchema>;

// ---------------------------------------------------------------------------
// REPLY_READER
// ---------------------------------------------------------------------------

export const REPLY_READER_SCHEMA_NAME = "ReplyReaderResult";
export const REPLY_READER_SCHEMA_VERSION = 1;

export const ReplyReaderVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The person Q works for. Trusted. */
    principalName: z.string().max(120),
    /** Who wrote. UNTRUSTED. */
    counterpartName: z.string().max(200),
    /** The few messages before it, oldest first. UNTRUSTED. */
    thread: z.string().max(4_000),
    /** Their latest message. UNTRUSTED. */
    latest: z.string().trim().min(1).max(4_000),
  })
  .strict();
export type ReplyReaderVariables = z.infer<typeof ReplyReaderVariablesSchema>;

export const REPLY_READER_UNTRUSTED = [
  "counterpartName",
  "thread",
  "latest",
] as const;

export const REPLY_STANCES = [
  "INTERESTED",
  "NEUTRAL",
  "QUESTION",
  "NOT_NOW",
  "DECLINE",
  "STOP",
] as const;
export type ReplyStance = (typeof REPLY_STANCES)[number];

export const REPLY_TONES = ["WARM", "NEUTRAL", "NEGATIVE"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];

export const REPLY_REQUEST_KINDS = [
  "DOCUMENT",
  "INFORMATION",
  "INTRODUCTION",
  "OTHER",
] as const;

export const ReplyReaderResultSchema = z
  .object({
    stance: z.enum(REPLY_STANCES),
    tone: z.enum(REPLY_TONES),
    /** They asked for, or agreed to, a call or a meeting. */
    wantsMeeting: z.boolean(),
    /** What they asked to be sent or told, in their words. */
    requests: z
      .array(
        z
          .object({
            kind: z.enum(REPLY_REQUEST_KINDS),
            what: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type ReplyReaderResult = z.infer<typeof ReplyReaderResultSchema>;

/** A stance that means "do not write to them unless the person says so". */
export function stanceDeclines(stance: ReplyStance): boolean {
  return stance === "NOT_NOW" || stance === "DECLINE" || stance === "STOP";
}

// ---------------------------------------------------------------------------
// JOB_PLAN
// ---------------------------------------------------------------------------

export const JOB_PLAN_SCHEMA_NAME = "JobPlanResult";
export const JOB_PLAN_SCHEMA_VERSION = 1;

/** The agent roles a plan may assign (the registry's codes). */
export const PLAN_AGENT_ROLES = [
  "OUTREACH",
  "MANDATE_WATCHER",
  "CONVERSATION",
  "WRITER",
  "REVIEWER",
  "SCHEDULER",
  "DOCUMENTS",
  "RESEARCH",
  "AD_HOC",
] as const;

export const JobPlanVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The job in the person's words. UNTRUSTED. */
    goal: z.string().trim().min(1).max(2_000),
    /** The roles and the tools each may use, in code's words. Trusted. */
    roster: z.string().max(6_000),
    /** What the person allowed for this job, in code's words. Trusted. */
    allowed: z.string().max(2_000),
  })
  .strict();
export type JobPlanVariables = z.infer<typeof JobPlanVariablesSchema>;

export const JOB_PLAN_UNTRUSTED = ["goal"] as const;

export const JobPlanResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(400),
    steps: z
      .array(
        z
          .object({
            key: z
              .string()
              .regex(/^[a-z][a-z0-9_]{0,31}$/u)
              .max(32),
            role: z.enum(PLAN_AGENT_ROLES),
            /** Only for AD_HOC: a short name for the spawned agent. */
            agentName: z.string().trim().min(1).max(60).nullable(),
            goal: z.string().trim().min(1).max(400),
            tools: z.array(z.string().min(1).max(80)).max(12),
            dependsOn: z.array(z.string().max(32)).max(8),
          })
          .strict(),
      )
      .max(12),
    /** What the job asks that no permitted agent can do. */
    cannot: z.array(z.string().trim().min(1).max(JOB_PLAN_CANNOT_MAX)).max(5),
  })
  .strict();
export type JobPlanResult = z.infer<typeof JobPlanResultSchema>;

// JOB_PLAN v2 (recovery D1, audit D-02): the lead contract's roles. Writing
// and reviewing are not roles; they happen inside CONVERSATION and
// OUTREACH. Code still refuses a role with no executor in this deployment.
export const JOB_PLAN_V2_SCHEMA_VERSION = 2;

export const PLAN_AGENT_ROLES_V2 = [
  "CONVERSATION",
  "OUTREACH",
  "RESEARCH",
  "DOCUMENTS",
  "SCHEDULING",
  "DISCOVERY",
  "DILIGENCE",
] as const;

export const JobPlanResultV2Schema = z
  .object({
    summary: z.string().trim().min(1).max(400),
    steps: z
      .array(
        z
          .object({
            key: z
              .string()
              .regex(/^[a-z][a-z0-9_]{0,31}$/u)
              .max(32),
            role: z.enum(PLAN_AGENT_ROLES_V2),
            goal: z.string().trim().min(1).max(400),
            tools: z.array(z.string().min(1).max(80)).max(12),
            dependsOn: z.array(z.string().max(32)).max(8),
          })
          .strict(),
      )
      .max(12),
    /** What the job asks that no registered agent can do. */
    cannot: z.array(z.string().trim().min(1).max(JOB_PLAN_CANNOT_MAX)).max(5),
  })
  .strict();
export type JobPlanResultV2 = z.infer<typeof JobPlanResultV2Schema>;

/** v3 retains the exact typed document request in the approved plan. */
export const JOB_PLAN_V3_SCHEMA_VERSION = 3;
export const JobPlanResultV3Schema = JobPlanResultV2Schema.extend({
  steps: z
    .array(
      JobPlanResultV2Schema.shape.steps.element
        .extend({
          document: WorkforceOwnDocumentRequestSchema.optional(),
        })
        .strict(),
    )
    .max(12),
}).strict();
export type JobPlanResultV3 = z.infer<typeof JobPlanResultV3Schema>;

/**
 * v4 (2026-10-12): the lead may also ask for a memo about the ONE company
 * the job names, and for a second specialist to critique and revise a
 * document an earlier step prepared. The planner never writes a company
 * id: code binds NAMED_COMPANY to the record the goal names, or refuses.
 */
export const JOB_PLAN_V4_SCHEMA_VERSION = 4;
export const PlannedNamedCompanyDocumentSchema = z
  .object({
    operation: z.literal("PREPARE"),
    kind: z.enum(["MEMO", "ONE_PAGER", "INVESTMENT_BRIEF"]),
    scope: z.literal("NAMED_COMPANY"),
  })
  .strict();
export const JobPlanResultV4Schema = JobPlanResultV2Schema.extend({
  steps: z
    .array(
      JobPlanResultV2Schema.shape.steps.element
        .extend({
          document: z
            .union([
              WorkforceOwnDocumentRequestSchema,
              PlannedNamedCompanyDocumentSchema,
              WorkforceDocumentCritiqueRequestSchema,
            ])
            .optional(),
        })
        .strict(),
    )
    .max(12),
}).strict();
export type JobPlanResultV4 = z.infer<typeof JobPlanResultV4Schema>;

/**
 * v5 (wf 2026-10-16): the lead reasons before it plans. It reads the
 * situation code wrote from the person's authorised records (facts F1..),
 * states the outcome, what is missing, why each step is there and what it
 * rests on, contingency steps, and what should come next. Code grounds
 * every reference and decides what needs approval.
 */
export const JOB_PLAN_V5_SCHEMA_VERSION = 5;

export const JobPlanVariablesV5Schema = JobPlanVariablesSchema.extend({
  /** Facts code wrote from authorised reads. UNTRUSTED (names, titles). */
  situation: z.string().max(8_000),
}).strict();
export type JobPlanVariablesV5 = z.infer<typeof JobPlanVariablesV5Schema>;

export const JOB_PLAN_V5_UNTRUSTED = ["goal", "situation"] as const;

const FactRef = z.string().regex(/^F[1-9][0-9]?$/u);

export const JobPlanResultV5Schema = JobPlanResultV4Schema.extend({
  /** The outcome the person wants, in one sentence. */
  outcome: z.string().trim().min(1).max(400),
  prerequisites: z
    .array(
      z
        .object({
          what: z.string().trim().min(1).max(300),
          status: z.enum(["MET", "MISSING", "UNKNOWN"]),
          blocking: z.boolean(),
          evidence: z.array(FactRef).max(6),
          resolvedBy: z.string().max(32).nullable(),
        })
        .strict(),
    )
    .max(8),
  steps: z
    .array(
      JobPlanResultV4Schema.shape.steps.element
        .extend({
          why: z.string().trim().min(1).max(300),
          evidence: z.array(FactRef).max(6),
          fallbackFor: z.string().max(32).nullable(),
        })
        .strict(),
    )
    .max(12),
  nextActions: z
    .array(
      z
        .object({
          action: z.string().trim().min(1).max(300),
          why: z.string().trim().min(1).max(300),
          evidence: z.array(FactRef).max(6),
          tool: z.string().max(80).nullable(),
        })
        .strict(),
    )
    .max(6),
}).strict();
export type JobPlanResultV5 = z.infer<typeof JobPlanResultV5Schema>;

/**
 * v6 (live 2026-10-15): the deployed v5 planner wrote every evidence
 * reference in a shape the strict pattern refused (eight
 * `steps.N.evidence.M:invalid_format`), so the whole plan was lost and Q
 * said planning failed. A reference is now any short string; code reads
 * the F number out of it and grounds it against the situation, so a loose
 * shape costs that reference at most, never the plan.
 */
export const JOB_PLAN_V6_SCHEMA_VERSION = 6;
const LooseRef = z.string().trim().max(120);
const looseEvidence = z.array(LooseRef).max(12);
export const JobPlanResultV6Schema = JobPlanResultV5Schema.extend({
  prerequisites: z
    .array(
      JobPlanResultV5Schema.shape.prerequisites.element
        .extend({ evidence: looseEvidence })
        .strict(),
    )
    .max(8),
  steps: z
    .array(
      JobPlanResultV5Schema.shape.steps.element
        .extend({ evidence: looseEvidence })
        .strict(),
    )
    .max(12),
  nextActions: z
    .array(
      JobPlanResultV5Schema.shape.nextActions.element
        .extend({ evidence: looseEvidence })
        .strict(),
    )
    .max(6),
}).strict();
export type JobPlanResultV6 = z.infer<typeof JobPlanResultV6Schema>;

/**
 * v8 (owner 2026-10-23): open ANALYSIS documents (a growth plan, a market
 * study, a strategy) beside the fixed kinds, and Q's first read -- a short
 * initial view the person hears while the work runs. A NAMED_COMPANY
 * analysis carries no company id: code binds it, as for a memo.
 */
export const JOB_PLAN_V8_SCHEMA_VERSION = 8;
export const PlannedAnalysisDocumentSchema = z
  .object({
    operation: z.literal("PREPARE"),
    kind: z.literal("ANALYSIS"),
    scope: z.enum(["OWN_COMPANY", "GENERAL", "NAMED_COMPANY"]),
  })
  .strict();
export const JobPlanResultV8Schema = JobPlanResultV6Schema.extend({
  steps: z
    .array(
      JobPlanResultV6Schema.shape.steps.element
        .extend({
          document: z
            .union([
              WorkforceOwnDocumentRequestSchema,
              PlannedNamedCompanyDocumentSchema,
              WorkforceDocumentCritiqueRequestSchema,
              PlannedAnalysisDocumentSchema,
            ])
            .optional(),
        })
        .strict(),
    )
    .max(12),
  /**
   * Q's first read of the question, from what it already knows, said while
   * the work runs: two or three sentences, labelled as a first view, with
   * no figures. Null when there is nothing useful to say yet.
   */
  firstRead: z.string().trim().min(1).max(700).nullable().default(null),
}).strict();
export type JobPlanResultV8 = z.infer<typeof JobPlanResultV8Schema>;

/**
 * v9 (QA F-78, 2026-10-24, investor savanna-seed): "Make me a short
 * 12-month plan ... West Africa logistics" failed planning outright -- the
 * one planner answer was refused as INVALID_MODEL_OUTPUT and the person was
 * told something failed on Q's side. A plan is now lost only for its core
 * (summary, outcome, steps): a malformed first read, document request,
 * prerequisite list or next-action list costs that part alone. A step whose
 * document is dropped is then refused by code and replanned with the
 * reason, never run without one.
 */
export const JOB_PLAN_V9_SCHEMA_VERSION = 9;
export const JobPlanResultV9Schema = JobPlanResultV8Schema.extend({
  steps: z
    .array(
      JobPlanResultV8Schema.shape.steps.element
        .extend({
          document:
            JobPlanResultV8Schema.shape.steps.element.shape.document.catch(
              undefined,
            ),
          why: z.string().trim().min(1).max(600),
        })
        .strict(),
    )
    .max(12),
  prerequisites: JobPlanResultV8Schema.shape.prerequisites.catch([]),
  nextActions: JobPlanResultV8Schema.shape.nextActions.catch([]),
  firstRead: z
    .string()
    .trim()
    .min(1)
    .max(1_200)
    .nullable()
    .default(null)
    .catch(null),
}).strict();
export type JobPlanResultV9 = z.infer<typeof JobPlanResultV9Schema>;
/** v9's input shape: firstRead may be absent (an older plan, a fake). */
export type JobPlanResultV9Input = z.input<typeof JobPlanResultV9Schema>;

/**
 * v10 (live 2026-10-24, batch 5): the investor's plan was refused twice
 * more as INVALID_MODEL_OUTPUT. Keys are any short text (code normalises
 * them, and every reference to them, to the plan's key form), unknown keys
 * are stripped at every level, and text runs longer (code clips what it
 * stores). Roles stay a closed list: a step with an unknown role is dropped
 * by the gateway and the plan replanned by code, never run.
 */
export const JOB_PLAN_V10_SCHEMA_VERSION = 10;
const LooseKey = z.string().trim().min(1).max(60);
const LooseRefs = z.array(z.string().trim().max(120)).max(12).catch([]);
export const JobPlanResultV10Schema = z.object({
  summary: z.string().trim().min(1).max(800),
  outcome: z.string().trim().min(1).max(800),
  steps: z
    .array(
      z.object({
        key: LooseKey,
        role: z.enum(PLAN_AGENT_ROLES_V2),
        goal: z.string().trim().min(1).max(800),
        tools: z.array(z.string().min(1).max(80)).max(12),
        dependsOn: z.array(LooseKey).max(8).catch([]),
        document:
          JobPlanResultV8Schema.shape.steps.element.shape.document.catch(
            undefined,
          ),
        why: z.string().trim().min(1).max(800),
        evidence: LooseRefs,
        fallbackFor: LooseKey.nullable().catch(null),
      }),
    )
    .max(12),
  prerequisites: z
    .array(
      z.object({
        what: z.string().trim().min(1).max(600),
        status: z.enum(["MET", "MISSING", "UNKNOWN"]),
        blocking: z.boolean().catch(false),
        evidence: LooseRefs,
        resolvedBy: LooseKey.nullable().catch(null),
      }),
    )
    .max(8)
    .catch([]),
  nextActions: z
    .array(
      z.object({
        action: z.string().trim().min(1).max(600),
        why: z.string().trim().min(1).max(600),
        evidence: LooseRefs,
        tool: z.string().max(80).nullable().catch(null),
      }),
    )
    .max(6)
    .catch([]),
  cannot: z.array(z.string().trim().min(1).max(1_200)).max(5).catch([]),
  firstRead: z
    .string()
    .trim()
    .min(1)
    .max(1_200)
    .nullable()
    .default(null)
    .catch(null),
});
export type JobPlanResultV10 = z.infer<typeof JobPlanResultV10Schema>;

/** A model's step key in the plan's own form (lowercase, underscores, ≤32). */
export function planKey(raw: string): string {
  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^[^a-z]+/u, "")
    .replace(/_+$/u, "")
    .slice(0, 32);
  return key.length === 0 ? "step" : key;
}

/**
 * A v10 plan in v9's shape: keys and every reference to them normalised,
 * text clipped to what v9 and the approved payload store.
 */
export function normalisePlanV10(plan: JobPlanResultV10): JobPlanResultV9 {
  const clip = (text: string, max: number) => text.slice(0, max);
  return {
    summary: clip(plan.summary, 400),
    outcome: clip(plan.outcome, 400),
    cannot: plan.cannot.map((one) => clip(one, JOB_PLAN_CANNOT_MAX)),
    firstRead: plan.firstRead === null ? null : clip(plan.firstRead, 1_200),
    prerequisites: plan.prerequisites.map((one) => ({
      what: clip(one.what, 300),
      status: one.status,
      blocking: one.blocking,
      evidence: one.evidence,
      resolvedBy: one.resolvedBy === null ? null : planKey(one.resolvedBy),
    })),
    nextActions: plan.nextActions.map((one) => ({
      action: clip(one.action, 300),
      why: clip(one.why, 300),
      evidence: one.evidence,
      tool: one.tool,
    })),
    steps: plan.steps.map((step) => ({
      key: planKey(step.key),
      role: step.role,
      goal: clip(step.goal, 400),
      tools: step.tools,
      dependsOn: step.dependsOn.map(planKey),
      ...(step.document === undefined
        ? {}
        : {
            document:
              step.document.operation === "CRITIQUE_AND_REVISE"
                ? {
                    ...step.document,
                    sourceStep: planKey(step.document.sourceStep),
                  }
                : step.document,
          }),
      why: clip(step.why, 600),
      evidence: step.evidence,
      fallbackFor: step.fallbackFor === null ? null : planKey(step.fallbackFor),
    })),
  };
}

// SUBSTANCE_CRITIQUE (2026-10-12): a second specialist's critique of a
// prepared document, against the evidence it was built from.
export const SUBSTANCE_CRITIQUE_SCHEMA_NAME = "SubstanceCritiqueResult";
export const SUBSTANCE_CRITIQUE_SCHEMA_VERSION = 1;
export const SUBSTANCE_CRITIQUE_ISSUE_KINDS = [
  "UNSUPPORTED",
  "CONTRADICTION",
  "MISSING_RISK",
  "MISSING_INFORMATION",
  "UNCLEAR_CONCLUSION",
  "GENERIC",
] as const;

export const SubstanceCritiqueVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    documentKind: z.string().min(1).max(40),
    principalName: z.string().min(1).max(120),
    companyName: z.string().min(1).max(120),
    /** The job step's goal: what the document is for. UNTRUSTED. */
    purpose: z.string().min(1).max(600),
    /** The findings the document was built from. UNTRUSTED. */
    evidence: z.string().max(12_000),
    /** The document's sections as text. UNTRUSTED. */
    document: z.string().min(1).max(24_000),
  })
  .strict();
export type SubstanceCritiqueVariables = z.infer<
  typeof SubstanceCritiqueVariablesSchema
>;
export const SUBSTANCE_CRITIQUE_UNTRUSTED = [
  "purpose",
  "evidence",
  "document",
] as const;

export const SubstanceCritiqueResultSchema = z
  .object({
    material: z.boolean(),
    issues: z
      .array(
        z
          .object({
            kind: z.enum(SUBSTANCE_CRITIQUE_ISSUE_KINDS),
            section: z.string().trim().min(1).max(120),
            problem: z.string().trim().min(1).max(400),
            fix: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .max(8),
    strengths: z.array(z.string().trim().min(1).max(240)).max(3),
  })
  .strict();
export type SubstanceCritiqueResult = z.infer<
  typeof SubstanceCritiqueResultSchema
>;

// DILIGENCE_QUESTIONS (2026-10-12): founder questions from a prepared
// document's gaps and its critique, for the person's approval.
export const DILIGENCE_QUESTIONS_SCHEMA_NAME = "DiligenceQuestionsResult";
export const DILIGENCE_QUESTIONS_SCHEMA_VERSION = 1;
export const DiligenceQuestionsVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    companyName: z.string().min(1).max(120),
    /** The job step's goal. UNTRUSTED. */
    purpose: z.string().min(1).max(600),
    /** What the document says is not known. UNTRUSTED. */
    gaps: z.string().max(4_000),
    /** The critique's missing-information and risk issues. UNTRUSTED. */
    critique: z.string().max(4_000),
    /** The document's sections as text. UNTRUSTED. */
    document: z.string().min(1).max(16_000),
  })
  .strict();
export type DiligenceQuestionsVariables = z.infer<
  typeof DiligenceQuestionsVariablesSchema
>;
export const DILIGENCE_QUESTIONS_UNTRUSTED = [
  "purpose",
  "gaps",
  "critique",
  "document",
] as const;
export const DiligenceQuestionsResultSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            /** Asked of the founder, as sent (the send action's limit). */
            question: z.string().trim().min(8).max(180),
            /** The gap or risk it settles, in a few words. */
            about: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export type DiligenceQuestionsResult = z.infer<
  typeof DiligenceQuestionsResultSchema
>;

/**
 * The longest question the send action, and the table it writes, accept
 * (network.diligence_questions CHECK 3..180; ASSUMPTION_QUESTION_MAX_LENGTH).
 */
export const DILIGENCE_QUESTION_SENT_MAX_LENGTH = 180;
/**
 * The longest question accepted from the drafter (2026-10-12 live failure:
 * one question a few characters over 180 refused the whole draft). A longer
 * draft is never sent and never cut: code asks for those questions to be
 * rewritten shorter (DILIGENCE_QUESTIONS_SHORTEN), and fails the step if
 * they still do not fit.
 */
export const DILIGENCE_QUESTION_DRAFT_MAX_LENGTH = 400;

// v2: the same questions, accepted at draft length (see above).
export const DILIGENCE_QUESTIONS_SCHEMA_VERSION_V2 = 2;
export const DiligenceQuestionsDraftResultSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            /** Over 180 is rewritten by code's repair call before filing. */
            question: z
              .string()
              .trim()
              .min(8)
              .max(DILIGENCE_QUESTION_DRAFT_MAX_LENGTH),
            about: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export type DiligenceQuestionsDraftResult = z.infer<
  typeof DiligenceQuestionsDraftResultSchema
>;

// DILIGENCE_QUESTIONS_SHORTEN (2026-10-12): drafted questions over the send
// limit, rewritten under it with the same meaning. Never truncation.
export const DILIGENCE_QUESTIONS_SHORTEN_SCHEMA_NAME =
  "DiligenceQuestionsShortenResult";
export const DILIGENCE_QUESTIONS_SHORTEN_SCHEMA_VERSION = 1;
export const DiligenceQuestionsShortenVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    companyName: z.string().min(1).max(120),
    /** How many questions are given, and so must come back. */
    count: z.string().regex(/^[1-5]$/u),
    /** The over-long questions, numbered. UNTRUSTED (model-drafted). */
    questions: z.string().min(1).max(2_400),
  })
  .strict();
export type DiligenceQuestionsShortenVariables = z.infer<
  typeof DiligenceQuestionsShortenVariablesSchema
>;
export const DILIGENCE_QUESTIONS_SHORTEN_UNTRUSTED = ["questions"] as const;
export const DiligenceQuestionsShortenResultSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            question: z
              .string()
              .trim()
              .min(8)
              .max(DILIGENCE_QUESTION_SENT_MAX_LENGTH),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export type DiligenceQuestionsShortenResult = z.infer<
  typeof DiligenceQuestionsShortenResultSchema
>;
