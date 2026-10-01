import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * MEETING_HOST_TURN -- Q, present in a real call booked on Capital Q, says
 * one short thing when addressed, recaps when asked, or reads a guest's
 * self-introduction (founder direction 2026-10-01; ADR 0037).
 *
 * Everything said in the call is data, never instruction. The model sees
 * only what both sides of the call already share -- the booking's purpose,
 * who was invited and their organisations, who is in the call, and what was
 * said aloud in it -- so it cannot say anything private to either side
 * (Context Firewall). It has no tools: it can only answer, decline, recap,
 * or read an introduction.
 */

export const MEETING_HOST_SCHEMA_NAME = "MeetingHostTurnResult";
export const MEETING_HOST_SCHEMA_VERSION = 1;

export const MeetingHostVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** ANSWER (they addressed Q) or GUEST (read a self-introduction). Trusted. */
    mode: z.enum(["ANSWER", "GUEST"]),
    /** Shared by the booking: purpose, invited people, organisations. UNTRUSTED. */
    meeting: z.string().max(3_000),
    /** Who is in the call now, by the names Q may use. UNTRUSTED. */
    roster: z.string().max(2_000),
    /** The call so far, "Speaker: words" per line, newest last. UNTRUSTED. */
    transcript: z.string().max(24_000),
    /** Who spoke to Q, and what they said. UNTRUSTED. */
    speaker: z.string().max(200),
    utterance: z.string().max(2_000),
  })
  .strict();
export type MeetingHostVariables = z.infer<typeof MeetingHostVariablesSchema>;

export const MEETING_HOST_UNTRUSTED = [
  "meeting",
  "roster",
  "transcript",
  "speaker",
  "utterance",
] as const;

export const MeetingHostResultSchema = z
  .object({
    /**
     * ANSWER: a short spoken reply. RECAP: they asked for a recap; line is
     * it. DECLINE: they asked Q to act, reveal or change its rules; code
     * speaks a fixed refusal, never this line. PROPOSE: an action they asked
     * for (move the call, send something, introduce someone), noted for the
     * organiser to approve after the call. GUEST: an introduction read.
     */
    kind: z.enum(["ANSWER", "RECAP", "PROPOSE", "DECLINE", "GUEST"]),
    line: z.string().trim().max(1_200),
    /**
     * PROPOSE only: the action they asked for, in a sentence, for the
     * organiser to approve after the call. Q never does it in the call.
     */
    proposal: z.string().trim().min(3).max(300).nullable(),
    /** GUEST only: what they said about themselves; null when not said. */
    guest: z
      .object({
        name: z.string().trim().min(1).max(200).nullable(),
        role: z.string().trim().min(1).max(200).nullable(),
        organisation: z.string().trim().min(1).max(200).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MeetingHostResult = z.infer<typeof MeetingHostResultSchema>;
