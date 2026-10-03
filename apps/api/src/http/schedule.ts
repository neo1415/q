import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  MarkNotificationsReadRequestSchema,
  MEETING_BRIEF_PATH,
  MeetingBriefDtoSchema,
  MeetingListSchema,
  MeetingSlotsRequestSchema,
  MeetingSlotsResponseSchema,
  NOTIFICATIONS_PATH,
  NOTIFICATIONS_READ_PATH,
  NotificationDtoSchema,
  NotificationListSchema,
  parseContract,
  PROBLEM_CONTENT_TYPE,
  RELATIONSHIP_MEETING_SLOTS_PATH,
  RELATIONSHIP_MEETINGS_PATH,
  REMINDERS_PATH,
  ReminderListSchema,
  type ProblemDetails,
} from "@capital-q/contracts";
import { scheduleProblem } from "@capital-q/app-actions";
import type {
  ScheduleOutcome,
  ScheduleService,
} from "@capital-q/communication";

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

function send(reply: FastifyReply, problem: ProblemDetails) {
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

/** The schedule service's refusals, as the generated routes answer them. */
function problemFor(
  request: FastifyRequest,
  outcome: Exclude<ScheduleOutcome<object>, { outcome: "OK" }>,
): ProblemDetails {
  const problem = scheduleProblem(outcome) ?? {
    code: "RESOURCE_NOT_FOUND" as const,
    detail: "Not found.",
  };
  return createProblemDetails({
    code: problem.code,
    requestId: request.id,
    detail: problem.detail,
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

  app.get(
    NOTIFICATIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const own = await schedule.listNotifications(getActorContext(request));
      void reply.header("Cache-Control", "no-store");
      // A row the contract can't describe (a kind the table accepts before the
      // contract learns it) is skipped and logged, never allowed to fail the
      // whole list.
      const items = own.items.flatMap((item) => {
        const parsed = NotificationDtoSchema.safeParse({
          id: item.id,
          kind: item.kind,
          title: item.title,
          body: item.body,
          linkPath: item.linkPath,
          read: item.readAt !== null,
          createdAt: item.createdAt.toISOString(),
          priority: item.priority ?? "UPDATE",
        });
        if (parsed.success) return [parsed.data];
        request.log.warn(
          { notificationId: item.id, kind: item.kind },
          "notification skipped: outside the contract",
        );
        return [];
      });
      return NotificationListSchema.parse({ unread: own.unread, items });
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
