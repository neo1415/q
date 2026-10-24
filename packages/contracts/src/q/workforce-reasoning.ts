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
] as const;
export type WorkforceLiveStageName = (typeof WORKFORCE_LIVE_STAGES)[number];

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
  })
  .strict();
export type WorkforceLive = z.infer<typeof WorkforceLiveSchema>;
