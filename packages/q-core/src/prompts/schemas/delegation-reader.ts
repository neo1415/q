import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * DELEGATION_READER — what authority the person has just given Q over
 * their own onboarding (lead, 2026-09-25; ADR 0011): which choices they
 * handed to Q to make, and which of Q's pending recommendations they
 * approved.
 *
 * Both are authority: a value Q records on the person's behalf. They are
 * read here, once per turn and independently of the model that acts, so
 * a question ("what's a typical cheque?") or an unrelated instruction can
 * never become a write because that model decided it was a delegation or
 * an approval, and so the acting model is told plainly, as trusted input,
 * what it has been given. The model reads meaning into this closed shape;
 * code decides what it permits.
 */

export const DELEGATION_READER_SCHEMA_NAME = "DelegationReaderResult";
export const DELEGATION_READER_SCHEMA_VERSION = 1;

export const DelegationReaderVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The journey's steps: key, question and what an answer means. Trusted. */
    steps: z
      .array(
        z.object({
          stepKey: z.string().max(80),
          question: z.string().max(300),
          about: z.string().max(300),
        }),
      )
      .max(60),
    /** Q's recommendations waiting on the person, as Q said them. Trusted. */
    pending: z
      .array(
        z.object({
          stepKey: z.string().max(80),
          recommended: z.string().max(600),
        }),
      )
      .max(12),
    /** What Q said just before; context for what "those" refers to. UNTRUSTED. */
    lastQ: z.string().max(2_000),
    /** The person's latest words. UNTRUSTED. */
    utterance: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type DelegationReaderVariables = z.infer<
  typeof DelegationReaderVariablesSchema
>;

export const DELEGATION_READER_UNTRUSTED = ["lastQ", "utterance"] as const;

const StepRefSchema = z.object({ stepKey: z.string().max(80) }).strict();

export const DelegationReaderResultSchema = z
  .object({
    /** The steps whose choice they handed to Q in these words; none: empty. */
    delegated: z.array(StepRefSchema).max(12).default([]),
    /** The pending recommendations they approved in these words; none: empty. */
    approved: z.array(StepRefSchema).max(12).default([]),
  })
  .strict();
export type DelegationReaderResult = z.infer<
  typeof DelegationReaderResultSchema
>;

/**
 * v2 — the whole of what the person's latest words establish, not only
 * the authority they give (ACC 2026-09-25: an advisory turn recorded
 * "selectively deploying" nobody said, and geography = Kenya from "which
 * sectors are pulling seed money in Kenya"). A STATED write is permitted
 * only for a step their latest words state about themselves; a decline
 * sets an optional step aside; finishing is their decision, read here.
 */
export const DELEGATION_READER_V2_SCHEMA_VERSION = 2;

export const DelegationReaderV2VariablesSchema = z
  .object({
    ...TaskFrameSchema,
    steps: z
      .array(
        z.object({
          stepKey: z.string().max(80),
          question: z.string().max(300),
          about: z.string().max(300),
          required: z.boolean(),
        }),
      )
      .max(60),
    pending: z
      .array(
        z.object({
          stepKey: z.string().max(80),
          recommended: z.string().max(600),
        }),
      )
      .max(12),
    lastQ: z.string().max(2_000),
    utterance: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type DelegationReaderV2Variables = z.infer<
  typeof DelegationReaderV2VariablesSchema
>;

export const DelegationReaderV2ResultSchema = z
  .object({
    /** Steps whose answer their latest words give, change or take back, about themselves. */
    stated: z.array(StepRefSchema).max(40).default([]),
    /** Optional steps they decline to answer. */
    declined: z.array(StepRefSchema).max(40).default([]),
    delegated: z.array(StepRefSchema).max(12).default([]),
    approved: z.array(StepRefSchema).max(12).default([]),
    /** They confirm what is on the record and want to finish now. */
    finishing: z.boolean().default(false),
  })
  .strict();
export type DelegationReaderV2Result = z.infer<
  typeof DelegationReaderV2ResultSchema
>;

/**
 * v3 — what else the latest words ask of the conversation itself (P0-1:
 * the capabilities the legacy conductor read with its own model and, for
 * pause, a word list): a question that needs looking up beyond their own
 * setup, a wish to pause, and a correction of how Q says a name or term.
 */
export const DELEGATION_READER_V3_SCHEMA_VERSION = 3;

export const DelegationReaderV3ResultSchema =
  DelegationReaderV2ResultSchema.extend({
    /**
     * A question of theirs that needs Capital Q's records beyond their own
     * setup or public sources (a company, a market, other investors), in
     * their words; null when there is none.
     */
    lookup: z.string().trim().min(1).max(400).nullable().default(null),
    /** They want to stop for now and come back to it later. */
    pausing: z.boolean().default(false),
    /** How Q should say a name or term, as they corrected it; null when not. */
    pronounce: z
      .object({
        term: z.string().trim().min(1).max(80),
        sayAs: z.string().trim().min(1).max(120),
      })
      .strict()
      .nullable()
      .default(null),
  }).strict();
export type DelegationReaderV3Result = z.infer<
  typeof DelegationReaderV3ResultSchema
>;

/**
 * v4 variables — the step Q was asking when they spoke (founder live test
 * 2026-09-30: "yep" to "Nixo, right?" and "yes" to the review were read as
 * stating nothing, because the reader was not told what the question was).
 * Trusted: code's own record of the step Q asked. Null when Q asked none.
 */
export const DelegationReaderV4VariablesSchema =
  DelegationReaderV2VariablesSchema.extend({
    askedStep: z.string().max(80).nullable(),
  }).strict();
export type DelegationReaderV4Variables = z.infer<
  typeof DelegationReaderV4VariablesSchema
>;
