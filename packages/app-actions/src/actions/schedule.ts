import { z } from "zod";

import type {
  ScheduleOutcome,
  ScheduleRefusal,
  ScheduleService,
} from "@capital-q/communication";
import {
  CreateReminderRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  googleMeetLink,
  JoinMeetingRequestSchema,
  MEETING_CANCEL_PATH,
  MeetingDtoSchema,
  RELATIONSHIP_MEETING_JOIN_PATH,
  RELATIONSHIP_MEETINGS_PATH,
  REMINDER_DISMISS_PATH,
  REMINDERS_PATH,
  ReminderDtoSchema,
  ScheduleMeetingRequestSchema,
  type KnownErrorCode,
} from "@capital-q/contracts";

import {
  defineAppAction,
  portMissing,
  refusal,
  relationshipTarget,
  type AnyAppAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Schedule (ADR 0040 checklist, relationships): booking a call, cancelling
 * it, setting and dismissing a reminder, each declared once with its
 * generated route. The schedule service's refusals answer as the same
 * problem details the hand-written routes gave (`scheduleProblem`, which
 * the remaining read routes use too).
 *
 * Step 1: Q still books, cancels and reminds through its schedule tools
 * (`legacyTool`), which the meeting and errand paths build on.
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The schedule service decides who is a party or the organiser. */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const schedule = (ports: AppActionPorts) =>
  ports.schedule ?? missing("schedule");

const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const REFUSALS: Readonly<
  Record<
    ScheduleRefusal,
    { readonly code: KnownErrorCode; readonly detail: string }
  >
> = {
  NOT_A_PARTY: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_ORGANISER: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_CONNECTED: {
    code: "RESOURCE_CONFLICT",
    detail:
      "Calls open once you're connected: interest expressed and accepted.",
  },
  CALENDAR_NOT_CONNECTED: {
    code: "RESOURCE_CONFLICT",
    detail: "Connect Google in Settings to use your calendar.",
  },
  NO_RECIPIENTS: {
    code: "RESOURCE_CONFLICT",
    detail: "Nobody on the other side can be invited yet.",
  },
  CANCELLED: { code: "RESOURCE_CONFLICT", detail: "That call was cancelled." },
  INVALID_TIME: {
    code: "VALIDATION_FAILED",
    detail: "Choose a time in the future.",
  },
  KEY_REUSED: {
    code: "RESOURCE_CONFLICT",
    detail: "That request key was already used for something else. Try again.",
  },
  NOT_A_MEET_LINK: {
    code: "VALIDATION_FAILED",
    detail:
      "Q joins Google Meet calls: paste a link like https://meet.google.com/abc-defg-hij.",
  },
};

/** A schedule outcome as the problem the routes answer; null when it is OK. */
export function scheduleProblem(
  outcome: ScheduleOutcome<object>,
): { readonly code: KnownErrorCode; readonly detail: string } | null {
  if (outcome.outcome === "OK") return null;
  if (outcome.outcome === "FAILED") {
    // Google refused this person's access (a revoked grant, or calendar
    // not allowed when they connected): reconnecting is what fixes it.
    return outcome.code === "CALENDAR_UNAUTHORIZED" ||
      outcome.code === "CALENDAR_REJECTED"
      ? {
          code: "RESOURCE_CONFLICT",
          detail:
            "Google Calendar refused access. Reconnect Google in Settings and allow calendar access.",
        }
      : {
          code: "PROVIDER_UNAVAILABLE",
          detail: "Google Calendar didn't answer. Try again in a moment.",
        };
  }
  return REFUSALS[outcome.code];
}

const Meeting = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: ScheduleMeetingRequestSchema,
  })
  .strict();

const BOOK = defineAppAction<
  z.infer<typeof Meeting>,
  Awaited<ReturnType<ScheduleService["schedule"]>>
>({
  name: "schedule.meeting.book",
  short: "book a call",
  area: "schedule",
  classification: "CONSEQUENTIAL",
  does: "Books a call with the other side of a connected relationship, with a Meet link, as the schedule screen does.",
  input: Meeting,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    schedule(ports).schedule({
      actor: context.actor,
      relationshipId: input.relationshipId,
      purpose: input.input.purpose,
      startsAt: new Date(input.input.startsAt),
      durationMinutes: input.input.durationMinutes,
      timeZone: input.input.timeZone,
      // Scoped to the person, so two people's keys never collide.
      idempotencyKey: `web:${context.actor.userId}:${input.idempotencyKey}`,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input, names) => ({
    summary:
      names?.counterpart == null
        ? "Book this call"
        : `Book a call with ${names.counterpart}`,
    preview: `${input.input.purpose}\n${input.input.startsAt} (${input.input.timeZone}), ${String(input.input.durationMinutes)} minutes`,
  }),
  done: () => "Booked.",
  http: {
    method: "POST",
    path: RELATIONSHIP_MEETINGS_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    problem: scheduleProblem,
    status: (out) => (out.outcome === "OK" && out.alreadyScheduled ? 200 : 201),
    respond: (out) =>
      out.outcome === "OK" ? MeetingDtoSchema.parse(out.meeting) : undefined,
  },
  legacyTool: "propose_meeting",
});

const Cancel = z.object({ meetingId: z.string().max(64) }).strict();

const CANCEL = defineAppAction<
  z.infer<typeof Cancel>,
  Awaited<ReturnType<ScheduleService["cancel"]>>
>({
  name: "schedule.meeting.cancel",
  short: "cancel a call",
  area: "schedule",
  classification: "CONSEQUENTIAL",
  does: "Cancels a call they organised, as the schedule screen does; the other side is told.",
  input: Cancel,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    schedule(ports).cancel({
      actor: context.actor,
      meetingId: input.meetingId,
      correlationId: context.correlationId,
    }),
  targets: () => [],
  card: () => ({ summary: "Cancel this call", preview: "" }),
  done: () => "Cancelled.",
  http: {
    method: "POST",
    path: MEETING_CANCEL_PATH,
    fromRequest: (params) => ({ meetingId: params["meetingId"] }),
    problem: scheduleProblem,
    status: 204,
    respond: () => undefined,
  },
  legacyTool: "propose_meeting_change",
});

const Reminder = z
  .object({
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: CreateReminderRequestSchema,
  })
  .strict();

const REMIND = defineAppAction<
  z.infer<typeof Reminder>,
  Awaited<ReturnType<ScheduleService["createReminder"]>>
>({
  name: "schedule.reminder.create",
  short: "set a reminder",
  area: "schedule",
  classification: "CONSEQUENTIAL",
  does: "Sets a reminder for them, in the app or by email, as the reminders screen does.",
  input: Reminder,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    schedule(ports).createReminder({
      actor: context.actor,
      title: input.input.title,
      dueAt: new Date(input.input.dueAt),
      note: input.input.note,
      relationshipId: input.input.relationshipId,
      channel: input.input.channel,
      idempotencyKey: `web:${input.idempotencyKey}`,
    }),
  targets: () => [],
  card: () => ({ summary: "Set this reminder", preview: "" }),
  done: () => "Reminder set.",
  http: {
    method: "POST",
    path: REMINDERS_PATH,
    fromRequest: (_params, body, headers) => ({
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    problem: scheduleProblem,
    status: (out) => (out.outcome === "OK" && out.alreadyCreated ? 200 : 201),
    respond: (out) =>
      out.outcome === "OK" ? ReminderDtoSchema.parse(out.reminder) : undefined,
  },
  legacyTool: "propose_reminder",
});

const Dismiss = z.object({ reminderId: z.string().max(64) }).strict();

const DISMISS = defineAppAction<z.infer<typeof Dismiss>, boolean>({
  name: "schedule.reminder.dismiss",
  short: "dismiss a reminder",
  area: "schedule",
  classification: "INSTANT",
  does: "Dismisses one of their reminders, as the reminders screen does.",
  input: Dismiss,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    schedule(ports).dismissReminder(context.actor, input.reminderId),
  targets: () => [],
  card: () => ({ summary: "Dismiss this reminder", preview: "" }),
  done: () => "Dismissed.",
  http: {
    method: "POST",
    path: REMINDER_DISMISS_PATH,
    fromRequest: (params) => ({ reminderId: params["reminderId"] }),
    problem: (dismissed) => (dismissed ? null : REFUSALS.NOT_FOUND),
    status: 204,
    respond: () => undefined,
  },
  legacyTool: "dismiss_reminder",
});

const Join = z
  .object({
    relationshipId: z.string().max(64),
    input: JoinMeetingRequestSchema,
  })
  .strict();

const JoinTool = z
  .object({
    relationship: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Who the call is with: the company or investor as the person named it.",
      ),
    meetLink: z
      .string()
      .min(1)
      .max(300)
      .describe(
        "The Google Meet link exactly as they gave it (https://meet.google.com/abc-defg-hij).",
      ),
  })
  .strict();

/**
 * meet-47 (founder direction 2026-10-03): "Have Q join a call", on demand,
 * for either side. INSTANT: the person's own word -- the button, or "Q,
 * join this call: <link>" -- is the click, and it acts only as them, on a
 * relationship they are a party to. Q joins Google Meet links only, as the
 * same note-taker with the same consent line and record as a booked call.
 */
const JOIN = defineAppAction<
  z.infer<typeof Join>,
  Awaited<ReturnType<ScheduleService["joinCall"]>>,
  z.infer<typeof JoinTool>
>({
  name: "schedule.meeting.join",
  short: "have Q join a call",
  area: "schedule",
  classification: "INSTANT",
  does: "Sends Q into a Google Meet call already running with the other side of a connected relationship, to keep the record for both sides, as the meeting record's button does.",
  input: Join,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    schedule(ports).joinCall({
      actor: context.actor,
      relationshipId: input.relationshipId,
      meetLink: input.input.meetLink,
      purpose: input.input.purpose,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: () => ({ summary: "Have Q join this call", preview: "" }),
  succeeded: (out) => out.outcome === "OK",
  done: (out) =>
    out.outcome !== "OK"
      ? (scheduleProblem(out)?.detail ?? "Q couldn't join that call.")
      : out.alreadyJoined
        ? 'I\'m already on my way into that call. Admit "Q (Capital Q notes)" from the lobby when I knock.'
        : 'On my way into the call now. Admit "Q (Capital Q notes)" from the lobby when I knock; I\'ll keep the record for both sides.',
  http: {
    method: "POST",
    path: RELATIONSHIP_MEETING_JOIN_PATH,
    fromRequest: (params, body) => ({
      relationshipId: params["relationshipId"],
      input: body,
    }),
    problem: scheduleProblem,
    status: (out) => (out.outcome === "OK" && out.alreadyJoined ? 200 : 201),
    respond: (out) =>
      out.outcome === "OK" ? MeetingDtoSchema.parse(out.meeting) : undefined,
  },
  tool: {
    name: "join_call",
    description:
      'Use when the person asks Q to join a call that is happening now ("Q, join this call: https://meet.google.com/abc-defg-hij"). Sends Q into that Google Meet as "Q (Capital Q notes)" to keep the record for both sides, at once: their word is the click. Google Meet links only. Name who the call is with as they said it; if they did not say, ask.',
    input: JoinTool,
    references: { relationship: "RELATIONSHIP" },
    // The unfocused ACTION_PREPARATION offer is full (MODEL_TOOLS_MAX); the
    // turn reader names it from its action list ("have Q join a call"),
    // and a named declared tool is eligible on any purpose.
    purposes: ["GENERAL_QUESTION"],
    eval: {
      say: [
        "Q, join my call with {name}: https://meet.google.com/abc-defg-hij",
        "Can you sit in on the call with {name}? It's https://meet.google.com/abc-defg-hij",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: (tool) => {
      const link = googleMeetLink(tool.meetLink);
      return Promise.resolve(
        link === null
          ? refusal(REFUSALS.NOT_A_MEET_LINK.detail)
          : { relationshipId: tool.relationship, input: { meetLink: link } },
      );
    },
  },
});

export const SCHEDULE_ACTIONS: readonly AnyAppAction[] = [
  BOOK,
  JOIN,
  CANCEL,
  REMIND,
  DISMISS,
];
