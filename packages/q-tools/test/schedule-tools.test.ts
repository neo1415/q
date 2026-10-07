import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_RECONNECT_PATH,
  type PermittedContextPlan,
} from "@capital-q/contracts";

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
  options: {
    calendarZone?: string | null;
    calendarConnected?: boolean;
    calendarRevoked?: boolean;
    counterpartCanHost?: boolean;
    profileZone?: string | null;
    findSlots?: ScheduleIntelligencePort["findSlots"];
  } = {},
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
    findSlots:
      options.findSlots ??
      (() =>
        Promise.resolve({
          status: "OK",
          timeZone: "Europe/London",
          slots: [
            {
              start: new Date("2026-10-06T08:00:00Z"),
              end: new Date("2026-10-06T08:30:00Z"),
            },
          ],
        })),
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
    profileTimeZoneOf: () => Promise.resolve(options.profileZone ?? null),
    canSchedule: () =>
      Promise.resolve(
        options.calendarRevoked === true
          ? "CALENDAR_REVOKED"
          : options.calendarConnected === false
            ? "CALENDAR_NOT_CONNECTED"
            : "OK",
      ),
    counterpartCanHost: () =>
      Promise.resolve(options.counterpartCanHost === true),
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

  it("with no calendar, says so, still suggests three unchecked times and carries the connect card (Q room R5)", async () => {
    const { executor } = world({
      calendarConnected: false,
      findSlots: () =>
        Promise.resolve({
          status: "CALENDAR_NOT_CONNECTED",
          suggested: {
            timeZone: "Europe/London",
            slots: [
              {
                start: new Date("2026-10-13T09:00:00Z"),
                end: new Date("2026-10-13T09:30:00Z"),
              },
              {
                start: new Date("2026-10-14T13:00:00Z"),
                end: new Date("2026-10-14T13:30:00Z"),
              },
              {
                start: new Date("2026-10-15T10:00:00Z"),
                end: new Date("2026-10-15T10:30:00Z"),
              },
            ],
          },
        }),
    });
    const outcome = await executor.execute(
      {
        callId: "s1c",
        name: "find_meeting_times",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "CALENDAR_NOT_CONNECTED",
        checked: false,
        timeZone: "Europe/London",
        slots: [
          { local: "Tue 13 Oct, 10:00" },
          { local: "Wed 14 Oct, 14:00" },
          { local: "Thu 15 Oct, 11:00" },
        ],
        clientAction: {
          kind: "SHOW_CALENDAR_CONNECT",
          reason: "NOT_CONNECTED",
          counterpartName: "Apex",
          timeZone: "Europe/London",
        },
      },
    });
    const data = (outcome.result as { data: { says: string } }).data;
    expect(data.says).toContain("Your Google Calendar isn't connected");
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

    it("autopilot P1: without Calendar, no invite is prepared -- the time is proposed in the chat instead, never a dead end", async () => {
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
      // No calendar invite: a chat message proposing the time, for approval.
      expect(prepared.map((one) => one.actionType)).toEqual([
        "chat.message.send",
      ]);
      const body = (prepared[0]?.payload as { body: string }).body;
      expect(body).toMatch(
        /^Would .+ \(Europe\/London\) work for a 30-minute call/u,
      );
      expect(body).toContain("suggest one here");
      const data = (
        outcome.result as { data: { status: string; says: string } }
      ).data;
      expect(data.status).toBe("CALENDAR_NOT_CONNECTED");
      expect(data.says).toContain("Your Google Calendar isn't connected");
      expect(data.says).toContain("drafted a message proposing the time");
    });

    it("says a revoked calendar plainly, with the reconnect link and the paste-a-link alternative (meetfix-57)", async () => {
      const { executor, prepared } = world({ calendarRevoked: true });
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
      expect(prepared.map((one) => one.actionType)).toEqual([
        "chat.message.send",
      ]);
      const data = (
        outcome.result as { data: { status: string; says: string } }
      ).data;
      expect(data.status).toBe("CALENDAR_REVOKED");
      const [first, second] = data.says.split("\n");
      expect(first).toContain(
        "Your Google Calendar connection expired, so I can't create the Meet link.",
      );
      expect(first).toContain(`(${GOOGLE_RECONNECT_PATH})`);
      expect(second).toMatch(
        /^Or paste a Meet link and I'll set it up and join\. Meanwhile I've drafted a message proposing the time/u,
      );
    });

    it("offers that the other side host when their calendar is connected (meetfix-57)", async () => {
      const { executor } = world({
        calendarConnected: false,
        counterpartCanHost: true,
      });
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
      const data = (
        outcome.result as { data: { status: string; says: string } }
      ).data;
      expect(data.status).toBe("CALENDAR_NOT_CONNECTED");
      expect(data.says).toContain("Your Google Calendar isn't connected");
      expect(data.says).toContain("Or Apex can host");
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

  // Live 2026-10-01: "remind me tomorrow at 9:00" for a founder in Lagos
  // was set for 09:00 UTC; the browser had reported UTC.
  describe("the zone a reminder is set in (live 2026-10-01)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    const remind = {
      callId: "t4",
      name: "propose_reminder",
      arguments: { title: "Prep", when: { day: "tomorrow", time: "09:00" } },
    };
    const on = (timeZone?: string) => ({
      ...ownPlan(),
      screen: {
        route: "HOME" as const,
        ...(timeZone === undefined ? {} : { timeZone }),
      },
    });

    it("uses the zone saved on their profile before the device's, and the card names it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-01T18:00:00Z"));
      const { executor, prepared } = world({ profileZone: "Africa/Lagos" });
      const outcome = await executor.execute(
        remind,
        contextFor(actorB, on("Europe/Paris")),
      );
      expect(prepared).toMatchObject([
        {
          payload: {
            remindAt: "2026-10-02T08:00:00.000Z",
            timeZone: "Africa/Lagos",
          },
        },
      ]);
      expect(JSON.stringify(outcome.result)).toContain("(Africa/Lagos)");
    });

    it("does not take a device's bare UTC as where they are: asks once and offers to save it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-01T18:00:00Z"));
      for (const zone of ["UTC", "Etc/UTC", "GMT"]) {
        const { executor, prepared } = world();
        const outcome = await executor.execute(
          remind,
          contextFor(actorB, on(zone)),
        );
        expect(prepared, zone).toEqual([]);
        const said = JSON.stringify(outcome.result);
        expect(said).toContain("time zone is not known");
        expect(said).toContain("update_my_profile");
        expect(said).toContain("Never assume UTC");
      }
    });

    it("still uses a real device zone when nothing is saved", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-01T18:00:00Z"));
      const { executor, prepared } = world();
      await executor.execute(remind, contextFor(actorB, on("Africa/Lagos")));
      expect(prepared).toMatchObject([
        { payload: { remindAt: "2026-10-02T08:00:00.000Z" } },
      ]);
    });

    it("uses UTC when they say UTC themselves", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-01T18:00:00Z"));
      const { executor, prepared } = world();
      await executor.execute(
        {
          ...remind,
          arguments: { ...remind.arguments, timeZone: "UTC" },
        },
        contextFor(actorB, on("UTC")),
      );
      expect(prepared).toMatchObject([
        { payload: { remindAt: "2026-10-02T09:00:00.000Z", timeZone: "UTC" } },
      ]);
    });
  });

  // QA run f99e507c (investor.savanna-seed, no time zone): "Remind me on
  // Monday at 10am to review Tallyloom's deck." was refused.
  describe("a reminder about someone they are not in touch with, time zone unknown (f99e507c)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    const asked = {
      callId: "f99e507c",
      name: "propose_reminder",
      arguments: {
        title: "Review Tallyloom's deck",
        when: { day: "monday", time: "10:00" },
        counterpartName: "Tallyloom",
      },
    };

    it("asks one short question for their city; nothing refused, nothing prepared yet", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-03T17:38:13Z"));
      const { executor, prepared } = world();
      const outcome = await executor.execute(
        asked,
        contextFor(actorA, ownPlan(actorA)),
      );
      expect(prepared).toEqual([]);
      expect(outcome.result).toMatchObject({
        ok: true,
        data: {
          status: "NEEDS_TIME_ZONE",
          says: "Which city are you in, so Monday at 10:00 is right? Then I'll set the reminder.",
        },
      });
      expect(JSON.stringify(outcome.result)).not.toMatch(/can.t/iu);
    });

    it("the city they gave, as they said it, is their zone (QA a87ca38f)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-03T17:38:13Z"));
      const { executor, prepared } = world();
      await executor.execute(
        { ...asked, arguments: { ...asked.arguments, timeZone: "Lagos" } },
        contextFor(actorA, ownPlan(actorA)),
      );
      expect(prepared).toMatchObject([
        {
          payload: {
            remindAt: "2026-10-05T09:00:00.000Z",
            timeZone: "Africa/Lagos",
          },
        },
      ]);
    });

    it("with their city, prepares it as their own reminder, the name in its title", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-03T17:38:13Z"));
      const { executor, prepared } = world();
      await executor.execute(
        {
          ...asked,
          arguments: { ...asked.arguments, timeZone: "Africa/Lagos" },
        },
        contextFor(actorA, ownPlan(actorA)),
      );
      expect(prepared).toMatchObject([
        {
          actionType: "reminder.create",
          payload: {
            title: "Review Tallyloom's deck",
            remindAt: "2026-10-05T09:00:00.000Z",
            timeZone: "Africa/Lagos",
          },
        },
      ]);
      expect(
        (prepared[0]?.payload as { relationshipId?: string }).relationshipId,
      ).toBeUndefined();
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

describe("zoneFromWords: a place as they said it", () => {
  it("names one IANA zone, or none", async () => {
    const { zoneFromWords } = await import("../src/index.js");
    expect(zoneFromWords("Lagos")).toBe("Africa/Lagos");
    expect(zoneFromWords("I'm in Abuja.")).toBe("Africa/Lagos");
    expect(zoneFromWords("Port Harcourt")).toBe("Africa/Lagos");
    expect(zoneFromWords("New York")).toBe("America/New_York");
    expect(zoneFromWords("london")).toBe("Europe/London");
    expect(zoneFromWords("Europe/London")).toBe("Europe/London");
    expect(zoneFromWords("Nairobi, Kenya")).toBe("Africa/Nairobi");
    expect(zoneFromWords("sounds good")).toBeNull();
    expect(zoneFromWords("")).toBeNull();
  });
});
