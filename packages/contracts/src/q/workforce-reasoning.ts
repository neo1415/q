import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";

/**
 * The lead Q's reasoning about a job (wf 2026-10-16): the situation it read,
 * the outcome it works towards, what is missing, why each step is there,
 * and what should come next.
 *
 * Facts are written by code from reads authorised as the person (the
 * Relationship Brief, their waiting approvals); the model only refers to
 * them by `F<n>`, and code drops any reference that is not a fact. Whether
 * a next action needs approval is decided by code from its tool's class.
 */

export const WorkforceFactRefSchema = z.string().regex(/^F[1-9][0-9]?$/u);

export const WORKFORCE_FACT_KINDS = [
  "RELATIONSHIP_STATE",
  "YOUR_MOVE",
  "THEIR_MOVE",
  "MESSAGE_WAITING",
  "MEETING_UPCOMING",
  "MEETING_PAST",
  "NO_SHOW",
  "OPEN_REQUEST",
  "DOCUMENT_SHARED",
  "WAITING_APPROVAL",
  /**
   * Their declared mandate or thesis, as read for them (live case A,
   * 2026-10-29: a thesis job's plan marked the thesis UNKNOWN because the
   * lead never read the mandate).
   */
  "MANDATE",
  /** A source that could not be read: not known, never "none". */
  "UNKNOWN",
] as const;
export type WorkforceFactKind = (typeof WORKFORCE_FACT_KINDS)[number];

export const WorkforceSituationFactSchema = z
  .object({
    ref: WorkforceFactRefSchema,
    kind: z.enum(WORKFORCE_FACT_KINDS),
    /** Plain words written by code from the authorised read. */
    text: z.string().max(300),
    at: UtcTimestampSchema.nullable(),
  })
  .strict();
export type WorkforceSituationFact = z.infer<
  typeof WorkforceSituationFactSchema
>;

export const WORKFORCE_PREREQUISITE_STATUSES = [
  "MET",
  "MISSING",
  "UNKNOWN",
] as const;

export const WorkforcePrerequisiteSchema = z
  .object({
    what: z.string().trim().min(1).max(300),
    status: z.enum(WORKFORCE_PREREQUISITE_STATUSES),
    /** Without it the outcome cannot be reached. */
    blocking: z.boolean(),
    evidence: z.array(WorkforceFactRefSchema).max(6),
    /** The step that gets it, when the plan has one. */
    resolvedBy: z.string().max(40).nullable(),
  })
  .strict();
export type WorkforcePrerequisite = z.infer<typeof WorkforcePrerequisiteSchema>;

export const WORKFORCE_NEXT_ACTION_SOURCES = [
  "PLAN",
  "SITUATION",
  "RESULT",
] as const;

export const WorkforceNextActionSchema = z
  .object({
    action: z.string().trim().min(1).max(300),
    why: z.string().trim().min(1).max(300),
    evidence: z.array(WorkforceFactRefSchema).max(6),
    /** The tool or action it would use; null: the person's own move. */
    tool: z.string().max(80).nullable(),
    /** Decided by code from the tool's class, never by a model. */
    needsApproval: z.boolean(),
    /** The lead's plan, the situation, or what the job's steps found. */
    source: z.enum(WORKFORCE_NEXT_ACTION_SOURCES),
  })
  .strict();
export type WorkforceNextAction = z.infer<typeof WorkforceNextActionSchema>;

export const WORKFORCE_SITUATION_MAX = 24;

export const WorkforceJobReasoningSchema = z
  .object({
    /** The intended outcome, in plain words. */
    outcome: z.string().trim().min(1).max(400),
    prerequisites: z.array(WorkforcePrerequisiteSchema).max(8),
    nextActions: z.array(WorkforceNextActionSchema).max(6),
    /** The situation the lead read, as code wrote it. */
    situation: z
      .array(WorkforceSituationFactSchema)
      .max(WORKFORCE_SITUATION_MAX),
  })
  .strict();
export type WorkforceJobReasoning = z.infer<typeof WorkforceJobReasoningSchema>;

export const WORKFORCE_SIGNAL_KINDS = [
  "CONTRADICTION",
  "MISSING_INFORMATION",
  "CHANGED",
] as const;
export type WorkforceSignalKind = (typeof WORKFORCE_SIGNAL_KINDS)[number];

/** Something a step found that changes what should happen next. */
export const WorkforceSignalSchema = z
  .object({
    kind: z.enum(WORKFORCE_SIGNAL_KINDS),
    note: z.string().max(300),
    stepKey: z.string().max(40),
  })
  .strict();
export type WorkforceSignal = z.infer<typeof WorkforceSignalSchema>;

export const WORKFORCE_PROGRESS_STEP_STATUSES = [
  "DONE",
  "HELD",
  "FAILED",
  "SKIPPED",
  "WAITING",
  /** A fallback whose step finished, so it was never needed. */
  "NOT_NEEDED",
] as const;

/** The plan as it stands, derived by code from the approved plan and results. */
export const WorkforcePlanProgressSchema = z
  .object({
    outcome: z.string().max(400).nullable(),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
    steps: z
      .array(
        z
          .object({
            key: z.string().max(40),
            who: z.string().max(60),
            does: z.string().max(400),
            why: z.string().max(300).nullable(),
            status: z.enum(WORKFORCE_PROGRESS_STEP_STATUSES),
            summary: z.string().max(500).nullable(),
            dependsOn: z.array(z.string().max(40)).max(8),
            fallbackFor: z.string().max(40).nullable(),
            evidence: z.array(WorkforceSituationFactSchema).max(6),
          })
          .strict(),
      )
      .max(12),
    prerequisites: z.array(WorkforcePrerequisiteSchema).max(8),
    signals: z.array(WorkforceSignalSchema).max(12),
    nextActions: z.array(WorkforceNextActionSchema).max(8),
    situation: z
      .array(WorkforceSituationFactSchema)
      .max(WORKFORCE_SITUATION_MAX),
  })
  .strict();
export type WorkforcePlanProgress = z.infer<typeof WorkforcePlanProgressSchema>;

/**
 * Owner 2026-10-24: the person sees their document being made. Where a
 * running job's document work stands, recorded by code as it goes (counts
 * and the draft's own headings, never prose a model wrote about itself);
 * the screen words each stage in the person's language.
 */
export const WORKFORCE_LIVE_STAGES = [
  "SEARCHING",
  "READING",
  "DRAFTING",
  "REVIEWING",
  "REVISING",
  "FILING",
  // Situation-first planning (2026-10-28): a plan job's own stages. Its
  // public reading reuses SEARCHING, and FILING is the plan being kept.
  "GATHERING",
  "READING_DOCUMENTS",
  "PLANNING",
  "REVIEWING_PLAN",
  // Investigation-grade research (2026-10-29): planning the questions (and
  // a later round's open ones), and code's cross-check after each round.
  "PLANNING_RESEARCH",
  "CROSS_CHECKING",
] as const;
export type WorkforceLiveStageName = (typeof WORKFORCE_LIVE_STAGES)[number];

/** A document job's step bar, in order. */
export const WORKFORCE_DOCUMENT_LIVE_STEPS = [
  "SEARCHING",
  "READING",
  "DRAFTING",
  "REVIEWING",
  "REVISING",
  "FILING",
] as const satisfies readonly WorkforceLiveStageName[];

/**
 * A plan job's step bar, in order (2026-10-28): gathering the person's
 * situation, reading their own documents, public sources (when the ask
 * needs them), drafting, two independent reviews, keeping it.
 */
export const WORKFORCE_PLAN_LIVE_STEPS = [
  "GATHERING",
  "READING_DOCUMENTS",
  "SEARCHING",
  "PLANNING",
  "REVIEWING_PLAN",
  "FILING",
] as const satisfies readonly WorkforceLiveStageName[];

export const WorkforceLiveStageSchema = z
  .object({
    stage: z.enum(WORKFORCE_LIVE_STAGES),
    /** SEARCHING: the questions being searched. */
    questions: z.number().int().min(0).max(100).nullable(),
    /** READING onwards: public sources read, facts kept from them. */
    sources: z.number().int().min(0).max(500).nullable(),
    facts: z.number().int().min(0).max(500).nullable(),
    /** REVIEWING / REVISING: which draft, of at most how many. */
    draft: z.number().int().min(1).max(6).nullable(),
    drafts: z.number().int().min(1).max(6).nullable(),
    /** Once drafted: the document's title and section headings. */
    title: z.string().max(160).nullable(),
    sections: z.array(z.string().max(120)).max(16),
    /**
     * READING onwards: the public sources read, as their site and page
     * title only (shown as text, never a link). Additive.
     */
    read: z
      .array(
        z
          .object({
            domain: z.string().min(1).max(120),
            title: z.string().max(160).nullable(),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    /** The reviewer's points still open on the latest draft. Additive. */
    openPoints: z.number().int().min(0).max(50).nullable().optional(),
    /**
     * Investigation (2026-10-29): which research round the work is in; a
     * later round's SEARCHING counts the open questions it checks. Additive.
     */
    round: z.number().int().min(1).max(10).nullable().optional(),
    /**
     * Owner 2026-10-29: what Q is looking into, from its research brief
     * (plain words, no refs), shown as "What I'm looking into". Additive.
     */
    brief: z.string().max(600).nullable().optional(),
    at: UtcTimestampSchema,
  })
  .strict();
export type WorkforceLiveStage = z.infer<typeof WorkforceLiveStageSchema>;

/**
 * WORKING while it runs; WAITING when what is left is the person's (a
 * decision, or something it needs); DONE; FAILED; STOPPED by the person.
 */
export const WORKFORCE_LIVE_STATES = [
  "WORKING",
  "WAITING",
  "DONE",
  "FAILED",
  "STOPPED",
] as const;

/**
 * The kinds of job whose usual length is known, and that length in whole
 * minutes. A document is researched, drafted up to three times with a
 * review after each, then filed (job 9e52faf7: 3 min 25 s).
 */
export const WORKFORCE_JOB_KINDS = ["DOCUMENT", "RESEARCH", "PLAN"] as const;
export type WorkforceJobKind = (typeof WORKFORCE_JOB_KINDS)[number];

export const WORKFORCE_USUAL_MINUTES: Readonly<
  Record<WorkforceJobKind, { readonly min: number; readonly max: number }>
> = {
  DOCUMENT: { min: 2, max: 4 },
  RESEARCH: { min: 1, max: 2 },
  // Situation-first planning (2026-10-28): gather, research, draft, two
  // reviews (40-90 s by design).
  PLAN: { min: 1, max: 2 },
};

export const WorkforceLiveExpectedSchema = z
  .object({
    kind: z.enum(WORKFORCE_JOB_KINDS),
    minMinutes: z.number().int().min(0).max(60),
    maxMinutes: z.number().int().min(1).max(120),
  })
  .strict()
  .refine((expected) => expected.minMinutes <= expected.maxMinutes, {
    message: "the shortest usual length is not longer than the longest",
  });
export type WorkforceLiveExpected = z.infer<typeof WorkforceLiveExpectedSchema>;

/** The usual length of a job of this kind, as the live read carries it. */
export function workforceExpected(
  kind: WorkforceJobKind,
): WorkforceLiveExpected {
  const usual = WORKFORCE_USUAL_MINUTES[kind];
  return { kind, minMinutes: usual.min, maxMinutes: usual.max };
}

/** `GET /v1/q/workforce/jobs/:jobId/live`: one job, read as its owner. */
export const WorkforceLiveSchema = z
  .object({
    jobId: z.string().uuid(),
    state: z.enum(WORKFORCE_LIVE_STATES),
    /** Plan steps finished of all of them. */
    done: z.number().int().min(0),
    total: z.number().int().min(0),
    stage: WorkforceLiveStageSchema.nullable(),
    /** The filed document, once the job made one. */
    document: z
      .object({
        artifactId: z.string().uuid(),
        type: z.string().min(1).max(48),
        title: z.string().min(1).max(160),
      })
      .strict()
      .nullable(),
    /** WAITING, FAILED, STOPPED: why, in the plain words the Work page shows. */
    reason: z.string().max(500).nullable(),
    /**
     * Owner 2026-10-28 (a 3.5-minute document with only "Pulling it
     * together" on screen): when the job was accepted, so the card can say
     * how long it has been going. Additive.
     */
    startedAt: UtcTimestampSchema.optional(),
    /**
     * How long work of this kind usually takes, decided by code from the
     * approved plan's tools (never a model's estimate), so the wait is
     * understood. Null: no usual length is known. Additive.
     */
    expected: WorkforceLiveExpectedSchema.nullable().optional(),
  })
  .strict();
export type WorkforceLive = z.infer<typeof WorkforceLiveSchema>;
