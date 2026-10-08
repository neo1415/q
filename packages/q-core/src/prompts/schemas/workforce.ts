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
    cannot: z.array(z.string().trim().min(1).max(200)).max(5),
  })
  .strict();
export type JobPlanResult = z.infer<typeof JobPlanResultSchema>;
