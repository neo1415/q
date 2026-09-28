import { z } from "zod";

import {
  MeetingDurationMinutesSchema,
  MeetingPurposeSchema,
  QActionTypeSchema,
  ReminderChannelSchema,
  ReminderNoteSchema,
  ReminderTitleSchema,
  TimeZoneSchema,
  UtcTimestampSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type {
  ScheduleOutcome,
  ScheduleService,
} from "@capital-q/communication";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionExecutionReport,
} from "@capital-q/q-actions";
import {
  MEETING_CANCEL as MEETING_CANCEL_NAME,
  MEETING_RESCHEDULE as MEETING_RESCHEDULE_NAME,
  MEETING_SCHEDULE as MEETING_SCHEDULE_NAME,
  REMINDER_CREATE as REMINDER_CREATE_NAME,
  type ScheduleIntelligencePort,
} from "@capital-q/q-tools";

/**
 * Meetings and reminders as Approval Engine actions (BIZ-008; R11, R34).
 *
 *   reminder.create     the approver's own reminder, delivered in Needs you
 *                       (and by email when asked) at its time
 *   meeting.schedule    a Google Calendar invite with a Meet link from the
 *                       approver's own calendar to the counterparty's own
 *                       people, sendUpdates=all only now, after approval
 *   meeting.reschedule  organiser only: the invite moves for everyone
 *   meeting.cancel      organiser only: the event is deleted for everyone
 *
 * `authorize` runs at proposal, at approval and before execution: the
 * approver must be a person, still a party to the relationship (connected
 * for a call), with Calendar connected, and the organiser for a change. The
 * payload is bound: an edited time is a new proposal. Every execution is
 * idempotent by the action's own key (a client-chosen Google event id),
 * so a retry never invites twice.
 */

export const REMINDER_CREATE = QActionTypeSchema.parse(REMINDER_CREATE_NAME);
export const MEETING_SCHEDULE = QActionTypeSchema.parse(MEETING_SCHEDULE_NAME);
export const MEETING_RESCHEDULE = QActionTypeSchema.parse(
  MEETING_RESCHEDULE_NAME,
);
export const MEETING_CANCEL = QActionTypeSchema.parse(MEETING_CANCEL_NAME);

const CounterpartNameSchema = z.string().trim().min(1).max(200);

export const ReminderCreatePayloadSchema = z
  .object({
    /**
     * Whose reminder: the Approval Engine needs a target, and a personal
     * reminder (about no relationship) had none, so every one was refused
     * at proposal (live 2026-09-28: ACTION_NOT_PERMITTED). Optional only
     * so proposals made before it still parse; authorize binds it to the
     * approver.
     */
    ownerUserId: UuidSchema.optional(),
    relationshipId: UuidSchema.optional(),
    counterpartName: CounterpartNameSchema.optional(),
    title: ReminderTitleSchema,
    remindAt: UtcTimestampSchema,
    /** The zone the person named the time in, for what they are shown. */
    timeZone: TimeZoneSchema.optional(),
    note: ReminderNoteSchema.optional(),
    channel: ReminderChannelSchema,
  })
  .strict();
export type ReminderCreatePayload = z.infer<typeof ReminderCreatePayloadSchema>;

export const MeetingSchedulePayloadSchema = z
  .object({
    relationshipId: UuidSchema,
    counterpartName: CounterpartNameSchema,
    purpose: MeetingPurposeSchema,
    startsAt: UtcTimestampSchema,
    durationMinutes: MeetingDurationMinutesSchema,
    timeZone: TimeZoneSchema.optional(),
  })
  .strict();
export type MeetingSchedulePayload = z.infer<
  typeof MeetingSchedulePayloadSchema
>;

export const MeetingReschedulePayloadSchema = z
  .object({
    meetingId: UuidSchema,
    relationshipId: UuidSchema,
    purpose: MeetingPurposeSchema,
    startsAt: UtcTimestampSchema,
    durationMinutes: MeetingDurationMinutesSchema,
  })
  .strict();
export type MeetingReschedulePayload = z.infer<
  typeof MeetingReschedulePayloadSchema
>;

export const MeetingCancelPayloadSchema = z
  .object({
    meetingId: UuidSchema,
    relationshipId: UuidSchema,
    purpose: MeetingPurposeSchema,
    startsAt: UtcTimestampSchema,
  })
  .strict();
export type MeetingCancelPayload = z.infer<typeof MeetingCancelPayloadSchema>;

const ReminderResultSchema = z
  .object({ reminderId: UuidSchema, alreadyCreated: z.boolean() })
  .strict();
const MeetingResultSchema = z
  .object({
    meetingId: UuidSchema,
    meetLink: z.string().nullable(),
    alreadyDone: z.boolean(),
  })
  .strict();
const CancelResultSchema = z.object({ alreadyDone: z.boolean() }).strict();

/** The time as the person reads it: in the zone they named it in, when known. */
const when = (iso: string, timeZone?: string) => {
  if (timeZone !== undefined) {
    try {
      return `${new Intl.DateTimeFormat("en-GB", {
        timeZone,
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso))} (${timeZone})`;
    } catch {
      // An unknown zone reads in UTC below.
    }
  }
  return new Date(iso).toUTCString().replace(":00 GMT", " UTC");
};

/** A schedule outcome as an action result; refusals are final. */
function asExecution<T, R>(
  outcome: ScheduleOutcome<T>,
  result: (ok: T) => R,
): QActionExecutionReport<R> {
  switch (outcome.outcome) {
    case "OK":
      return { outcome: "EXECUTED", result: result(outcome) };
    case "REFUSED":
      return {
        outcome: "FAILED",
        failureCode: outcome.code,
        retryable: false,
      };
    case "FAILED":
      return {
        outcome: "FAILED",
        failureCode: outcome.code,
        retryable: outcome.retryable,
      };
  }
}

const relationshipTarget = (relationshipId: string): readonly QSubjectRef[] => [
  { kind: "RELATIONSHIP", relationshipId },
];

export function createReminderCreateAction(dependencies: {
  readonly schedule: ScheduleService;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { schedule, logger } = dependencies;
  return defineQAction<
    ReminderCreatePayload,
    z.infer<typeof ReminderResultSchema>
  >({
    actionType: REMINDER_CREATE,
    version: 2,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Creates the approver's own reminder (optionally about one relationship they are party to); when due it shows in Needs you and, if chosen, arrives by email.",
    payload: ReminderCreatePayloadSchema,
    result: ReminderResultSchema,
    targets: (payload): readonly QSubjectRef[] =>
      payload.relationshipId !== undefined
        ? relationshipTarget(payload.relationshipId)
        : payload.ownerUserId !== undefined
          ? [{ kind: "USER", userId: payload.ownerUserId }]
          : [],
    describe: (payload) => ({
      summary: `Reminder: ${payload.title}`,
      preview: `${payload.title}\n${when(payload.remindAt, payload.timeZone)}${payload.channel === "EMAIL" ? " (and by email)" : ""}${payload.note === undefined ? "" : `\n\n${payload.note}`}`,
    }),
    confirm: (payload, result) =>
      result.alreadyCreated
        ? `That reminder was already set; nothing was added twice.`
        : `Done. I'll remind you: ${payload.title}.`,
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      // A reminder is only ever the approver's own.
      if (
        payload.ownerUserId !== undefined &&
        payload.ownerUserId !== actor.userId
      ) {
        return { outcome: "DENY", code: "NOT_OWNER" };
      }
      if (
        payload.relationshipId !== undefined &&
        (await schedule.listMeetings(actor, payload.relationshipId)) === null
      ) {
        return { outcome: "DENY", code: "NOT_A_PARTY" };
      }
      return { outcome: "ALLOW" };
    },
    executor: {
      execute: async (action, context) => {
        const outcome = await schedule.createReminder({
          actor: context.approver,
          title: action.payload.title,
          dueAt: new Date(action.payload.remindAt),
          note: action.payload.note,
          relationshipId: action.payload.relationshipId,
          channel: action.payload.channel,
          idempotencyKey: `q-action:${action.idempotencyKey}`,
          qActionId: action.actionId,
        });
        if (outcome.outcome === "OK") {
          logger?.info(
            {
              actionId: action.actionId,
              reminderId: outcome.reminder.id,
              dueAt: action.payload.remindAt,
              channel: action.payload.channel,
              alreadyCreated: outcome.alreadyCreated,
            },
            "reminder created",
          );
        } else {
          logger?.warn(
            { actionId: action.actionId, code: outcome.code },
            "approved reminder not created",
          );
        }
        return asExecution(outcome, (ok) => ({
          reminderId: ok.reminder.id,
          alreadyCreated: ok.alreadyCreated,
        }));
      },
    },
  });
}

export function createMeetingScheduleAction(dependencies: {
  readonly schedule: ScheduleService;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { schedule, logger } = dependencies;
  return defineQAction<
    MeetingSchedulePayload,
    z.infer<typeof MeetingResultSchema>
  >({
    actionType: MEETING_SCHEDULE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Creates a Google Calendar event with a Meet link on the approver's own calendar and invites the other side's own people (sendUpdates=all), exactly as approved; records meeting_scheduled on the relationship.",
    payload: MeetingSchedulePayloadSchema,
    result: MeetingResultSchema,
    targets: (payload) => relationshipTarget(payload.relationshipId),
    describe: (payload) => ({
      summary: `Call with ${payload.counterpartName}`,
      preview: `${payload.purpose}\n${when(payload.startsAt, payload.timeZone)}, ${String(payload.durationMinutes)} minutes\nGoogle Meet invite to ${payload.counterpartName}'s people`,
    }),
    confirm: (payload, result) =>
      result.alreadyDone
        ? `That call with ${payload.counterpartName} was already booked; nobody was invited twice.`
        : `Booked. ${payload.counterpartName} has the invite${result.meetLink === null ? "" : ` and the Meet link: ${result.meetLink}`}.`,
    authorize: async (payload, actor) => {
      const check = await schedule.canSchedule(actor, payload.relationshipId);
      return check === "OK"
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: check };
    },
    executor: {
      execute: async (action, context) => {
        logger?.info(
          {
            actionId: action.actionId,
            relationshipId: action.payload.relationshipId,
            startsAt: action.payload.startsAt,
            timeZone: action.payload.timeZone ?? null,
            attempt: context.attempt,
          },
          "approved meeting executing",
        );
        const outcome = await schedule.schedule({
          actor: context.approver,
          relationshipId: action.payload.relationshipId,
          purpose: action.payload.purpose,
          startsAt: new Date(action.payload.startsAt),
          durationMinutes: action.payload.durationMinutes,
          timeZone: action.payload.timeZone,
          idempotencyKey: `q-action:${action.idempotencyKey}`,
          qActionId: action.actionId,
          correlationId: context.correlationId,
        });
        if (outcome.outcome !== "OK") {
          // The reason travels to the person through the action's failure
          // code; here it is for whoever reads the logs.
          logger?.warn(
            {
              actionId: action.actionId,
              attempt: context.attempt,
              outcome: outcome.outcome,
              code: outcome.code,
            },
            "approved meeting not booked",
          );
        }
        return asExecution(outcome, (ok) => ({
          meetingId: ok.meeting.id,
          meetLink: ok.meeting.meetLink,
          alreadyDone: ok.alreadyScheduled,
        }));
      },
    },
  });
}

export function createMeetingRescheduleAction(dependencies: {
  readonly schedule: ScheduleService;
}): AnyQActionDefinition {
  const { schedule } = dependencies;
  return defineQAction<
    MeetingReschedulePayload,
    z.infer<typeof MeetingResultSchema>
  >({
    actionType: MEETING_RESCHEDULE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Moves a call the approver organised to the approved time; Google tells everyone invited; records meeting_rescheduled.",
    payload: MeetingReschedulePayloadSchema,
    result: MeetingResultSchema,
    targets: (payload) => relationshipTarget(payload.relationshipId),
    describe: (payload) => ({
      summary: `Move: ${payload.purpose}`,
      preview: `${payload.purpose}\nNew time: ${when(payload.startsAt)}, ${String(payload.durationMinutes)} minutes`,
    }),
    confirm: (_payload, result) =>
      result.alreadyDone
        ? "The call was already at that time."
        : "Moved. Everyone invited has the new time.",
    authorize: async (payload, actor) => {
      const meeting = await schedule.organisedMeeting(actor, payload.meetingId);
      if (
        meeting === null ||
        meeting.relationshipId !== payload.relationshipId
      ) {
        return { outcome: "DENY", code: "NOT_ORGANISER" };
      }
      return meeting.status === "SCHEDULED"
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_SCHEDULED" };
    },
    executor: {
      execute: async (action, context) =>
        asExecution(
          await schedule.reschedule({
            actor: context.approver,
            meetingId: action.payload.meetingId,
            startsAt: new Date(action.payload.startsAt),
            durationMinutes: action.payload.durationMinutes,
            correlationId: context.correlationId,
          }),
          (ok) => ({
            meetingId: ok.meeting.id,
            meetLink: ok.meeting.meetLink,
            alreadyDone: ok.alreadyDone,
          }),
        ),
    },
  });
}

export function createMeetingCancelAction(dependencies: {
  readonly schedule: ScheduleService;
}): AnyQActionDefinition {
  const { schedule } = dependencies;
  return defineQAction<
    MeetingCancelPayload,
    z.infer<typeof CancelResultSchema>
  >({
    actionType: MEETING_CANCEL,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Cancels a call the approver organised: the Google Calendar event is deleted and everyone invited is told; records meeting_cancelled.",
    payload: MeetingCancelPayloadSchema,
    result: CancelResultSchema,
    targets: (payload) => relationshipTarget(payload.relationshipId),
    describe: (payload) => ({
      summary: `Cancel: ${payload.purpose}`,
      preview: `${payload.purpose}\n${when(payload.startsAt)}\nEveryone invited will be told.`,
    }),
    confirm: (_payload, result) =>
      result.alreadyDone
        ? "That call was already cancelled."
        : "Cancelled. Everyone invited has been told.",
    authorize: async (payload, actor) => {
      const meeting = await schedule.organisedMeeting(actor, payload.meetingId);
      return meeting === null ||
        meeting.relationshipId !== payload.relationshipId
        ? { outcome: "DENY", code: "NOT_ORGANISER" }
        : { outcome: "ALLOW" };
    },
    executor: {
      execute: async (action, context) =>
        asExecution(
          await schedule.cancel({
            actor: context.approver,
            meetingId: action.payload.meetingId,
            correlationId: context.correlationId,
          }),
          (ok) => ({ alreadyDone: ok.alreadyDone }),
        ),
    },
  });
}

/** What Q's schedule tools read through, as the invoker. */
export function createScheduleIntelligencePort(
  schedule: ScheduleService,
): ScheduleIntelligencePort {
  return {
    findSlots: async (actor, input) => {
      const found = await schedule.findSlots({ actor, ...input });
      if (found.outcome === "OK") {
        return { status: "OK", timeZone: found.timeZone, slots: found.slots };
      }
      return {
        status: found.outcome === "REFUSED" ? found.code : "UNAVAILABLE",
      };
    },
    upcoming: async (actor) => ({
      meetings: await schedule.upcomingMeetings(actor),
      reminders: (await schedule.listReminders(actor))
        .filter((reminder) => reminder.status === "PENDING")
        .map((reminder) => ({
          id: reminder.id,
          title: reminder.title,
          dueAt: reminder.dueAt,
          relationshipId: reminder.relationshipId,
        })),
    }),
    organisedMeeting: async (actor, meetingId) =>
      schedule.organisedMeeting(actor, meetingId),
    timeZoneOf: (actor) => schedule.timeZoneOf(actor),
    brief: async (actor, meetingId) =>
      (await schedule.brief(actor, meetingId))?.body ?? null,
  };
}
