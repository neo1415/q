import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * Q's delegated work (AUTO, ADR 0030): the words Q writes inside a
 * delegation the person approved. Models write words; code decides what
 * happens. Every output is schema-checked; nothing here is authority.
 *
 * Trust: the principal's own approved grant (brief, topics, questions,
 * mandate) is trusted; everything the other side wrote, and every company's
 * material, is UNTRUSTED data, never instructions.
 */

// ---------------------------------------------------------------------------
// WORK_SHORTLIST: which companies in the investor's feed fit closest
// ---------------------------------------------------------------------------

export const WORK_SHORTLIST_SCHEMA_NAME = "WorkShortlistResult";
export const WORK_SHORTLIST_SCHEMA_VERSION = 1;

export const WorkShortlistVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().max(120),
    /** The investor's own declared mandate, as Capital Q holds it. Trusted. */
    mandate: z.string().max(3_000),
    maxCompanies: z.number().int().min(1).max(10),
    /** Candidates and what the investor may see of each. UNTRUSTED. */
    candidates: z.string().max(60_000),
  })
  .strict();
export type WorkShortlistVariables = z.infer<
  typeof WorkShortlistVariablesSchema
>;
export const WORK_SHORTLIST_UNTRUSTED = ["candidates"] as const;

export const WorkShortlistResultSchema = z
  .object({
    picks: z
      .array(
        z
          .object({
            // Checked in code against the candidates given; never trusted.
            companyId: z.string().min(30).max(40),
            reasons: z
              .array(
                z
                  .object({
                    reason: z.string().trim().min(3).max(200),
                    /** Copied word for word from that company's material. */
                    quote: z.string().trim().min(8).max(300),
                  })
                  .strict(),
              )
              .min(1)
              .max(3),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type WorkShortlistResult = z.infer<typeof WorkShortlistResultSchema>;

// ---------------------------------------------------------------------------
// WORK_CONVERSE: Q chatting with a founder for the investor
// ---------------------------------------------------------------------------

export const WORK_CONVERSE_SCHEMA_NAME = "WorkConverseResult";
export const WORK_CONVERSE_SCHEMA_VERSION = 1;

export const WorkConverseVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().max(120),
    counterpartName: z.string().max(200),
    /** What the investor approved Q may say; "" when nothing. Trusted. */
    brief: z.string().max(2_000),
    /** Topics still to learn, one per line, exactly as approved. Trusted. */
    topicsOpen: z.string().max(1_400),
    /** The other side is a Q (theirs), not a person. Trusted (envelope). */
    otherSideIsQ: z.boolean(),
    thread: z.string().max(12_000),
  })
  .strict();
export type WorkConverseVariables = z.infer<typeof WorkConverseVariablesSchema>;
export const WORK_CONVERSE_UNTRUSTED = ["counterpartName", "thread"] as const;

export const WorkConverseResultSchema = z
  .object({
    reply: z.string().trim().min(1).max(1_200).nullable(),
    learned: z
      .array(
        z
          .object({
            topic: z.string().trim().min(3).max(200),
            words: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .max(6),
    forPerson: z.array(z.string().trim().min(3).max(300)).max(5),
    ready: z.boolean(),
  })
  .strict();
export type WorkConverseResult = z.infer<typeof WorkConverseResultSchema>;

// ---------------------------------------------------------------------------
// WORK_INTERVIEW_TURN: has the founder answered; one follow-up at most
// ---------------------------------------------------------------------------

export const WORK_INTERVIEW_TURN_SCHEMA_NAME = "WorkInterviewTurnResult";
export const WORK_INTERVIEW_TURN_SCHEMA_VERSION = 1;

export const WorkInterviewTurnVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().max(120),
    counterpartName: z.string().max(200),
    /** The approved question. Trusted. */
    question: z.string().max(400),
    answerSoFar: z.string().max(6_000),
    followUpAllowed: z.boolean(),
  })
  .strict();
export type WorkInterviewTurnVariables = z.infer<
  typeof WorkInterviewTurnVariablesSchema
>;
export const WORK_INTERVIEW_TURN_UNTRUSTED = [
  "counterpartName",
  "answerSoFar",
] as const;

export const WorkInterviewTurnResultSchema = z
  .object({
    answered: z.boolean(),
    answer: z.string().trim().min(1).max(1_500).nullable(),
    followUp: z.string().trim().min(5).max(400).nullable(),
  })
  .strict();
export type WorkInterviewTurnResult = z.infer<
  typeof WorkInterviewTurnResultSchema
>;

// ---------------------------------------------------------------------------
// WORK_INTERVIEW_REPORT: the first-stage report for the investor
// ---------------------------------------------------------------------------

export const WORK_INTERVIEW_REPORT_SCHEMA_NAME = "WorkInterviewReportResult";
export const WORK_INTERVIEW_REPORT_SCHEMA_VERSION = 1;

export const WorkInterviewReportVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().max(120),
    counterpartName: z.string().max(200),
    mandate: z.string().max(3_000),
    /** Why Q picked them, with quotes. Q-written earlier, checked. */
    reasons: z.string().max(2_000),
    /** Question → their answer, in order. UNTRUSTED (their words). */
    interview: z.string().max(12_000),
    /** What they said on the investor's topics. UNTRUSTED. */
    learned: z.string().max(3_000),
    transcript: z.string().max(12_000),
  })
  .strict();
export type WorkInterviewReportVariables = z.infer<
  typeof WorkInterviewReportVariablesSchema
>;
export const WORK_INTERVIEW_REPORT_UNTRUSTED = [
  "counterpartName",
  "interview",
  "learned",
  "transcript",
] as const;

const ReportPointSchema = z
  .object({
    point: z.string().trim().min(3).max(300),
    /** CLAIM: they said it; INFERENCE: Q's reading. Never "verified". */
    basis: z.enum(["CLAIM", "INFERENCE"]),
  })
  .strict();

export const WorkInterviewReportResultSchema = z
  .object({
    headline: z.string().trim().min(10).max(200),
    howItWent: z.string().trim().min(10).max(800),
    strengths: z.array(ReportPointSchema).max(5),
    concerns: z.array(ReportPointSchema).max(5),
    openQuestions: z.array(z.string().trim().min(5).max(300)).max(5),
    recommendation: z.enum(["PROCEED", "MAYBE", "PASS"]),
    why: z.string().trim().min(10).max(500),
  })
  .strict();
export type WorkInterviewReportResult = z.infer<
  typeof WorkInterviewReportResultSchema
>;

// ---------------------------------------------------------------------------
// WORK_STAND_IN_REPLY: Q answering investors while the founder is away
// ---------------------------------------------------------------------------

export const WORK_STAND_IN_REPLY_SCHEMA_NAME = "WorkStandInReplyResult";
export const WORK_STAND_IN_REPLY_SCHEMA_VERSION = 1;

export const WorkStandInReplyVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().max(120),
    counterpartName: z.string().max(200),
    /** The founder's approved brief: everything Q may say. Trusted. */
    brief: z.string().max(3_000),
    otherSideIsQ: z.boolean(),
    thread: z.string().max(12_000),
  })
  .strict();
export type WorkStandInReplyVariables = z.infer<
  typeof WorkStandInReplyVariablesSchema
>;
export const WORK_STAND_IN_REPLY_UNTRUSTED = [
  "counterpartName",
  "thread",
] as const;

export const WorkStandInReplyResultSchema = z
  .object({
    reply: z.string().trim().min(1).max(1_200).nullable(),
    /** The reply only says the founder will answer when back. */
    deferred: z.boolean(),
    forPerson: z.array(z.string().trim().min(3).max(300)).max(5),
  })
  .strict();
export type WorkStandInReplyResult = z.infer<
  typeof WorkStandInReplyResultSchema
>;
