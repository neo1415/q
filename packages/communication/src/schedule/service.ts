import { randomUUID } from "node:crypto";

import type { TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { ChatPartyResolver } from "../service.js";
import { composePrepBrief, PREP_BRIEF_COMPOSER_VERSION } from "./brief.js";
import { isKnownTimeZone, proposeSlots, type Interval } from "./slots.js";
import type {
  MeetingActivityWriter,
  MeetingDirectory,
  MeetingParticipant,
  MeetingRecord,
  NotificationRecord,
  ReminderChannel,
  ReminderRecord,
  ScheduleStore,
} from "./store.js";

/**
 * Meetings, reminders and notifications (BIZ-008; R11, R14, R34).
 *
 *   slots       three free times in the organiser's working hours, from
 *               their own calendar's busy times ONLY: the other side's
 *               calendar is never read (no consent to share busy times
 *               exists yet; coordinator decision, default off)
 *   schedule    Google Calendar event with a Meet link, invites sent
 *               (sendUpdates=all) to the counterparty's own people only;
 *               `meeting_scheduled` commits with SCHEDULED; the organiser
 *               gets a T-15 email reminder
 *   reschedule  organiser only; `meeting_rescheduled`
 *   cancel      organiser only; the event is deleted (attendees told);
 *               `meeting_cancelled`
 *   reminders   a person's own; delivered in-app (Needs you) and, when
 *               asked, by email, by the worker's tick
 *   brief       at T-24h, a deterministic prep brief for the organiser
 *
 * Authority is not here. A schedule, move or cancel runs as the executor of
 * an approved action (or the person's own confirmed request) and re-checks
 * the party as the actor. Every provider call is idempotent (a client-chosen
 * event id), and no transaction is held across one.
 */

export type OrganiserCalendar = {
  readonly email: string;
  readonly busy: (window: {
    readonly from: Date;
    readonly to: Date;
  }) => Promise<readonly Interval[]>;
  readonly timeZone: () => Promise<string>;
  readonly insert: (event: {
    readonly eventId: string;
    readonly summary: string;
    readonly description: string;
    readonly start: Date;
    readonly end: Date;
    readonly timeZone: string;
    readonly attendees: readonly {
      readonly email: string;
      readonly displayName: string;
    }[];
  }) => Promise<{ readonly meetLink: string | null }>;
  readonly move: (
    eventId: string,
    times: {
      readonly start: Date;
      readonly end: Date;
      readonly timeZone: string;
    },
  ) => Promise<void>;
  readonly cancel: (eventId: string) => Promise<void>;
  /** AUTO (2026-10-02): read the Meet link again; `ask` requests one first. */
  readonly conference?:
    | ((
        eventId: string,
        options: { readonly ask: boolean },
      ) => Promise<
        | { readonly status: "READY"; readonly meetLink: string }
        | { readonly status: "PENDING" | "MISSING" }
      >)
    | undefined;
  /** Send every guest the updated invite, with the link. */
  readonly announceLink?:
    ((eventId: string, meetLink: string) => Promise<void>) | undefined;
};

/** A person's own connected calendar, or null. */
export type CalendarDirectory = (
  userId: string,
) => Promise<OrganiserCalendar | null>;

export type AppEmailPort = {
  readonly available: boolean;
  readonly send: (message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    /** Its own HTML; absent, the sender frames the text. */
    readonly html?: string | undefined;
    readonly attachments?:
      | readonly {
          readonly filename: string;
          readonly content: string;
          readonly contentType: string;
        }[]
      | undefined;
  }) => Promise<void>;
};

export type ScheduleServiceDependencies = {
  readonly store: ScheduleStore;
  readonly transactions: TransactionManager;
  readonly parties: ChatPartyResolver;
  readonly directory: MeetingDirectory;
  readonly calendars: CalendarDirectory;
  readonly activity: MeetingActivityWriter;
  readonly email: AppEmailPort;
  readonly logger?:
    | {
        readonly info: (
          fields: Readonly<Record<string, unknown>>,
          message: string,
        ) => void;
        readonly warn: (
          fields: Readonly<Record<string, unknown>>,
          message: string,
        ) => void;
      }
    | undefined;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
};

export type ScheduleRefusal =
  | "NOT_A_PARTY"
  | "NOT_CONNECTED"
  | "CALENDAR_NOT_CONNECTED"
  | "NO_RECIPIENTS"
  | "NOT_FOUND"
  | "NOT_ORGANISER"
  | "CANCELLED"
  | "INVALID_TIME";

export type ScheduleOutcome<T> =
  | ({ readonly outcome: "OK" } & T)
  | { readonly outcome: "REFUSED"; readonly code: ScheduleRefusal }
  | {
      readonly outcome: "FAILED";
      readonly code: string;
      readonly retryable: boolean;
    };

export type MeetingView = {
  readonly id: string;
  readonly relationshipId: string;
  readonly purpose: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly status: MeetingRecord["status"];
  readonly organisedByYou: boolean;
  readonly organiserName: string;
  readonly meetLink: string | null;
  readonly attendees: readonly string[];
  readonly hasBrief: boolean;
};

export type ReminderView = {
  readonly id: string;
  readonly relationshipId: string | null;
  readonly meetingId: string | null;
  readonly title: string;
  readonly note: string | null;
  readonly dueAt: string;
  readonly channel: ReminderChannel;
  readonly status: ReminderRecord["status"];
};

export type ScheduleService = {
  readonly findSlots: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly from?: Date | undefined;
    readonly to?: Date | undefined;
    readonly durationMinutes: number;
    readonly timeZone?: string | undefined;
  }) => Promise<
    ScheduleOutcome<{
      readonly timeZone: string;
      readonly slots: readonly Interval[];
    }>
  >;
  /** The person's own Google Calendar zone, or null when unknown. */
  readonly timeZoneOf: (actor: ActorContext) => Promise<string | null>;
  /** Precondition check for authorize steps: party, connection, calendar. */
  readonly canSchedule: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<"OK" | ScheduleRefusal>;
  readonly schedule: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly purpose: string;
    readonly startsAt: Date;
    readonly durationMinutes: number;
    readonly timeZone?: string | undefined;
    readonly idempotencyKey: string;
    readonly qActionId?: string | undefined;
    readonly correlationId: string;
  }) => Promise<
    ScheduleOutcome<{
      readonly meeting: MeetingView;
      readonly alreadyScheduled: boolean;
    }>
  >;
  /**
   * AUTO (2026-10-02): a meeting both sides agreed in the chat, recorded
   * without the organiser's Google calendar -- the same meeting row,
   * relationship event, reminder and notices as `schedule`, no Meet link
   * (link to follow). The caller sends the calendar invite (.ics).
   */
  readonly recordAgreed: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly purpose: string;
    readonly startsAt: Date;
    readonly durationMinutes: number;
    readonly timeZone: string;
    readonly idempotencyKey: string;
    readonly qActionId?: string | undefined;
    readonly correlationId: string;
  }) => Promise<
    ScheduleOutcome<{
      readonly meeting: MeetingView;
      readonly alreadyScheduled: boolean;
      readonly organiser: { readonly name: string; readonly email: string };
      readonly invitees: readonly {
        readonly name: string;
        readonly email: string;
      }[];
    }>
  >;
  readonly reschedule: (input: {
    readonly actor: ActorContext;
    readonly meetingId: string;
    readonly startsAt: Date;
    readonly durationMinutes?: number | undefined;
    readonly correlationId: string;
  }) => Promise<
    ScheduleOutcome<{
      readonly meeting: MeetingView;
      readonly alreadyDone: boolean;
    }>
  >;
  readonly cancel: (input: {
    readonly actor: ActorContext;
    readonly meetingId: string;
    readonly correlationId: string;
  }) => Promise<ScheduleOutcome<{ readonly alreadyDone: boolean }>>;
  /** The organiser's own meeting, for authorize steps; null otherwise. */
  readonly organisedMeeting: (
    actor: ActorContext,
    meetingId: string,
  ) => Promise<MeetingView | null>;
  readonly listMeetings: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<readonly MeetingView[] | null>;
  readonly upcomingMeetings: (
    actor: ActorContext,
  ) => Promise<readonly MeetingView[]>;
  readonly brief: (
    actor: ActorContext,
    meetingId: string,
  ) => Promise<{ readonly body: string; readonly createdAt: Date } | null>;

  readonly createReminder: (input: {
    readonly actor: ActorContext;
    readonly title: string;
    readonly dueAt: Date;
    readonly note?: string | undefined;
    readonly relationshipId?: string | undefined;
    readonly channel: ReminderChannel;
    readonly idempotencyKey: string;
    readonly qActionId?: string | undefined;
  }) => Promise<
    ScheduleOutcome<{
      readonly reminder: ReminderView;
      readonly alreadyCreated: boolean;
    }>
  >;
  readonly listReminders: (
    actor: ActorContext,
  ) => Promise<readonly ReminderView[]>;
  readonly dismissReminder: (
    actor: ActorContext,
    reminderId: string,
  ) => Promise<boolean>;
  readonly listNotifications: (actor: ActorContext) => Promise<{
    readonly items: readonly NotificationRecord[];
    readonly unread: number;
  }>;
  readonly markNotificationsRead: (
    actor: ActorContext,
    ids: readonly string[],
  ) => Promise<void>;

  /** Worker tick: deliver due reminders in-app and by email. */
  readonly deliverDue: (
    correlationId: string,
    limit?: number,
  ) => Promise<{ readonly delivered: number; readonly emailed: number }>;
  /**
   * Worker tick (AUTO, 2026-10-02): a booked call whose Meet link Google
   * had not attached yet. Re-read on every tick for the first half hour
   * (asking Google again from 10 minutes), then every 10 minutes until the
   * call; when it appears, the meeting gets it, everyone gets the updated
   * invite and a notice. After half an hour without one, the organiser is
   * told plainly, once, that Q keeps trying.
   */
  readonly refreshMeetLinks: (
    correlationId: string,
    limit?: number,
  ) => Promise<{ readonly found: number; readonly waiting: number }>;
  /** Worker tick: prep briefs for meetings starting within 24 hours. */
  readonly prepareBriefs: (
    correlationId: string,
    limit?: number,
  ) => Promise<number>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_WINDOW_DAYS = 7;
const MEETING_REMINDER_MINUTES = 15;
const BRIEF_LEAD_MS = 24 * 3_600_000;
/** Re-read a missing Meet link on every tick this long after booking. */
const MEET_LINK_EAGER_MS = 30 * 60_000;
/** From then on, ask Google for a conference again (idempotent per id). */
const MEET_LINK_ASK_AFTER_MS = 10 * 60_000;
/** How long after due an email reminder is still worth retrying. */
const EMAIL_RETRY_WINDOW_MS = 60 * 60_000;

function refusal(code: ScheduleRefusal) {
  return { outcome: "REFUSED" as const, code };
}

function providerFailure(error: unknown) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "ERROR";
  const retryable =
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
      ? error.retryable
      : true;
  return {
    outcome: "FAILED" as const,
    code: `CALENDAR_${code}`,
    retryable,
  };
}

/** Google event ids are base32hex; a UUID's hex digits already are. */
export function googleEventIdFor(meetingId: string): string {
  return meetingId.replace(/-/g, "").toLowerCase();
}

function reminderView(record: ReminderRecord): ReminderView {
  return {
    id: record.id,
    relationshipId: record.relationshipId,
    meetingId: record.meetingId,
    title: record.title,
    note: record.note,
    dueAt: record.dueAt.toISOString(),
    channel: record.channel,
    status: record.status,
  };
}

export function createScheduleService(
  dependencies: ScheduleServiceDependencies,
): ScheduleService {
  const { store, transactions, parties, directory, calendars, activity } =
    dependencies;
  const now = dependencies.now ?? (() => new Date());
  const newId = dependencies.newId ?? randomUUID;
  const logger = dependencies.logger;

  async function partyOf(actor: ActorContext, relationshipId: string) {
    if (actor.actorType !== "HUMAN" || !UUID.test(relationshipId)) return null;
    return parties(actor, relationshipId).catch(() => null);
  }

  function view(
    record: MeetingRecord,
    viewerUserId: string,
    hasBrief: boolean,
  ): MeetingView {
    const organiser = record.participants.find(
      (participant) => participant.role === "ORGANISER",
    );
    return {
      id: record.id,
      relationshipId: record.relationshipId,
      purpose: record.purpose,
      startsAt: record.startsAt.toISOString(),
      endsAt: record.endsAt.toISOString(),
      timeZone: record.timeZone,
      status: record.status,
      organisedByYou: record.organiserUserId === viewerUserId,
      organiserName: organiser?.displayName ?? "The organiser",
      // The link is for the people invited, and nobody else.
      meetLink: record.participants.some((p) => p.userId === viewerUserId)
        ? record.meetLink
        : null,
      attendees: record.participants
        .filter((participant) => participant.role === "ATTENDEE")
        .map((participant) => participant.displayName)
        .slice(0, 12),
      hasBrief,
    };
  }

  function viewFor(record: MeetingRecord, viewerUserId: string): MeetingView {
    const brief =
      record.organiserUserId === viewerUserId && record.prepBriefAt !== null;
    return view(record, viewerUserId, brief);
  }

  async function counterpartOf(actor: ActorContext, relationshipId: string) {
    const party = await partyOf(actor, relationshipId);
    if (party === null) return null;
    return {
      party,
      counterpart:
        party.side === "COMPANY"
          ? ("INVESTOR_ORGANISATION" as const)
          : ("COMPANY" as const),
    };
  }

  /** A meeting is on: its event, its reminder, and everyone told. */
  async function finalise(
    record: MeetingRecord,
    meetLink: string | null,
    actor: ActorContext,
    correlationId: string,
  ): Promise<void> {
    await transactions.run(async (tx) => {
      await store.markMeetingScheduled(tx, record.id, meetLink);
      await activity.record(tx, {
        relationshipId: record.relationshipId,
        eventType: "meeting_scheduled",
        meetingId: record.id,
        actorUserId: actor.userId,
        correlationId: correlationId,
      });
      await store.upsertMeetingReminder(tx, {
        meetingId: record.id,
        tenantId: actor.tenantId,
        ownerUserId: actor.userId,
        relationshipId: record.relationshipId,
        title:
          `Call in ${String(MEETING_REMINDER_MINUTES)} minutes: ${record.purpose}`.slice(
            0,
            200,
          ),
        dueAt: new Date(
          record.startsAt.getTime() - MEETING_REMINDER_MINUTES * 60_000,
        ),
      });
      for (const participant of record.participants) {
        if (participant.role !== "ATTENDEE") continue;
        await store.notify(tx, {
          tenantId: participant.participantTenantId,
          userId: participant.userId,
          kind: "MEETING_SCHEDULED",
          title: `New call: ${record.purpose}`.slice(0, 200),
          // The link in the notice itself (founder report 2026-10-02).
          body: meetLink === null ? null : `Meet link: ${meetLink}`,
          linkPath: null,
          reminderId: null,
          meetingId: record.id,
          dedupeKey: `meeting-scheduled:${record.id}`,
        });
      }
      // REHEARSE (founder direction 2026-10-01): every Capital Q person
      // on the call is offered a rehearsal of it with the other side,
      // played by Q. The link names the meeting; the rehearsal service
      // resolves it for that person only.
      for (const participant of record.participants) {
        await store.notify(tx, {
          tenantId: participant.participantTenantId,
          userId: participant.userId,
          kind: "MEETING_PREP_READY",
          title: `Rehearse your call: ${record.purpose}`.slice(0, 200),
          body: "Q can play the other side so you can practise first.",
          linkPath: `/rehearsals/meeting/${record.id}`,
          reminderId: null,
          meetingId: record.id,
          dedupeKey: `rehearse-suggested:${record.id}`,
        });
      }
    });
  }

  async function precheck(
    actor: ActorContext,
    relationshipId: string,
  ): Promise<ScheduleRefusal | OrganiserCalendar> {
    const resolved = await counterpartOf(actor, relationshipId);
    if (resolved === null) return "NOT_A_PARTY";
    if (!resolved.party.connected) return "NOT_CONNECTED";
    const calendar = await calendars(actor.userId).catch((error: unknown) => {
      logger?.warn(
        { err: error, relationshipId },
        "calendar lookup failed for a meeting",
      );
      return null;
    });
    if (calendar === null) {
      // No Google connection with calendar.events for this person, or no
      // Google configuration on this service at all (logged at startup).
      logger?.warn(
        { relationshipId },
        "meeting refused: google calendar not connected for the organiser",
      );
      return "CALENDAR_NOT_CONNECTED";
    }
    return calendar;
  }

  /** A calendar failure, logged with its cause: "didn't answer" alone hid a revoked scope. */
  function failed(error: unknown) {
    const outcome = providerFailure(error);
    logger?.warn(
      { err: error, code: outcome.code },
      "google calendar call failed",
    );
    return outcome;
  }

  async function organiserZone(
    calendar: OrganiserCalendar,
    requested: string | undefined,
  ): Promise<string> {
    if (requested !== undefined && isKnownTimeZone(requested)) return requested;
    const zone = await calendar.timeZone().catch(() => "UTC");
    return isKnownTimeZone(zone) ? zone : "UTC";
  }

  async function ownedMeeting(actor: ActorContext, meetingId: string) {
    if (actor.actorType !== "HUMAN" || !UUID.test(meetingId)) return null;
    const record = await store.findMeeting(meetingId);
    if (record === null || record.organiserUserId !== actor.userId) {
      return null;
    }
    // Still a party to the relationship, as themselves, today.
    if ((await partyOf(actor, record.relationshipId)) === null) return null;
    return record;
  }

  return {
    timeZoneOf: async (actor) => {
      if (actor.actorType !== "HUMAN") return null;
      const calendar = await calendars(actor.userId).catch(() => null);
      if (calendar === null) return null;
      const zone = await calendar.timeZone().catch(() => null);
      return zone !== null && isKnownTimeZone(zone) ? zone : null;
    },

    canSchedule: async (actor, relationshipId) => {
      const checked = await precheck(actor, relationshipId);
      return typeof checked === "string" ? checked : "OK";
    },

    findSlots: async (input) => {
      const checked = await precheck(input.actor, input.relationshipId);
      if (typeof checked === "string") return refusal(checked);
      const calendar = checked;
      const current = now();
      const from = input.from ?? current;
      const to =
        input.to ??
        new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 24 * 3_600_000);
      if (to <= from || to.getTime() - from.getTime() > 31 * 24 * 3_600_000) {
        return refusal("INVALID_TIME");
      }
      try {
        const timeZone = await organiserZone(calendar, input.timeZone);
        const busy: readonly Interval[] = await calendar.busy({ from, to });
        // Never the other side's calendar: reading someone's free/busy
        // needs their explicit consent, and no such opt-in exists.
        return {
          outcome: "OK",
          timeZone,
          slots: proposeSlots({
            now: current,
            from,
            to,
            durationMinutes: input.durationMinutes,
            timeZone,
            busy,
          }),
        };
      } catch (error: unknown) {
        return failed(error);
      }
    },

    schedule: async (input) => {
      const { actor } = input;
      if (input.startsAt.getTime() < now().getTime()) {
        return refusal("INVALID_TIME");
      }
      const checked = await precheck(actor, input.relationshipId);
      if (typeof checked === "string") return refusal(checked);
      const calendar = checked;
      const resolved = await counterpartOf(actor, input.relationshipId);
      const tenantId = await directory.relationshipTenant(input.relationshipId);
      if (resolved === null || tenantId === null) return refusal("NOT_A_PARTY");
      // Invitees are the counterparty organisation's own people: the
      // recipient of an invite must be a party to the relationship.
      const people = await directory.counterpartPeople({
        relationshipId: input.relationshipId,
        counterpart: resolved.counterpart,
      });
      if (people.length === 0) return refusal("NO_RECIPIENTS");
      const self = await directory.person(actor.userId);
      const timeZone = await organiserZone(calendar, input.timeZone);
      const participants: MeetingParticipant[] = [
        {
          participantTenantId: actor.tenantId,
          userId: actor.userId,
          role: "ORGANISER",
          displayName: self?.name ?? calendar.email,
          email: calendar.email.toLowerCase(),
        },
        ...people
          .filter((person) => person.userId !== actor.userId)
          .slice(0, 10)
          .map((person) => ({
            participantTenantId: person.tenantId,
            userId: person.userId,
            role: "ATTENDEE" as const,
            displayName: person.name.slice(0, 200),
            email: person.email.toLowerCase(),
          })),
      ];
      const meetingId = newId();
      const claim = await store.claimMeeting({
        id: meetingId,
        tenantId,
        relationshipId: input.relationshipId,
        organiserUserId: actor.userId,
        organiserTenantId: actor.tenantId,
        purpose: input.purpose,
        startsAt: input.startsAt,
        endsAt: new Date(
          input.startsAt.getTime() + input.durationMinutes * 60_000,
        ),
        timeZone,
        googleEventId: googleEventIdFor(meetingId),
        qActionId: input.qActionId ?? null,
        idempotencyKey: input.idempotencyKey,
        participants,
      });
      const record = claim.record;
      if (record.organiserUserId !== actor.userId) {
        return refusal("NOT_ORGANISER");
      }
      if (record.status === "SCHEDULED" || record.status === "CANCELLED") {
        return {
          outcome: "OK",
          meeting: viewFor(record, actor.userId),
          alreadyScheduled: true,
        };
      }
      let meetLink: string | null;
      try {
        // Idempotent at Google by the event id: a retry never double-invites.
        ({ meetLink } = await calendar.insert({
          eventId: record.googleEventId,
          summary: record.purpose.slice(0, 200),
          // ADR 0027: consent is asked for here, once, where the call is made.
          description: `${record.purpose}\n\nArranged on Capital Q. Q from Capital Q joins this call to keep the meeting record for both sides; anyone on the call can ask Q to leave.`,
          start: record.startsAt,
          end: record.endsAt,
          timeZone: record.timeZone,
          attendees: record.participants
            .filter((participant) => participant.role === "ATTENDEE")
            .map((participant) => ({
              email: participant.email,
              displayName: participant.displayName,
            })),
        }));
      } catch (error: unknown) {
        await store.markMeetingFailed(record.id);
        logger?.warn(
          { meetingId: record.id, err: error },
          "calendar insert failed for an approved meeting",
        );
        return failed(error);
      }
      logger?.info(
        {
          meetingId: record.id,
          attendees: record.participants.length - 1,
          hasMeetLink: meetLink !== null,
        },
        "calendar event created",
      );
      await finalise(record, meetLink, actor, input.correlationId);
      logger?.info({ meetingId: record.id }, "meeting scheduled");
      const fresh = (await store.findMeeting(record.id)) ?? record;
      return {
        outcome: "OK",
        meeting: viewFor(fresh, actor.userId),
        alreadyScheduled: !claim.created,
      };
    },

    recordAgreed: async (input) => {
      const { actor } = input;
      if (actor.actorType !== "HUMAN") return refusal("NOT_A_PARTY");
      if (input.startsAt.getTime() < now().getTime()) {
        return refusal("INVALID_TIME");
      }
      const resolved = await counterpartOf(actor, input.relationshipId);
      if (resolved === null) return refusal("NOT_A_PARTY");
      if (!resolved.party.connected) return refusal("NOT_CONNECTED");
      const tenantId = await directory.relationshipTenant(input.relationshipId);
      if (tenantId === null) return refusal("NOT_A_PARTY");
      const people = await directory.counterpartPeople({
        relationshipId: input.relationshipId,
        counterpart: resolved.counterpart,
      });
      const self = await directory.person(actor.userId);
      if (people.length === 0 || self === null) return refusal("NO_RECIPIENTS");
      const timeZone = isKnownTimeZone(input.timeZone) ? input.timeZone : "UTC";
      const meetingId = newId();
      const claim = await store.claimMeeting({
        id: meetingId,
        tenantId,
        relationshipId: input.relationshipId,
        organiserUserId: actor.userId,
        organiserTenantId: actor.tenantId,
        purpose: input.purpose,
        startsAt: input.startsAt,
        endsAt: new Date(
          input.startsAt.getTime() + input.durationMinutes * 60_000,
        ),
        timeZone,
        // Not a Google event: the id is only the row's own stable handle.
        googleEventId: googleEventIdFor(meetingId),
        qActionId: input.qActionId ?? null,
        idempotencyKey: input.idempotencyKey,
        participants: [
          {
            participantTenantId: actor.tenantId,
            userId: actor.userId,
            role: "ORGANISER",
            displayName: self.name,
            email: self.email,
          },
          ...people
            .filter((person) => person.userId !== actor.userId)
            .slice(0, 10)
            .map((person) => ({
              participantTenantId: person.tenantId,
              userId: person.userId,
              role: "ATTENDEE" as const,
              displayName: person.name.slice(0, 200),
              email: person.email.toLowerCase(),
            })),
        ],
      });
      const record = claim.record;
      if (record.organiserUserId !== actor.userId) {
        return refusal("NOT_ORGANISER");
      }
      const invitees = record.participants
        .filter((participant) => participant.role === "ATTENDEE")
        .map((participant) => ({
          name: participant.displayName,
          email: participant.email,
        }));
      const organiser = { name: self.name, email: self.email };
      if (record.status !== "SCHEDULED" && record.status !== "CANCELLED") {
        await finalise(record, null, actor, input.correlationId);
        logger?.info({ meetingId: record.id }, "agreed meeting recorded");
      }
      const fresh = (await store.findMeeting(record.id)) ?? record;
      return {
        outcome: "OK",
        meeting: viewFor(fresh, actor.userId),
        alreadyScheduled: !claim.created || record.status === "SCHEDULED",
        organiser,
        invitees,
      };
    },

    reschedule: async (input) => {
      const record = await ownedMeeting(input.actor, input.meetingId);
      if (record === null) return refusal("NOT_FOUND");
      if (record.status === "CANCELLED") return refusal("CANCELLED");
      if (record.status !== "SCHEDULED") return refusal("NOT_FOUND");
      if (input.startsAt.getTime() < now().getTime()) {
        return refusal("INVALID_TIME");
      }
      const minutes =
        input.durationMinutes ??
        Math.round(
          (record.endsAt.getTime() - record.startsAt.getTime()) / 60_000,
        );
      const endsAt = new Date(input.startsAt.getTime() + minutes * 60_000);
      if (
        record.startsAt.getTime() === input.startsAt.getTime() &&
        record.endsAt.getTime() === endsAt.getTime()
      ) {
        return {
          outcome: "OK",
          meeting: viewFor(record, input.actor.userId),
          alreadyDone: true,
        };
      }
      const calendar = await calendars(input.actor.userId).catch(() => null);
      if (calendar === null) return refusal("CALENDAR_NOT_CONNECTED");
      try {
        await calendar.move(record.googleEventId, {
          start: input.startsAt,
          end: endsAt,
          timeZone: record.timeZone,
        });
      } catch (error: unknown) {
        return failed(error);
      }
      await transactions.run(async (tx) => {
        if (
          !(await store.moveMeeting(tx, record.id, {
            startsAt: input.startsAt,
            endsAt,
          }))
        ) {
          return;
        }
        await activity.record(tx, {
          relationshipId: record.relationshipId,
          eventType: "meeting_rescheduled",
          meetingId: record.id,
          actorUserId: input.actor.userId,
          correlationId: input.correlationId,
        });
        await store.upsertMeetingReminder(tx, {
          meetingId: record.id,
          tenantId: input.actor.tenantId,
          ownerUserId: input.actor.userId,
          relationshipId: record.relationshipId,
          title:
            `Call in ${String(MEETING_REMINDER_MINUTES)} minutes: ${record.purpose}`.slice(
              0,
              200,
            ),
          dueAt: new Date(
            input.startsAt.getTime() - MEETING_REMINDER_MINUTES * 60_000,
          ),
        });
      });
      const fresh = (await store.findMeeting(record.id)) ?? record;
      return {
        outcome: "OK",
        meeting: viewFor(fresh, input.actor.userId),
        alreadyDone: false,
      };
    },

    cancel: async (input) => {
      const record = await ownedMeeting(input.actor, input.meetingId);
      if (record === null) return refusal("NOT_FOUND");
      if (record.status === "CANCELLED") {
        return { outcome: "OK", alreadyDone: true };
      }
      if (record.status === "SCHEDULED" || record.status === "SCHEDULING") {
        const calendar = await calendars(input.actor.userId).catch(() => null);
        if (calendar === null) return refusal("CALENDAR_NOT_CONNECTED");
        try {
          await calendar.cancel(record.googleEventId);
        } catch (error: unknown) {
          return failed(error);
        }
      }
      let changed = false;
      await transactions.run(async (tx) => {
        changed = await store.cancelMeeting(tx, record.id);
        if (!changed) return;
        await store.cancelMeetingReminder(tx, record.id);
        await activity.record(tx, {
          relationshipId: record.relationshipId,
          eventType: "meeting_cancelled",
          meetingId: record.id,
          actorUserId: input.actor.userId,
          correlationId: input.correlationId,
        });
        for (const participant of record.participants) {
          if (participant.role !== "ATTENDEE") continue;
          await store.notify(tx, {
            tenantId: participant.participantTenantId,
            userId: participant.userId,
            kind: "MEETING_CANCELLED",
            title: `Call cancelled: ${record.purpose}`.slice(0, 200),
            body: null,
            linkPath: null,
            reminderId: null,
            meetingId: record.id,
            dedupeKey: `meeting-cancelled:${record.id}`,
          });
        }
      });
      return { outcome: "OK", alreadyDone: !changed };
    },

    organisedMeeting: async (actor, meetingId) => {
      const record = await ownedMeeting(actor, meetingId);
      return record === null ? null : viewFor(record, actor.userId);
    },

    listMeetings: async (actor, relationshipId) => {
      if ((await partyOf(actor, relationshipId)) === null) return null;
      const records = await store.listMeetingsForRelationship(
        relationshipId,
        50,
      );
      return (
        records
          // A party sees the calls they are in; the organiser's colleagues
          // who were not invited see nothing of the link (view() hides it).
          .filter((record) => record.status !== "FAILED")
          .map((record) => viewFor(record, actor.userId))
      );
    },

    upcomingMeetings: async (actor) => {
      if (actor.actorType !== "HUMAN") return [];
      const records = await store.listMeetingsForUser(
        actor.userId,
        new Date(now().getTime() - 3_600_000),
        20,
      );
      return records
        .filter((record) => record.status === "SCHEDULED")
        .map((record) => viewFor(record, actor.userId));
    },

    brief: async (actor, meetingId) => {
      if (actor.actorType !== "HUMAN" || !UUID.test(meetingId)) return null;
      return store.findBrief(meetingId, actor.userId);
    },

    createReminder: async (input) => {
      const { actor } = input;
      if (actor.actorType !== "HUMAN") return refusal("NOT_A_PARTY");
      if (
        input.relationshipId !== undefined &&
        (await partyOf(actor, input.relationshipId)) === null
      ) {
        return refusal("NOT_A_PARTY");
      }
      const created = await store.createReminder({
        tenantId: actor.tenantId,
        ownerUserId: actor.userId,
        relationshipId: input.relationshipId ?? null,
        title: input.title,
        note: input.note ?? null,
        dueAt: input.dueAt,
        channel: input.channel,
        qActionId: input.qActionId ?? null,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        outcome: "OK",
        reminder: reminderView(created.record),
        alreadyCreated: !created.created,
      };
    },

    listReminders: async (actor) =>
      actor.actorType !== "HUMAN"
        ? []
        : (await store.listReminders(actor.userId, 100)).map(reminderView),

    dismissReminder: async (actor, reminderId) =>
      actor.actorType === "HUMAN" &&
      UUID.test(reminderId) &&
      store.dismissReminder(actor.userId, reminderId),

    listNotifications: async (actor) =>
      actor.actorType !== "HUMAN"
        ? { items: [], unread: 0 }
        : store.listNotifications(actor.userId, 30),

    markNotificationsRead: async (actor, ids) => {
      if (actor.actorType !== "HUMAN") return;
      await store.markNotificationsRead(
        actor.userId,
        ids.filter((id) => UUID.test(id)),
        now(),
      );
    },

    deliverDue: async (_correlationId, limit = 200) => {
      const current = now();
      const due = await store.dueReminders(current, limit);
      let delivered = 0;
      let emailed = 0;
      for (const reminder of due) {
        if (reminder.status === "PENDING") {
          await transactions.run(async (tx) => {
            await store.notify(tx, {
              tenantId: reminder.tenantId,
              userId: reminder.ownerUserId,
              kind: "REMINDER",
              title: reminder.title,
              body: reminder.note,
              linkPath: null,
              reminderId: reminder.id,
              meetingId: reminder.meetingId,
              dedupeKey: `reminder:${reminder.id}`,
            });
            await store.markReminderDelivered(tx, reminder.id, current);
          });
          delivered += 1;
        }
        if (
          reminder.channel !== "EMAIL" ||
          reminder.emailSentAt !== null ||
          !dependencies.email.available ||
          current.getTime() - reminder.dueAt.getTime() > EMAIL_RETRY_WINDOW_MS
        ) {
          continue;
        }
        const owner = await directory.person(reminder.ownerUserId);
        if (owner === null) continue;
        try {
          await dependencies.email.send({
            to: owner.email,
            subject: `Reminder: ${reminder.title}`.replace(/[\r\n]+/g, " "),
            text: [
              reminder.title,
              reminder.note ?? "",
              "",
              "Open Capital Q to act on it.",
            ]
              .filter((line, index) => index !== 1 || line.length > 0)
              .join("\n"),
          });
          await store.markReminderEmailed(reminder.id, current);
          emailed += 1;
          logger?.info({ reminderId: reminder.id }, "reminder email sent");
        } catch (error: unknown) {
          // In-app delivery stands; the email is retried next tick.
          logger?.warn(
            {
              reminderId: reminder.id,
              errorName: error instanceof Error ? error.name : typeof error,
              // The transport's own diagnosis (a connection refused, a
              // recipient rejected), never the message or the credentials.
              ...transportDiagnosis(error),
            },
            "reminder email failed",
          );
        }
      }
      return { delivered, emailed };
    },

    refreshMeetLinks: async (_correlationId, limit = 20) => {
      const current = now();
      const waiting = await store.meetingsAwaitingLink(current, limit);
      let found = 0;
      for (const { meeting, createdAt } of waiting) {
        const age = current.getTime() - createdAt.getTime();
        // The first half hour on every tick, then about every 10 minutes.
        if (age > MEET_LINK_EAGER_MS && Math.floor(age / 60_000) % 10 !== 0) {
          continue;
        }
        const calendar = await calendars(meeting.organiserUserId).catch(
          () => null,
        );
        // No calendar (a time agreed in the chat) has its own "link to
        // follow"; a calendar without the capability can't be asked.
        if (calendar?.conference === undefined) continue;
        const read = await calendar
          .conference(meeting.googleEventId, {
            ask: age >= MEET_LINK_ASK_AFTER_MS,
          })
          .catch((error: unknown) => {
            logger?.warn(
              { meetingId: meeting.id, err: error },
              "meet link re-read failed",
            );
            return null;
          });
        if (read === null || read.status === "MISSING") continue;
        if (read.status === "READY") {
          if (!(await store.setMeetLink(meeting.id, read.meetLink))) continue;
          found += 1;
          await calendar
            .announceLink?.(meeting.googleEventId, read.meetLink)
            .catch((error: unknown) => {
              logger?.warn(
                { meetingId: meeting.id, err: error },
                "updated invite not sent",
              );
            });
          await transactions.run(async (tx) => {
            for (const participant of meeting.participants) {
              await store.notify(tx, {
                tenantId: participant.participantTenantId,
                userId: participant.userId,
                kind: "MEETING_SCHEDULED",
                title: `Meet link ready: ${meeting.purpose}`.slice(0, 200),
                body: read.meetLink,
                linkPath: null,
                reminderId: null,
                meetingId: meeting.id,
                dedupeKey: `meet-link:${meeting.id}`,
              });
            }
          });
          logger?.info({ meetingId: meeting.id }, "meet link attached late");
          continue;
        }
        if (age >= MEET_LINK_EAGER_MS) {
          await transactions.run(async (tx) => {
            await store.notify(tx, {
              tenantId: meeting.organiserTenantId,
              userId: meeting.organiserUserId,
              kind: "MEETING_SCHEDULED",
              title:
                `Google hasn't added a Meet link to "${meeting.purpose}" yet`.slice(
                  0,
                  200,
                ),
              body: "Q asked Google again and keeps checking until the call. If you'd rather not wait, add a video link to the calendar event and Q will use it.",
              linkPath: null,
              reminderId: null,
              meetingId: meeting.id,
              dedupeKey: `meet-link-missing:${meeting.id}`,
            });
          });
        }
      }
      return { found, waiting: waiting.length - found };
    },

    prepareBriefs: async (_correlationId, limit = 50) => {
      const current = now();
      const meetings = await store.meetingsNeedingBrief(
        current,
        new Date(current.getTime() + BRIEF_LEAD_MS),
        limit,
      );
      let prepared = 0;
      for (const meeting of meetings) {
        const counterpartName =
          (await directory.counterpartName({
            relationshipId: meeting.relationshipId,
            organiserTenantId: meeting.organiserTenantId,
          })) ?? "the other side";
        const openReminders = (
          await store.listReminders(meeting.organiserUserId, 100)
        ).filter(
          (reminder) =>
            reminder.relationshipId === meeting.relationshipId &&
            reminder.source === "PERSON" &&
            (reminder.status === "PENDING" || reminder.status === "DELIVERED"),
        );
        const body = composePrepBrief({
          meeting,
          counterpartName,
          openReminders,
        });
        await transactions.run(async (tx) => {
          await store.saveBrief(tx, {
            meetingId: meeting.id,
            tenantId: meeting.organiserTenantId,
            userId: meeting.organiserUserId,
            composerVersion: PREP_BRIEF_COMPOSER_VERSION,
            body,
          });
          await store.notify(tx, {
            tenantId: meeting.organiserTenantId,
            userId: meeting.organiserUserId,
            kind: "MEETING_PREP_READY",
            title: `Prep brief ready: ${meeting.purpose}`.slice(0, 200),
            body: null,
            linkPath: null,
            reminderId: null,
            meetingId: meeting.id,
            dedupeKey: `meeting-brief:${meeting.id}`,
          });
        });
        prepared += 1;
      }
      return prepared;
    },
  };
}

/** The SMTP failure's code and reply status, when the transport gave them. */
function transportDiagnosis(error: unknown): {
  readonly code?: string;
  readonly responseCode?: number;
} {
  if (typeof error !== "object" || error === null) return {};
  const code = "code" in error ? error.code : undefined;
  const responseCode = "responseCode" in error ? error.responseCode : undefined;
  return {
    ...(typeof code === "string" ? { code: code.slice(0, 40) } : {}),
    ...(typeof responseCode === "number" ? { responseCode } : {}),
  };
}
