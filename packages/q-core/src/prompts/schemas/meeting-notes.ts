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
