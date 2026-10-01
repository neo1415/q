import type { TransactionContext } from "@capital-q/database";

/**
 * Persistence ports for meetings, reminders and notifications (BIZ-008).
 * Named operations only. Writes that must commit with a relationship
 * event take the caller's transaction.
 */

export type MeetingStatus = "SCHEDULING" | "SCHEDULED" | "CANCELLED" | "FAILED";

export type MeetingParticipant = {
  readonly participantTenantId: string;
  readonly userId: string;
  readonly role: "ORGANISER" | "ATTENDEE";
  readonly displayName: string;
  readonly email: string;
};

export type MeetingRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly relationshipId: string;
  readonly organiserUserId: string;
  readonly organiserTenantId: string;
  readonly purpose: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly status: MeetingStatus;
  readonly googleEventId: string;
  readonly meetLink: string | null;
  readonly qActionId: string | null;
  readonly idempotencyKey: string;
  readonly prepBriefAt: Date | null;
  readonly participants: readonly MeetingParticipant[];
};

export type NewMeeting = {
  readonly id: string;
  readonly tenantId: string;
  readonly relationshipId: string;
  readonly organiserUserId: string;
  readonly organiserTenantId: string;
  readonly purpose: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly googleEventId: string;
  readonly qActionId: string | null;
  readonly idempotencyKey: string;
  readonly participants: readonly MeetingParticipant[];
};

export type ReminderChannel = "IN_APP" | "EMAIL";
export type ReminderStatus =
  "PENDING" | "DELIVERED" | "DISMISSED" | "CANCELLED";

export type ReminderRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly relationshipId: string | null;
  readonly meetingId: string | null;
  readonly title: string;
  readonly note: string | null;
  readonly dueAt: Date;
  readonly channel: ReminderChannel;
  readonly status: ReminderStatus;
  readonly source: "PERSON" | "MEETING";
  readonly emailSentAt: Date | null;
};

export type NewReminder = {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly relationshipId: string | null;
  readonly title: string;
  readonly note: string | null;
  readonly dueAt: Date;
  readonly channel: ReminderChannel;
  readonly qActionId: string | null;
  readonly idempotencyKey: string;
};

export type NotificationKind =
  | "REMINDER"
  | "MEETING_SCHEDULED"
  | "MEETING_CANCELLED"
  | "MEETING_PREP_READY"
  | "MEETING_NOTES_READY"
  | "Q_SCOUT"
  | "Q_ERRAND"
  | "MEETING_RECORDING_DECLINED"
  | "COMMITMENT_DETECTED"
  | "ACCOUNT_PAUSED"
  // AUTO block (ADR 0030)
  | "Q_WORK"
  | "Q_STAND_IN"
  | "INTEREST_RECEIVED"
  | "CONNECTION_REQUESTED"
  | "Q_MESSAGE"
  | "TIME_PROPOSED";

export type NewNotification = {
  readonly tenantId: string;
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string | null;
  readonly linkPath: string | null;
  readonly reminderId: string | null;
  readonly meetingId: string | null;
  readonly dedupeKey: string;
};

export type NotificationRecord = {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string | null;
  readonly linkPath: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
  /** AUTO: "Needs you" notices may push and email; updates stay in the app. */
  readonly priority?: "NEEDS_YOU" | "UPDATE" | undefined;
};

export type ScheduleStore = {
  /** One row per idempotency key; `created` false returns the existing one. */
  readonly claimMeeting: (input: NewMeeting) => Promise<{
    readonly record: MeetingRecord;
    readonly created: boolean;
  }>;
  readonly findMeeting: (meetingId: string) => Promise<MeetingRecord | null>;
  readonly listMeetingsForRelationship: (
    relationshipId: string,
    limit: number,
  ) => Promise<readonly MeetingRecord[]>;
  readonly listMeetingsForUser: (
    userId: string,
    from: Date,
    limit: number,
  ) => Promise<readonly MeetingRecord[]>;
  readonly markMeetingScheduled: (
    tx: TransactionContext,
    meetingId: string,
    meetLink: string | null,
  ) => Promise<void>;
  readonly markMeetingFailed: (meetingId: string) => Promise<void>;
  /**
   * AUTO (2026-10-02): scheduled meetings still without a Meet link, not
   * yet started, booked within the last day, oldest first.
   */
  readonly meetingsAwaitingLink: (
    now: Date,
    limit: number,
  ) => Promise<
    readonly { readonly meeting: MeetingRecord; readonly createdAt: Date }[]
  >;
  /** Sets the link once; false when it was already set (or not scheduled). */
  readonly setMeetLink: (
    meetingId: string,
    meetLink: string,
  ) => Promise<boolean>;
  /** False when the meeting is not SCHEDULED (nothing moved). */
  readonly moveMeeting: (
    tx: TransactionContext,
    meetingId: string,
    times: { readonly startsAt: Date; readonly endsAt: Date },
  ) => Promise<boolean>;
  /** False when already cancelled (nothing changed). */
  readonly cancelMeeting: (
    tx: TransactionContext,
    meetingId: string,
  ) => Promise<boolean>;
  /** SCHEDULED meetings starting before `until` with no brief yet. */
  readonly meetingsNeedingBrief: (
    now: Date,
    until: Date,
    limit: number,
  ) => Promise<readonly MeetingRecord[]>;
  readonly saveBrief: (
    tx: TransactionContext,
    input: {
      readonly meetingId: string;
      readonly tenantId: string;
      readonly userId: string;
      readonly composerVersion: string;
      readonly body: string;
    },
  ) => Promise<void>;
  readonly findBrief: (
    meetingId: string,
    userId: string,
  ) => Promise<{ readonly body: string; readonly createdAt: Date } | null>;

  readonly createReminder: (input: NewReminder) => Promise<{
    readonly record: ReminderRecord;
    readonly created: boolean;
  }>;
  /** The organiser's T-15 reminder for a meeting; replaced on a move. */
  readonly upsertMeetingReminder: (
    tx: TransactionContext,
    input: {
      readonly meetingId: string;
      readonly tenantId: string;
      readonly ownerUserId: string;
      readonly relationshipId: string;
      readonly title: string;
      readonly dueAt: Date;
    },
  ) => Promise<void>;
  readonly cancelMeetingReminder: (
    tx: TransactionContext,
    meetingId: string,
  ) => Promise<void>;
  readonly listReminders: (
    ownerUserId: string,
    limit: number,
  ) => Promise<readonly ReminderRecord[]>;
  readonly dismissReminder: (
    ownerUserId: string,
    reminderId: string,
  ) => Promise<boolean>;
  /**
   * Pending reminders now due, and delivered EMAIL reminders whose email
   * has not gone yet (within the retry window).
   */
  readonly dueReminders: (
    now: Date,
    limit: number,
  ) => Promise<readonly ReminderRecord[]>;
  readonly markReminderDelivered: (
    tx: TransactionContext,
    reminderId: string,
    at: Date,
  ) => Promise<void>;
  readonly markReminderEmailed: (reminderId: string, at: Date) => Promise<void>;

  /** Idempotent by (userId, dedupeKey). */
  readonly notify: (
    tx: TransactionContext,
    input: NewNotification,
  ) => Promise<void>;
  readonly listNotifications: (
    userId: string,
    limit: number,
  ) => Promise<{
    readonly items: readonly NotificationRecord[];
    readonly unread: number;
  }>;
  readonly markNotificationsRead: (
    userId: string,
    ids: readonly string[],
    at: Date,
  ) => Promise<void>;
};

/** Relationship history through the Network appender. */
export type MeetingActivityWriter = {
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly relationshipId: string;
      readonly eventType:
        | "meeting_scheduled"
        | "meeting_rescheduled"
        | "meeting_cancelled"
        | "meeting_held"
        | "meeting_recording_declined";
      readonly meetingId: string;
      readonly actorUserId: string;
      readonly correlationId: string;
    },
  ) => Promise<void>;
};

/** People on a relationship, read after the party check has passed. */
export type MeetingDirectory = {
  readonly relationshipTenant: (
    relationshipId: string,
  ) => Promise<string | null>;
  /** Active people of the counterparty organisation, with sign-in email. */
  readonly counterpartPeople: (input: {
    readonly relationshipId: string;
    readonly counterpart: "COMPANY" | "INVESTOR_ORGANISATION";
  }) => Promise<
    readonly {
      readonly userId: string;
      readonly tenantId: string;
      readonly name: string;
      readonly email: string;
    }[]
  >;
  readonly person: (
    userId: string,
  ) => Promise<{ readonly name: string; readonly email: string } | null>;
  /** The display name of the side the organiser is not on. */
  readonly counterpartName: (input: {
    readonly relationshipId: string;
    readonly organiserTenantId: string;
  }) => Promise<string | null>;
};
