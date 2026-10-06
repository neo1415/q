import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * MEETING_SCREEN_NOTE -- P5 (founder brief 2026-10-06): Q looks at one
 * frame of a screen shared in a call it attends and writes a short private
 * note for the person whose assistant it is. The frame rides as an image
 * on the message; the note goes to that person's private notes only --
 * never the transcript, the recap, or the other side. Webcams are never
 * sent here (code filters them before the model).
 */

export const MEETING_SCREEN_NOTE_SCHEMA_NAME = "MeetingScreenNoteResult";
export const MEETING_SCREEN_NOTE_SCHEMA_VERSION = 1;

export const MeetingScreenNoteVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** Shared by the booking: purpose, who was invited. UNTRUSTED. */
    meeting: z.string().max(3_000),
    /** Who shared the screen, by the call's name. UNTRUSTED. */
    sharedBy: z.string().max(200),
    /** What was said aloud just before the look. UNTRUSTED. */
    recentWords: z.string().max(4_000),
    /** Q's own earlier notes on this call's screens, newest last. UNTRUSTED. */
    earlierNotes: z.string().max(4_000),
  })
  .strict();
export type MeetingScreenNoteVariables = z.infer<
  typeof MeetingScreenNoteVariablesSchema
>;

export const MEETING_SCREEN_NOTE_UNTRUSTED = [
  "meeting",
  "sharedBy",
  "recentWords",
  "earlierNotes",
] as const;

export const MeetingScreenNoteResultSchema = z
  .object({
    /** Whether the frame shows anything worth a note (a slide, a model, a page). */
    worthNoting: z.boolean(),
    /** What the screen shows, factually: title, key numbers as written. */
    shows: z.string().trim().max(300),
    /** Q's private take for the owner: a gap, a claim to check, a question. */
    take: z.string().trim().max(300),
  })
  .strict();
export type MeetingScreenNoteResult = z.infer<
  typeof MeetingScreenNoteResultSchema
>;
