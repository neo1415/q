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

// v2 (ADR 0039, live 2026-10-02): asked to leave, Q stays and records the
// ask (LEAVE_REQUEST); asked to be quiet, Q stops speaking unprompted
// (QUIET). Both read by meaning, in any language; code says the words.
export const MEETING_HOST_SCHEMA_VERSION_2 = 2;
export const MEETING_HOST_KINDS = [
  "ANSWER",
  "RECAP",
  "PROPOSE",
  "DECLINE",
  "GUEST",
  "QUIET",
  "LEAVE_REQUEST",
] as const;
export const MeetingHostResultV2Schema = MeetingHostResultSchema.extend({
  kind: z.enum(MEETING_HOST_KINDS),
}).strict();
export type MeetingHostResultV2 = z.infer<typeof MeetingHostResultV2Schema>;

// v3 (founder 2026-10-08): what is shown in the call -- shared screens and,
// when camera vision is on, cameras -- as Q has seen it, so "Q, what do you
// make of this slide?" is answered from it. Only what everyone in the call
// can see; never Q's private take on it.
export const MeetingHostVariablesV3Schema = MeetingHostVariablesSchema.extend({
  /** What is shown in the call now, as Q saw it; "" when nothing. UNTRUSTED. */
  seen: z.string().max(4_000),
}).strict();
export type MeetingHostVariablesV3 = z.infer<
  typeof MeetingHostVariablesV3Schema
>;
export const MEETING_HOST_UNTRUSTED_V3 = [
  ...MEETING_HOST_UNTRUSTED,
  "seen",
] as const;
