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
