import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * CALL_PREP -- getting someone ready for a call or meeting with one named
 * counterpart, in the answer itself (owner 2026-10-23, live
 * founder.maji-loop: "help me prepare for a first call with Savanna Seed
 * Partners" was planned as a team job instead of prepared). Code gathers
 * only what this person may see of the counterpart (their declared,
 * network-visible profile and the relationship's own record from this
 * side) and their own record; nothing of the counterpart's private
 * mandate or notes ever reaches this prompt.
 */

export const CALL_PREP_SCHEMA_NAME = "CallPrepResult";
export const CALL_PREP_SCHEMA_VERSION = 1;

export const CallPrepVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** FOUNDER or INVESTOR: who is getting ready. */
    viewerRole: z.enum(["FOUNDER", "INVESTOR"]),
    /** The counterpart's name, as Capital Q holds it. UNTRUSTED. */
    counterpartName: z.string().trim().min(1).max(200),
    /** What this person may see of them: declared profile. UNTRUSTED. */
    counterpartProfile: z.string().max(6_000),
    /** The relationship so far from this side: state, messages, calls, meetings. UNTRUSTED. */
    soFar: z.string().max(8_000),
    /** Their own record (company profile, pitch, deck, known facts). UNTRUSTED. */
    ownRecord: z.string().max(12_000),
    /** What they asked, in their words. UNTRUSTED. */
    said: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type CallPrepVariables = z.infer<typeof CallPrepVariablesSchema>;

export const CALL_PREP_UNTRUSTED = [
  "counterpartName",
  "counterpartProfile",
  "soFar",
  "ownRecord",
  "said",
] as const;

export const CallPrepResultSchema = z
  .object({
    /** Who they are, from what was given; says plainly what is not known. */
    whoTheyAre: z.string().trim().min(1).max(700),
    /** The relationship so far, or that this is the first contact. */
    soFar: z.string().trim().min(1).max(600),
    /** The likely questions, each with an answer grounded in their record. */
    questions: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(300),
            answer: z.string().trim().min(1).max(600),
          })
          .strict(),
      )
      .min(3)
      .max(5),
    /** The weak spots they will probe, each with how to handle it. */
    weakSpots: z
      .array(
        z
          .object({
            spot: z.string().trim().min(1).max(300),
            handle: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    /** The one-line ask to close on. */
    ask: z.string().trim().min(1).max(300),
  })
  .strict();
export type CallPrepResult = z.infer<typeof CallPrepResultSchema>;
