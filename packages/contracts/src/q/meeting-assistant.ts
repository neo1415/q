import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Q in a meeting (founder direction 2026-09-29). The organiser of a booked
 * call asks Q to join; Q attends under its own name, and afterwards files
 * notes for the organiser: what was discussed, what to know, what to do.
 *
 * Served by the Q API. Only the meeting's organiser may bring Q, see its
 * state or read its notes. The notes are Q's writing, not a record of
 * truth: each flag is something Q heard, to be checked, never verified.
 */
export const Q_MEETING_ASSISTANT_PATH =
  "/v1/q/meetings/:meetingId/assistant" as const;
export const qMeetingAssistantPath = (meetingId: string) =>
  Q_MEETING_ASSISTANT_PATH.replace(":meetingId", encodeURIComponent(meetingId));

export const Q_MEETING_ASSISTANT_STATUSES = [
  "NONE",
  "REQUESTED",
  "SCHEDULED",
  "IN_CALL",
  "COMPOSING",
  "DONE",
  "FAILED",
  "CANCELLED",
  /** A participant declined recording; recorded, never hidden. */
  "DECLINED",
] as const;
export const QMeetingAssistantStatusSchema = z.enum(
  Q_MEETING_ASSISTANT_STATUSES,
);
export type QMeetingAssistantStatus = z.infer<
  typeof QMeetingAssistantStatusSchema
>;

/** What Q thinks the organiser should know from the call. */
export const Q_MEETING_FLAG_KINDS = [
  "COMMITMENT",
  "NUMBER",
  "RISK",
  "QUESTION",
  "SIGNAL",
] as const;

export const QMeetingFlagSchema = z
  .object({
    kind: z.enum(Q_MEETING_FLAG_KINDS),
    text: z.string().trim().min(3).max(300),
    /** Who said it, as the call named them; null when unclear. */
    speaker: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();
export type QMeetingFlag = z.infer<typeof QMeetingFlagSchema>;

export const QMeetingFollowUpSchema = z
  .object({
    text: z.string().trim().min(3).max(300),
    /** Who owns it, as the call named them; null when nobody took it. */
    owner: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();
export type QMeetingFollowUp = z.infer<typeof QMeetingFollowUpSchema>;

export const QMeetingCommitmentSignalSchema = z
  .object({
    party: z.string().max(120),
    amount: z.string().max(60),
    firmness: z.enum(["EXPLORATORY", "SOFT", "FIRM"]),
    quote: z.string().max(300),
  })
  .strict();
export type QMeetingCommitmentSignal = z.infer<
  typeof QMeetingCommitmentSignalSchema
>;

export const QMeetingAssistantDtoSchema = z
  .object({
    meetingId: UuidSchema,
    status: QMeetingAssistantStatusSchema,
    /** ADR 0027: the meeting record, for both sides of the call. */
    attendees: z
      .array(
        z
          .object({
            name: z.string().max(120),
            side: z.enum(["FOUNDER", "INVESTOR"]).nullable(),
          })
          .strict(),
      )
      .max(20),
    agreements: z.array(z.string().max(300)).max(12),
    /** Money mentioned, as signals: never committed capital (§6.6.14). */
    commitments: z.array(QMeetingCommitmentSignalSchema).max(10),
    transcript: z
      .array(
        z
          .object({
            speaker: z.string().max(120).nullable(),
            text: z.string().max(8_000),
          })
          .strict(),
      )
      .max(2_000),
    /** Present once Q has written its notes. */
    summary: z.string().max(4_000).nullable(),
    flags: z.array(QMeetingFlagSchema).max(20),
    followUps: z.array(QMeetingFollowUpSchema).max(20),
    /** Why it did not work, in words for the organiser. */
    failure: z.string().max(200).nullable(),
    /** Who declined recording and when; null unless DECLINED. */
    declined: z
      .object({
        byYou: z.boolean(),
        byName: z.string().max(120).nullable(),
        at: UtcTimestampSchema,
      })
      .strict()
      .nullable(),
    updatedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type QMeetingAssistantDto = z.infer<typeof QMeetingAssistantDtoSchema>;
