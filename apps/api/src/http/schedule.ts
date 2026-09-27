import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  CreateReminderRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MarkNotificationsReadRequestSchema,
  MEETING_BRIEF_PATH,
  MEETING_CANCEL_PATH,
  MeetingBriefDtoSchema,
  MeetingDtoSchema,
  MeetingListSchema,
  MeetingSlotsRequestSchema,
  MeetingSlotsResponseSchema,
  NOTIFICATIONS_PATH,
  NOTIFICATIONS_READ_PATH,
  NotificationListSchema,
  parseContract,
  PROBLEM_CONTENT_TYPE,
  RELATIONSHIP_MEETING_SLOTS_PATH,
  RELATIONSHIP_MEETINGS_PATH,
  REMINDER_DISMISS_PATH,
  REMINDERS_PATH,
  ReminderDtoSchema,
  ReminderListSchema,
  ScheduleMeetingRequestSchema,
  type ProblemDetails,
} from "@capital-q/contracts";
import type {
  ScheduleOutcome,
  ScheduleRefusal,
  ScheduleService,
} from "@capital-q/communication";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Meetings, reminders and notifications (BIZ-008) — the person's own page
 * controls for what Q can also do (R33: every capability has its screen).
 *
 * Every id is input. The schedule service asks Network, as the caller,
 * whether they are a party; a non-party and an unknown id are one 404.
 * Booking and cancelling here are the person's own confirmed click on the
 * exact slot and purpose shown (the screen's confirm step is the approval);
 * both are idempotent by the Idempotency-Key. The Meet link is returned
 * only to people who were invited.
 */

export type ScheduleRoutesDependencies = ActorContextDependencies & {
  readonly schedule: ScheduleService;
};

function param(request: FastifyRequest, name: string): string {
  const raw = (request.params as Record<string, unknown>)[name];
  return typeof raw === "string" ? raw : "";
}

function idempotencyKeyOf(request: FastifyRequest): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  return parseContract(
    IdempotencyKeyHeaderSchema,
    typeof raw === "string" ? raw : undefined,
    "An Idempotency-Key header is required.",
  );
}

function send(reply: FastifyReply, problem: ProblemDetails) {
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

const REFUSALS: Readonly<
  Record<
    ScheduleRefusal,
    {
      readonly code:
        | "RESOURCE_NOT_FOUND"
        | "RESOURCE_CONFLICT"
        | "PROVIDER_UNAVAILABLE"
        | "VALIDATION_FAILED";
      readonly detail: string;
    }
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
};

function problemFor(
  request: FastifyRequest,
  outcome: Exclude<ScheduleOutcome<object>, { outcome: "OK" }>,
): ProblemDetails {
  if (outcome.outcome === "FAILED") {
    return createProblemDetails({
      code: "PROVIDER_UNAVAILABLE",
      requestId: request.id,
      detail: "Google Calendar didn't answer. Try again in a moment.",
    });
  }
  const refusal = REFUSALS[outcome.code];
  return createProblemDetails({
    code: refusal.code,
    requestId: request.id,
    detail: refusal.detail,
  });
}

export function registerScheduleRoutes(
  app: FastifyInstance,
  dependencies: ScheduleRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { schedule } = dependencies;

  app.get(
    RELATIONSHIP_MEETINGS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const items = await schedule.listMeetings(
        getActorContext(request),
        param(request, "relationshipId"),
      );
      if (items === null) {
        return send(
          reply,
          problemFor(request, { outcome: "REFUSED", code: "NOT_FOUND" }),
        );
      }
      void reply.header("Cache-Control", "no-store");
      return MeetingListSchema.parse({ items });
    },
  );

  app.post(
    RELATIONSHIP_MEETING_SLOTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        MeetingSlotsRequestSchema,
        request.body ?? {},
        "The slot request is not valid.",
      );
      const found = await schedule.findSlots({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
        from: input.from === undefined ? undefined : new Date(input.from),
        to: input.to === undefined ? undefined : new Date(input.to),
        durationMinutes: input.durationMinutes,
        timeZone: input.timeZone,
      });
      if (found.outcome !== "OK")
        return send(reply, problemFor(request, found));
      void reply.header("Cache-Control", "no-store");
      return MeetingSlotsResponseSchema.parse({
        timeZone: found.timeZone,
        slots: found.slots.map((slot) => ({
          startsAt: slot.start.toISOString(),
          endsAt: slot.end.toISOString(),
        })),
      });
    },
  );

  app.post(
    RELATIONSHIP_MEETINGS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(request);
      const input = parseContract(
        ScheduleMeetingRequestSchema,
        request.body,
        "The meeting is not valid.",
      );
      const actor = getActorContext(request);
      const booked = await schedule.schedule({
        actor,
        relationshipId: param(request, "relationshipId"),
        purpose: input.purpose,
        startsAt: new Date(input.startsAt),
        durationMinutes: input.durationMinutes,
        timeZone: input.timeZone,
        // Scoped to the person, so two people's keys never collide.
        idempotencyKey: `web:${actor.userId}:${idempotencyKey}`,
        correlationId: createCorrelationId(),
      });
      if (booked.outcome !== "OK")
        return send(reply, problemFor(request, booked));
      void reply
        .status(booked.alreadyScheduled ? 200 : 201)
        .header("Cache-Control", "no-store");
      return MeetingDtoSchema.parse(booked.meeting);
    },
  );

  app.post(
    MEETING_CANCEL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const cancelled = await schedule.cancel({
        actor: getActorContext(request),
        meetingId: param(request, "meetingId"),
        correlationId: createCorrelationId(),
      });
      if (cancelled.outcome !== "OK") {
        return send(reply, problemFor(request, cancelled));
      }
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  app.get(
    MEETING_BRIEF_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const meetingId = param(request, "meetingId");
      const brief = await schedule.brief(getActorContext(request), meetingId);
      if (brief === null) {
        return send(
          reply,
          problemFor(request, { outcome: "REFUSED", code: "NOT_FOUND" }),
        );
      }
      void reply.header("Cache-Control", "no-store");
      return MeetingBriefDtoSchema.parse({
        meetingId,
        body: brief.body,
        createdAt: brief.createdAt.toISOString(),
      });
    },
  );

  app.get(
    REMINDERS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      void reply.header("Cache-Control", "no-store");
      return ReminderListSchema.parse({
        items: await schedule.listReminders(getActorContext(request)),
      });
    },
  );

  app.post(
    REMINDERS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(request);
      const input = parseContract(
        CreateReminderRequestSchema,
        request.body,
        "The reminder is not valid.",
      );
      const created = await schedule.createReminder({
        actor: getActorContext(request),
        title: input.title,
        dueAt: new Date(input.dueAt),
        note: input.note,
        relationshipId: input.relationshipId,
        channel: input.channel,
        idempotencyKey: `web:${idempotencyKey}`,
      });
      if (created.outcome !== "OK")
        return send(reply, problemFor(request, created));
      void reply
        .status(created.alreadyCreated ? 200 : 201)
        .header("Cache-Control", "no-store");
      return ReminderDtoSchema.parse(created.reminder);
    },
  );

  app.post(
    REMINDER_DISMISS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const dismissed = await schedule.dismissReminder(
        getActorContext(request),
        param(request, "reminderId"),
      );
      if (!dismissed) {
        return send(
          reply,
          problemFor(request, { outcome: "REFUSED", code: "NOT_FOUND" }),
        );
      }
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  app.get(
    NOTIFICATIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const own = await schedule.listNotifications(getActorContext(request));
      void reply.header("Cache-Control", "no-store");
      return NotificationListSchema.parse({
        unread: own.unread,
        items: own.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          body: item.body,
          linkPath: item.linkPath,
          read: item.readAt !== null,
          createdAt: item.createdAt.toISOString(),
        })),
      });
    },
  );

  app.post(
    NOTIFICATIONS_READ_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        MarkNotificationsReadRequestSchema,
        request.body,
        "The read request is not valid.",
      );
      await schedule.markNotificationsRead(getActorContext(request), input.ids);
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );
}
