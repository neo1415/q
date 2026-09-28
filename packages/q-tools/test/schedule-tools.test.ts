import { afterEach, describe, expect, it, vi } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type ChatIntelligencePort,
  type RelationshipIntelligencePort,
  type ScheduleIntelligencePort,
} from "../src/index.js";
import { actorA, actorB, contextFor, fakePorts, planFor } from "./support.js";

/**
 * BIZ-008 schedule tools: Q finds times and prepares calls, changes and
 * reminders only for what the firewall bound and the invoker may act on;
 * nothing is booked, moved or sent without approval.
 */

const RELATIONSHIP = "88888888-0000-4000-8000-0000000000c1";
const MEETING = "88888888-0000-4000-8000-0000000000d1";

function relationshipPlan(
  base: PermittedContextPlan,
  relationshipId: string,
): PermittedContextPlan {
  const template = base.scopes[0];
  if (template === undefined) throw new Error("plan has no scope");
  return {
    ...base,
    purpose: { ...base.purpose, taskClass: "RELATIONSHIP_QUESTION" },
    subjects: [{ kind: "RELATIONSHIP", relationshipId }],
    scopes: [
      ...base.scopes,
      {
        ...template,
        kind: "RELATIONSHIP_CONTEXT",
        subject: { kind: "RELATIONSHIP", relationshipId },
        contextLabel: "relationship_shared",
        filter: {
          tenantId: base.tenantId,
          relationshipIds: [relationshipId],
          contextLabels: ["investor_private", "relationship_shared"],
        },
      },
    ],
  };
}

function ownPlan(actor = actorB): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

function world(
  options: { calendarZone?: string | null; calendarConnected?: boolean } = {},
) {
  const prepared: { actionType: string; payload: unknown }[] = [];
  const chat: ChatIntelligencePort = {
    thread: (actor, relationshipId) =>
      Promise.resolve(
        actor.userId === actorB.userId && relationshipId === RELATIONSHIP
          ? { connected: true, counterpartName: "Apex", messages: [] }
          : null,
      ),
    prepareForApproval: (entry) => {
      prepared.push(entry.proposal);
      return "PREPARED";
    },
  };
  const schedule: ScheduleIntelligencePort = {
    findSlots: () =>
      Promise.resolve({
        status: "OK",
        timeZone: "Europe/London",
        slots: [
          {
            start: new Date("2026-10-06T08:00:00Z"),
            end: new Date("2026-10-06T08:30:00Z"),
          },
        ],
      }),
    upcoming: () =>
      Promise.resolve({
        meetings: [
          {
            id: MEETING,
            relationshipId: RELATIONSHIP,
            purpose: "Intro",
            startsAt: "2026-10-06T08:00:00.000Z",
            endsAt: "2026-10-06T08:30:00.000Z",
            timeZone: "Europe/London",
            organisedByYou: true,
            attendees: ["Ada"],
            hasBrief: false,
          },
        ],
        reminders: [],
      }),
    organisedMeeting: (actor, meetingId) =>
      Promise.resolve(
        actor.userId === actorB.userId && meetingId === MEETING
          ? {
              id: MEETING,
              relationshipId: RELATIONSHIP,
              purpose: "Intro",
              startsAt: "2026-10-06T08:00:00.000Z",
              endsAt: "2026-10-06T08:30:00.000Z",
              status: "SCHEDULED",
            }
          : null,
      ),
    brief: () => Promise.resolve(null),
    timeZoneOf: () => Promise.resolve(options.calendarZone ?? null),
    canSchedule: () =>
      Promise.resolve(
        options.calendarConnected === false ? "CALENDAR_NOT_CONNECTED" : "OK",
      ),
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(
      createDefaultQTools(
        fakePorts({
          chat,
          schedule,
          relationships: {} as RelationshipIntelligencePort,
        }),
      ),
    ),
  });
  return { executor, prepared };
}

const base = (actor: typeof actorA) =>
  planFor(actor, "GENERAL_QUESTION", [
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  ]);

describe("schedule tools", () => {
  it("finds times for a bound relationship, labelled in the organiser's zone", async () => {
    const { executor } = world();
    const outcome = await executor.execute(
      {
        callId: "s1",
        name: "find_meeting_times",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "OK",
        counterpartName: "Apex",
        slots: [
          { startsAt: "2026-10-06T08:00:00.000Z", local: "Tue 6 Oct, 09:00" },
        ],
      },
    });
  });

  it("gives a non-party nothing", async () => {
    const { executor } = world();
    const outcome = await executor.execute(
      {
        callId: "s2",
        name: "find_meeting_times",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(actorA, relationshipPlan(base(actorA), RELATIONSHIP)),
    );
    expect(outcome.status).toBe("DENIED");
  });

  it("prepares a personal reminder with no relationship, by email by default", async () => {
    const { executor, prepared } = world();
    await executor.execute(
      {
        callId: "s3",
        name: "propose_reminder",
        arguments: {
          title: "Follow up with Apex",
          remindAt: "2026-10-09T08:00:00.000Z",
        },
      },
      contextFor(actorB, ownPlan()),
    );
    expect(prepared).toEqual([
      {
        actionType: "reminder.create",
        payload: {
          ownerUserId: actorB.userId,
          title: "Follow up with Apex",
          remindAt: "2026-10-09T08:00:00.000Z",
          channel: "EMAIL",
        },
      },
    ]);
  });

  it("prepares a move and a cancel only for a call the invoker organised", async () => {
    const { executor, prepared } = world();
    await executor.execute(
      {
        callId: "s4",
        name: "propose_meeting_change",
        arguments: {
          meetingId: MEETING,
          change: "RESCHEDULE",
          startsAt: "2026-10-07T12:00:00.000Z",
        },
      },
      contextFor(actorB, ownPlan()),
    );
    const denied = await executor.execute(
      {
        callId: "s5",
        name: "propose_meeting_change",
        arguments: { meetingId: MEETING, change: "CANCEL" },
      },
      contextFor(actorA, ownPlan(actorA)),
    );
    expect(denied.status).toBe("DENIED");
    expect(prepared).toEqual([
      {
        actionType: "meeting.reschedule",
        payload: {
          meetingId: MEETING,
          relationshipId: RELATIONSHIP,
          purpose: "Intro",
          startsAt: "2026-10-07T12:00:00.000Z",
          durationMinutes: 30,
        },
      },
    ]);
  });

  describe("a time as they said it (live 2026-09-28 #2)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    const withZone = (plan: PermittedContextPlan, timeZone?: string) => ({
      ...plan,
      screen: {
        route: "HOME" as const,
        ...(timeZone === undefined ? {} : { timeZone }),
      },
    });
    const meetingAt = (when: Record<string, string>) => ({
      callId: "t1",
      name: "propose_meeting",
      arguments: { relationshipId: RELATIONSHIP, purpose: "Intro", when },
    });

    it("books 2 PM tomorrow in the zone their device sent, never refused", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
      const { executor, prepared } = world();
      const outcome = await executor.execute(
        meetingAt({ day: "tomorrow", time: "14:00" }),
        contextFor(
          actorB,
          withZone(
            relationshipPlan(base(actorB), RELATIONSHIP),
            "Europe/London",
          ),
        ),
      );
      expect(outcome.result).toMatchObject({
        ok: true,
        data: {
          status: "PREPARED",
          awaitingApprovalOf:
            "Call with Apex, Tue 29 Sept, 14:00 (Europe/London)",
        },
      });
      expect(prepared).toEqual([
        {
          actionType: "meeting.schedule",
          payload: {
            relationshipId: RELATIONSHIP,
            counterpartName: "Apex",
            purpose: "Intro",
            startsAt: "2026-09-29T13:00:00.000Z",
            durationMinutes: 30,
            timeZone: "Europe/London",
          },
        },
      ]);
    });

    it("falls back to their calendar's zone, then asks rather than using UTC", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
      const calendar = world({ calendarZone: "America/New_York" });
      await calendar.executor.execute(
        meetingAt({ day: "tomorrow", time: "14:00" }),
        contextFor(
          actorB,
          withZone(relationshipPlan(base(actorB), RELATIONSHIP)),
        ),
      );
      expect(calendar.prepared).toMatchObject([
        {
          payload: {
            startsAt: "2026-09-29T18:00:00.000Z",
            timeZone: "America/New_York",
          },
        },
      ]);

      const none = world();
      const refused = await none.executor.execute(
        meetingAt({ day: "tomorrow", time: "14:00" }),
        contextFor(
          actorB,
          withZone(relationshipPlan(base(actorB), RELATIONSHIP)),
        ),
      );
      expect(none.prepared).toEqual([]);
      expect(JSON.stringify(refused.result)).toContain(
        "time zone is not known",
      );
    });

    it("says Calendar is not connected before anything is prepared", async () => {
      const { executor, prepared } = world({ calendarConnected: false });
      const outcome = await executor.execute(
        meetingAt({ day: "tomorrow", time: "14:00" }),
        contextFor(
          actorB,
          withZone(
            relationshipPlan(base(actorB), RELATIONSHIP),
            "Europe/London",
          ),
        ),
      );
      expect(prepared).toEqual([]);
      expect(outcome.result).toMatchObject({
        ok: true,
        data: { status: "CALENDAR_NOT_CONNECTED" },
      });
    });

    it("sets a reminder for Friday 9 AM in their zone", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
      const { executor, prepared } = world();
      await executor.execute(
        {
          callId: "t3",
          name: "propose_reminder",
          arguments: {
            title: "Follow up",
            when: { day: "friday", time: "09:00" },
          },
        },
        contextFor(actorB, withZone(ownPlan(), "Asia/Singapore")),
      );
      expect(prepared).toMatchObject([
        {
          actionType: "reminder.create",
          payload: {
            ownerUserId: actorB.userId,
            remindAt: "2026-10-02T01:00:00.000Z",
            timeZone: "Asia/Singapore",
          },
        },
      ]);
    });
  });

  it("lists the invoker's own schedule", async () => {
    const { executor } = world();
    const outcome = await executor.execute(
      { callId: "s6", name: "list_schedule", arguments: {} },
      contextFor(actorB, ownPlan()),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { meetings: [{ id: MEETING, with: ["Ada"], brief: null }] },
    });
  });
});
