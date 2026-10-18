import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { NamedPictureSchema } from "../common/named-picture.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Meetings, reminders and notifications HTTP contracts (BIZ-008; R11, R14).
 *
 *   GET  /v1/relationships/:relationshipId/meetings        the relationship's calls
 *   POST /v1/relationships/:relationshipId/meeting-slots   three free slots
 *   POST /v1/relationships/:relationshipId/meetings        invite (idempotent)
 *   POST /v1/relationships/:relationshipId/meetings/join   Q joins a running Meet (idempotent)
 *   POST /v1/meetings/:meetingId/cancel                    organiser only
 *   GET  /v1/meetings/:meetingId/brief                     own prep brief
 *   GET  /v1/reminders                                     own reminders
 *   POST /v1/reminders                                     own reminder (idempotent)
 *   POST /v1/reminders/:reminderId/dismiss
 *   GET  /v1/notifications                                 own notices
 *   POST /v1/notifications/read                            mark read
 *
 * Nothing here carries a provider id, token or credential. The Meet link
 * is shown only to the meeting's own participants.
 */

export const RELATIONSHIP_MEETINGS_PATH =
  "/v1/relationships/:relationshipId/meetings" as const;
/** meet-47: Q asked to join a Google Meet already running, on demand. */
export const RELATIONSHIP_MEETING_JOIN_PATH =
  "/v1/relationships/:relationshipId/meetings/join" as const;
export const RELATIONSHIP_MEETING_SLOTS_PATH =
  "/v1/relationships/:relationshipId/meeting-slots" as const;
export const MEETING_CANCEL_PATH = "/v1/meetings/:meetingId/cancel" as const;
export const MEETING_BRIEF_PATH = "/v1/meetings/:meetingId/brief" as const;
export const REMINDERS_PATH = "/v1/reminders" as const;
export const REMINDER_DISMISS_PATH =
  "/v1/reminders/:reminderId/dismiss" as const;
export const NOTIFICATIONS_PATH = "/v1/notifications" as const;
export const NOTIFICATIONS_READ_PATH = "/v1/notifications/read" as const;

/** An IANA time zone name, e.g. Europe/London. */
export const TimeZoneSchema = z
  .string()
  .regex(/^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/, "an IANA time zone")
  .max(64);

export const MeetingDurationMinutesSchema = z.number().int().min(15).max(180);
export const MeetingPurposeSchema = z.string().trim().min(1).max(500);

export const MeetingStatusSchema = z.enum([
  "SCHEDULING",
  "SCHEDULED",
  "CANCELLED",
  "FAILED",
]);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

export const MeetingDtoSchema = z
  .object({
    id: UuidSchema,
    relationshipId: UuidSchema,
    purpose: z.string(),
    startsAt: UtcTimestampSchema,
    endsAt: UtcTimestampSchema,
    timeZone: TimeZoneSchema,
    status: MeetingStatusSchema,
    /** The caller organised it (only the organiser may move or cancel). */
    organisedByYou: z.boolean(),
    organiserName: z.string(),
    meetLink: z.string().url().nullable(),
    attendees: z.array(z.string()).max(12),
    hasBrief: z.boolean(),
  })
  .strict();
export type MeetingDto = z.infer<typeof MeetingDtoSchema>;

export const MeetingListSchema = z
  .object({ items: z.array(MeetingDtoSchema).max(50) })
  .strict();
export type MeetingList = z.infer<typeof MeetingListSchema>;

export const MeetingSlotsRequestSchema = z
  .object({
    /** Search window start; defaults to now. */
    from: UtcTimestampSchema.optional(),
    /** Search window end; defaults to seven days after `from`. */
    to: UtcTimestampSchema.optional(),
    durationMinutes: MeetingDurationMinutesSchema.default(30),
    timeZone: TimeZoneSchema.optional(),
  })
  .strict();
export type MeetingSlotsRequest = z.input<typeof MeetingSlotsRequestSchema>;

export const MeetingSlotSchema = z
  .object({ startsAt: UtcTimestampSchema, endsAt: UtcTimestampSchema })
  .strict();
export type MeetingSlot = z.infer<typeof MeetingSlotSchema>;

export const MeetingSlotsResponseSchema = z
  .object({
    timeZone: TimeZoneSchema,
    slots: z.array(MeetingSlotSchema).max(3),
  })
  .strict();
export type MeetingSlotsResponse = z.infer<typeof MeetingSlotsResponseSchema>;

export const ScheduleMeetingRequestSchema = z
  .object({
    purpose: MeetingPurposeSchema,
    startsAt: UtcTimestampSchema,
    durationMinutes: MeetingDurationMinutesSchema,
    timeZone: TimeZoneSchema.optional(),
  })
  .strict();
export type ScheduleMeetingRequest = z.infer<
  typeof ScheduleMeetingRequestSchema
>;

// ---------------------------------------------------------------------------
// Meeting time proposals (D, 2026-10-11). A time is a proposal until the
// investor (or an authorised party for them) explicitly accepts it; nothing
// is booked, and nothing is announced as confirmed, before that.
//
//   POST /v1/relationships/:relationshipId/meeting-proposals                           propose (founder)
//   POST /v1/relationships/:relationshipId/meeting-proposals/review                    read (a read by POST)
//   POST /v1/relationships/:relationshipId/meeting-proposals/:proposalId/accept        accept
//   POST /v1/relationships/:relationshipId/meeting-proposals/:proposalId/decline       decline
//   POST /v1/relationships/:relationshipId/meeting-proposals/:proposalId/counter       counter-propose (investor)
// ---------------------------------------------------------------------------

export const RELATIONSHIP_MEETING_PROPOSALS_PATH =
  "/v1/relationships/:relationshipId/meeting-proposals" as const;
export const RELATIONSHIP_MEETING_PROPOSALS_REVIEW_PATH =
  "/v1/relationships/:relationshipId/meeting-proposals/review" as const;
export const MEETING_PROPOSAL_ACCEPT_PATH =
  "/v1/relationships/:relationshipId/meeting-proposals/:proposalId/accept" as const;
export const MEETING_PROPOSAL_DECLINE_PATH =
  "/v1/relationships/:relationshipId/meeting-proposals/:proposalId/decline" as const;
export const MEETING_PROPOSAL_COUNTER_PATH =
  "/v1/relationships/:relationshipId/meeting-proposals/:proposalId/counter" as const;

export const MeetingTimeOptionSchema = z
  .object({
    startsAt: UtcTimestampSchema,
    endsAt: UtcTimestampSchema,
    timeZone: TimeZoneSchema,
  })
  .strict();
export type MeetingTimeOption = z.infer<typeof MeetingTimeOptionSchema>;

export const MeetingTimeOptionsSchema = z
  .array(MeetingTimeOptionSchema)
  .min(1)
  .max(5);

export const ProposeMeetingTimeRequestSchema = z
  .object({
    purpose: MeetingPurposeSchema,
    options: MeetingTimeOptionsSchema,
    /** A move of a meeting that exists: it stays valid until this is CONFIRMED. */
    rescheduleOfMeetingId: UuidSchema.nullable().optional(),
  })
  .strict();
export type ProposeMeetingTimeRequest = z.infer<
  typeof ProposeMeetingTimeRequestSchema
>;

export const AcceptMeetingTimeRequestSchema = z
  .object({ optionIndex: z.number().int().min(0).max(4) })
  .strict();
export type AcceptMeetingTimeRequest = z.infer<
  typeof AcceptMeetingTimeRequestSchema
>;

export const CounterMeetingTimeRequestSchema = z
  .object({ options: MeetingTimeOptionsSchema })
  .strict();
export type CounterMeetingTimeRequest = z.infer<
  typeof CounterMeetingTimeRequestSchema
>;

export const MeetingTimeProposalStateSchema = z.enum([
  "PROPOSED",
  "INVESTOR_REVIEW",
  "CONFIRMED",
  "DECLINED",
  "COUNTERPROPOSED",
]);

export const MeetingTimeProposalDtoSchema = z
  .object({
    id: UuidSchema,
    relationshipId: UuidSchema,
    purpose: MeetingPurposeSchema,
    state: MeetingTimeProposalStateSchema,
    options: MeetingTimeOptionsSchema,
    counterOptions: MeetingTimeOptionsSchema.nullable(),
    /** True only when an authorised party's acceptance is recorded. */
    confirmed: z.boolean(),
    acceptedOption: z.number().int().min(0).max(4).nullable(),
    acceptedAt: UtcTimestampSchema.nullable(),
    /** The booked call, once the booking followed the acceptance. */
    meetingId: UuidSchema.nullable(),
    revision: z.number().int().min(1).max(20),
  })
  .strict();
export type MeetingTimeProposalDto = z.infer<
  typeof MeetingTimeProposalDtoSchema
>;

export const MeetingTimeProposalListSchema = z
  .object({ proposals: z.array(MeetingTimeProposalDtoSchema).max(50) })
  .strict();
export type MeetingTimeProposalList = z.infer<
  typeof MeetingTimeProposalListSchema
>;

const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/**
 * A Google Meet link in its one canonical form
 * (https://meet.google.com/abc-defg-hij), or null. Only meet.google.com is
 * accepted: Q joins Google Meet calls and nothing else, and a link is never
 * a way to send Q's bot to an arbitrary host.
 */
export function googleMeetLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return null;
  let url: URL;
  try {
    url = new URL(
      /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "meet.google.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  const code = url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return MEET_CODE.test(code) ? `https://meet.google.com/${code}` : null;
}

export const JoinMeetingRequestSchema = z
  .object({
    meetLink: z
      .string()
      .max(300)
      .refine((value) => googleMeetLink(value) !== null, {
        message: "a Google Meet link (https://meet.google.com/...)",
      }),
    purpose: MeetingPurposeSchema.optional(),
  })
  .strict();
export type JoinMeetingRequest = z.infer<typeof JoinMeetingRequestSchema>;

export const MeetingBriefDtoSchema = z
  .object({
    meetingId: UuidSchema,
    body: z.string(),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type MeetingBriefDto = z.infer<typeof MeetingBriefDtoSchema>;

export const ReminderChannelSchema = z.enum(["IN_APP", "EMAIL"]);
export type ReminderChannel = z.infer<typeof ReminderChannelSchema>;

export const ReminderStatusSchema = z.enum([
  "PENDING",
  "DELIVERED",
  "DISMISSED",
  "CANCELLED",
]);

export const ReminderDtoSchema = z
  .object({
    id: UuidSchema,
    relationshipId: UuidSchema.nullable(),
    meetingId: UuidSchema.nullable(),
    title: z.string(),
    note: z.string().nullable(),
    dueAt: UtcTimestampSchema,
    channel: ReminderChannelSchema,
    status: ReminderStatusSchema,
  })
  .strict();
export type ReminderDto = z.infer<typeof ReminderDtoSchema>;

export const ReminderListSchema = z
  .object({ items: z.array(ReminderDtoSchema).max(100) })
  .strict();
export type ReminderList = z.infer<typeof ReminderListSchema>;

export const ReminderTitleSchema = z.string().trim().min(1).max(200);
export const ReminderNoteSchema = z.string().trim().max(1000);

export const CreateReminderRequestSchema = z
  .object({
    title: ReminderTitleSchema,
    dueAt: UtcTimestampSchema,
    note: ReminderNoteSchema.optional(),
    relationshipId: UuidSchema.optional(),
    channel: ReminderChannelSchema.default("IN_APP"),
  })
  .strict();
export type CreateReminderRequest = z.input<typeof CreateReminderRequestSchema>;

export const NotificationKindSchema = z.enum([
  "REMINDER",
  "MEETING_SCHEDULED",
  "MEETING_CANCELLED",
  "MEETING_PREP_READY",
  "MEETING_NOTES_READY",
  "Q_SCOUT",
  "Q_ERRAND",
  "MEETING_RECORDING_DECLINED",
  "COMMITMENT_DETECTED",
  "ACCOUNT_PAUSED",
  // AUTO block (ADR 0030)
  "Q_WORK",
  "Q_STAND_IN",
  // AUTO (2026-10-02): what the other side hears about.
  "INTEREST_RECEIVED",
  "CONNECTION_REQUESTED",
  "Q_MESSAGE",
  "TIME_PROPOSED",
  // Written by the review and verification paths since 20261115010000; the
  // contract lagged the table, so one such row failed the whole list.
  "HUMAN_REVIEW",
  "VERIFICATION_DECIDED",
  "VERIFICATION_REQUESTED",
  // 2026-10-02: a pass, pause or resume, told to the other side.
  "RELATIONSHIP_OUTCOME",
  "DILIGENCE",
  // Inbound email (20261130090000); 20261201090000 keeps it in the check.
  "EMAIL_RECEIVED",
  // QA run 8a1d57b9: a new chat message, one notice per conversation.
  "CHAT_MESSAGE",
  // 2026-10-04: a commitment moved a step (amount, sent, received).
  "COMMITMENT",
  // P14 (20261209132000): a new company matches a saved startup alert.
  "STARTUP_ALERT",
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationDtoSchema = z
  .object({
    id: UuidSchema,
    kind: NotificationKindSchema,
    title: z.string(),
    body: z.string().nullable(),
    linkPath: z.string().nullable(),
    read: z.boolean(),
    createdAt: UtcTimestampSchema,
    /** AUTO: what needs the person vs an update. */
    priority: z.enum(["NEEDS_YOU", "UPDATE"]).default("UPDATE"),
    /**
     * The organisation the notice is about (its link names their side of
     * the person's own relationship), with its logo signed for this reader
     * under the name's scope. Absent: the notice names no one.
     */
    named: NamedPictureSchema.nullable().optional(),
  })
  .strict();
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

export const NotificationListSchema = z
  .object({
    items: z.array(NotificationDtoSchema).max(50),
    unread: z.number().int().min(0),
    /** P3: the next (older) page's cursor; absent at the end. */
    nextBefore: z.string().max(200).optional(),
  })
  .strict();
export type NotificationList = z.infer<typeof NotificationListSchema>;

export const MarkNotificationsReadRequestSchema = z
  .object({ ids: z.array(UuidSchema).min(1).max(50) })
  .strict();
export type MarkNotificationsReadRequest = z.infer<
  typeof MarkNotificationsReadRequestSchema
>;
