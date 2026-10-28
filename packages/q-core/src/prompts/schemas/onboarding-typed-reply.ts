import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * ONBOARDING_TYPED_REPLY (owner 2026-10-28): typed onboarding is the same
 * conversation as voice (DECISIONS 39). Q writes its next line from the
 * setup's checklist and the thread so far; it records nothing. What the
 * person said is read by meaning from the whole thread in the background
 * (ONBOARDING_TRANSCRIPT_READER) and saved through the checked path.
 */
export const ONBOARDING_TYPED_REPLY_SCHEMA_NAME = "OnboardingTypedReplyResult";
export const ONBOARDING_TYPED_REPLY_SCHEMA_VERSION = 1;

export const OnboardingTypedReplyVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** "investor" or "founder". Trusted. */
    journey: z.enum(["investor", "founder"]),
    /** The checklist and what is saved, from Capital Q's records. Trusted. */
    checklist: z.string().max(12_000),
    /** The conversation so far, oldest first, "PERSON:"/"Q:" lines. UNTRUSTED. */
    transcript: z.string().trim().min(1).max(30_000),
  })
  .strict();
export type OnboardingTypedReplyVariables = z.infer<
  typeof OnboardingTypedReplyVariablesSchema
>;

export const ONBOARDING_TYPED_REPLY_UNTRUSTED = ["transcript"] as const;

export const OnboardingTypedReplyResultSchema = z
  .object({
    /** Q's next line: a brief acknowledgement, then one question. */
    reply: z.string().min(1).max(900),
    /** The checklist step the reply's question asks, or null. */
    asking: z.string().max(80).nullable().default(null),
    /** They asked what Q has so far: code reads it back from the record. */
    readBack: z.boolean().default(false),
  })
  .strict();
export type OnboardingTypedReplyResult = z.infer<
  typeof OnboardingTypedReplyResultSchema
>;
