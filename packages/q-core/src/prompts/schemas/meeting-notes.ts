import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * MEETING_NOTES — what a meeting Q attended said, for its organiser
 * (founder direction 2026-09-29).
 *
 * Run once, after the call, over the call's own captions. What comes back
 * is Q's writing: a summary, things worth knowing (each a commitment, a
 * number, a risk, an open question or a signal, with who said it), and
 * follow-ups. Heard, never verified: a number said in a call is a claim.
 */

export const MEETING_NOTES_SCHEMA_NAME = "MeetingNotesResult";
export const MEETING_NOTES_SCHEMA_VERSION = 1;

export const MeetingNotesVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** Why the meeting was booked, as the organiser wrote it. UNTRUSTED. */
    purpose: z.string().max(500),
    /** The organiser's name, so "you" can be told apart. UNTRUSTED. */
    organiserName: z.string().max(120),
    /** The call's captions, "Speaker: words" per line. UNTRUSTED. */
    transcript: z.string().max(60_000),
  })
  .strict();
export type MeetingNotesVariables = z.infer<typeof MeetingNotesVariablesSchema>;

export const MEETING_NOTES_UNTRUSTED = [
  "purpose",
  "organiserName",
  "transcript",
] as const;

export const MeetingNotesResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_500),
    flags: z
      .array(
        z
          .object({
            kind: z.enum([
              "COMMITMENT",
              "NUMBER",
              "RISK",
              "QUESTION",
              "SIGNAL",
            ]),
            text: z.string().trim().min(3).max(300),
            speaker: z.string().trim().min(1).max(120).nullable(),
          })
          .strict(),
      )
      .max(12),
    followUps: z
      .array(
        z
          .object({
            text: z.string().trim().min(3).max(300),
            owner: z.string().trim().min(1).max(120).nullable(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type MeetingNotesResult = z.infer<typeof MeetingNotesResultSchema>;

/**
 * v2 (ADR 0027): the structured meeting record -- who attended, what was
 * agreed, and money mentioned as commitment signals with how firm each
 * was said to be. A signal is never committed capital (spec §6.6.14).
 */
export const MEETING_NOTES_V2_SCHEMA_VERSION = 2;

export const MeetingNotesV2ResultSchema = MeetingNotesResultSchema.extend({
  attendees: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(120),
          /** Their side as the call made it clear; null when unclear. */
          side: z.enum(["FOUNDER", "INVESTOR"]).nullable(),
        })
        .strict(),
    )
    .max(20),
  agreements: z.array(z.string().trim().min(3).max(300)).max(12),
  commitments: z
    .array(
      z
        .object({
          party: z.string().trim().min(1).max(120),
          /** The amount exactly as said ("$500K", "two million naira"). */
          amount: z.string().trim().min(1).max(60),
          firmness: z.enum(["EXPLORATORY", "SOFT", "FIRM"]),
          quote: z.string().trim().min(3).max(300),
        })
        .strict(),
    )
    .max(10),
}).strict();
export type MeetingNotesV2Result = z.infer<typeof MeetingNotesV2ResultSchema>;
