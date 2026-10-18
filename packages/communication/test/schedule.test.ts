import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  createScheduleService,
  googleEventIdFor,
  proposeSlots,
  type ChatParty,
} from "../src/index.js";
import {
  createFakeAppEmail,
  createFakeCalendar,
  createInMemoryScheduleStore,
  createRecordingMeetingActivity,
  createStaticMeetingDirectory,
  inlineScheduleTransactions,
} from "../src/testing/index.js";

/**
 * BIZ-008 against fakes: no Google, no SMTP, no model. Slots, the
 * approved schedule (idempotent, counterparty-only invitees, activity,
 * T-15 reminder), organiser-only move/cancel, reminders delivered in-app
 * and by email, and the T-24h prep brief.
 */

const REL = "00000000-0000-4000-8000-00000000c001";
const COMPANY_TENANT = "00000000-0000-4000-8000-0000000000a1";
const INVESTOR_TENANT = "00000000-0000-4000-8000-0000000000a2";

function actor(userId: string, tenantId: string): ActorContext {
  return {
    userId,
    tenantId,
    organisationId: "00000000-0000-4000-8000-0000000000c1",
    membershipId: "00000000-0000-4000-8000-0000000000e1",
    actorType: "HUMAN",
  } as ActorContext;
}

const INVESTOR = actor("00000000-0000-4000-8000-0000000000b1", INVESTOR_TENANT);
const FOUNDER = actor("00000000-0000-4000-8000-0000000000f1", COMPANY_TENANT);
const STRANGER = actor("00000000-0000-4000-8000-0000000000e9", INVESTOR_TENANT);

// Monday 5 October 2026, 08:00 London (07:00 UTC).
const NOW = new Date("2026-10-05T07:00:00Z");

type CalendarFixture = "CONNECTED" | "NOT_CONNECTED" | "REVOKED";

function world(
  options: {
    connected?: boolean;
    now?: Date;
    state?: string;
    /** meetfix-57: each side's calendar as stored; default connected. */
    calendarsOf?: Partial<Record<string, CalendarFixture>>;
  } = {},
) {
  const stateOf = (userId: string): CalendarFixture =>
    options.calendarsOf?.[userId] ?? "CONNECTED";
  let clock = options.now ?? NOW;
  const store = createInMemoryScheduleStore({ now: () => clock });
  const activity = createRecordingMeetingActivity();
  const email = createFakeAppEmail();
  const investorCalendar = createFakeCalendar("ben@vc.example.invalid");
  const founderCalendar = createFakeCalendar("ada@co.example.invalid");
  const parties = (a: ActorContext, relationshipId: string) => {
    if (relationshipId !== REL) return Promise.resolve(null);
    const party: ChatParty | null =
      a.userId === INVESTOR.userId
        ? {
            side: "INVESTOR",
            connected: options.connected ?? true,
            state: options.state,
          }
        : a.userId === FOUNDER.userId
          ? {
              side: "COMPANY",
              connected: options.connected ?? true,
              state: options.state,
            }
          : null;
    return Promise.resolve(party);
  };
  let ids = 0;
  const service = createScheduleService({
    store,
    transactions: inlineScheduleTransactions,
    parties,
    directory: createStaticMeetingDirectory({
      relationshipTenant: COMPANY_TENANT,
      people: {
        COMPANY: [
          {
            userId: FOUNDER.userId,
            tenantId: COMPANY_TENANT,
            name: "Ada",
            email: "ada@co.example.invalid",
          },
        ],
        INVESTOR_ORGANISATION: [
          {
            userId: INVESTOR.userId,
            tenantId: INVESTOR_TENANT,
            name: "Ben",
            email: "ben@vc.example.invalid",
          },
        ],
      },
      persons: {
        [INVESTOR.userId]: { name: "Ben", email: "ben@vc.example.invalid" },
        [FOUNDER.userId]: { name: "Ada", email: "ada@co.example.invalid" },
      },
    }),
    calendars: (userId) =>
      Promise.resolve(
        stateOf(userId) !== "CONNECTED"
          ? null
          : userId === INVESTOR.userId
            ? investorCalendar
            : userId === FOUNDER.userId
              ? founderCalendar
              : null,
      ),
    calendarState: (userId) => Promise.resolve(stateOf(userId)),
    activity,
    email,
    now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
  return {
    service,
    store,
    activity,
    email,
    investorCalendar,
    founderCalendar,
    advance: (to: Date) => {
      clock = to;
    },
  };
}

const SCHEDULE = {
  actor: INVESTOR,
  relationshipId: REL,
  purpose: "Intro call",
  startsAt: new Date("2026-10-06T09:00:00Z"),
  durationMinutes: 30,
  idempotencyKey: "q-action:0001-schedule",
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
};

describe("slot proposal", () => {
  it("offers three weekday times inside 09:00-17:30 local, spread across days, avoiding busy", () => {
    const slots = proposeSlots({
      now: NOW,
      from: NOW,
      to: new Date("2026-10-12T00:00:00Z"),
      durationMinutes: 30,
      timeZone: "Europe/London",
      busy: [
        // Monday 09:00-12:00 London is taken.
        {
          start: new Date("2026-10-05T08:00:00Z"),
          end: new Date("2026-10-05T11:00:00Z"),
        },
      ],
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-10-05T11:00:00.000Z",
      "2026-10-06T08:00:00.000Z",
      "2026-10-07T08:00:00.000Z",
    ]);
  });

  it("skips weekends and respects the organiser's zone", () => {
    const friday = new Date("2026-10-09T15:00:00Z");
    const slots = proposeSlots({
      now: friday,
      from: friday,
      to: new Date("2026-10-14T00:00:00Z"),
      durationMinutes: 60,
      timeZone: "America/New_York",
      busy: [],
    });
    // Friday 11:00 New York is past the one-hour lead; next is 12:00 EDT.
    expect(slots[0]?.start.toISOString()).toBe("2026-10-09T16:00:00.000Z");
    expect(slots[1]?.start.toISOString()).toBe("2026-10-12T13:00:00.000Z");
  });

  it("never queries the counterparty's calendar, even when they connected one", async () => {
    const w = world();
    w.investorCalendar.busyTimes = [
      {
        start: new Date("2026-10-05T08:00:00Z"),
        end: new Date("2026-10-05T16:30:00Z"),
      },
    ];
    const result = await w.service.findSlots({
      actor: INVESTOR,
      relationshipId: REL,
      durationMinutes: 30,
    });
    expect(w.founderCalendar.busyQueries).toBe(0);
    expect(w.investorCalendar.busyQueries).toBe(1);
    expect(result.outcome).toBe("OK");
    if (result.outcome !== "OK") return;
    expect(result.timeZone).toBe("Europe/London");
    expect(result.slots).toHaveLength(3);
    expect(result.slots[0]?.start.toISOString()).toBe(
      "2026-10-06T08:00:00.000Z",
    );
  });

  it("refuses a non-party, an unconnected relationship and an unconnected calendar", async () => {
    expect(
      (
        await world().service.findSlots({
          actor: STRANGER,
          relationshipId: REL,
          durationMinutes: 30,
        })
      ).outcome,
    ).toBe("REFUSED");
    const unconnected = await world({ connected: false }).service.findSlots({
      actor: INVESTOR,
      relationshipId: REL,
      durationMinutes: 30,
    });
    expect(unconnected).toEqual({ outcome: "REFUSED", code: "NOT_CONNECTED" });
  });
});

describe("a missing organiser calendar, typed (meetfix-57)", () => {
  it("says REVOKED apart from never connected, on every path", async () => {
    const revoked = world({ calendarsOf: { [INVESTOR.userId]: "REVOKED" } });
    expect(await revoked.service.canSchedule(INVESTOR, REL)).toBe(
      "CALENDAR_REVOKED",
    );
    expect(await revoked.service.schedule(SCHEDULE)).toEqual({
      outcome: "REFUSED",
      code: "CALENDAR_REVOKED",
    });
    expect(
      await revoked.service.findSlots({
        actor: INVESTOR,
        relationshipId: REL,
        durationMinutes: 30,
      }),
    ).toEqual({ outcome: "REFUSED", code: "CALENDAR_REVOKED" });
    expect(await revoked.service.calendarStatus(INVESTOR.userId)).toBe(
      "CALENDAR_REVOKED",
    );

    const never = world({
      calendarsOf: { [INVESTOR.userId]: "NOT_CONNECTED" },
    });
    expect(await never.service.canSchedule(INVESTOR, REL)).toBe(
      "CALENDAR_NOT_CONNECTED",
    );
    expect(await never.service.calendarStatus(INVESTOR.userId)).toBe(
      "CALENDAR_NOT_CONNECTED",
    );
  });

  it("knows whether the other side could host, without reading their calendar", async () => {
    const hostable = world({ calendarsOf: { [INVESTOR.userId]: "REVOKED" } });
    expect(await hostable.service.counterpartCanHost(INVESTOR, REL)).toBe(true);
    expect(hostable.founderCalendar.busyQueries).toBe(0);
    const neither = world({
      calendarsOf: {
        [INVESTOR.userId]: "REVOKED",
        [FOUNDER.userId]: "NOT_CONNECTED",
      },
    });
    expect(await neither.service.counterpartCanHost(INVESTOR, REL)).toBe(false);
    expect(await world().service.counterpartCanHost(STRANGER, REL)).toBe(false);
  });
});

describe("schedule, reschedule, cancel", () => {
  it("creates one event with a Meet link, invites only the other side, records activity and a T-15 reminder", async () => {
    const w = world();
    const result = await w.service.schedule(SCHEDULE);
    expect(result.outcome).toBe("OK");
    if (result.outcome !== "OK") return;
    expect(result.meeting.meetLink).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(result.alreadyScheduled).toBe(false);
    const [event] = w.investorCalendar.inserted;
    expect(event?.eventId).toBe(googleEventIdFor(result.meeting.id));
    expect(event?.attendees.map((a) => a.email)).toEqual([
      "ada@co.example.invalid",
    ]);
    expect(w.activity.recorded).toEqual([
      { eventType: "meeting_scheduled", meetingId: result.meeting.id },
    ]);
    const reminder = w.store.reminders.find(
      (r) => r.meetingId === result.meeting.id,
    );
    expect(reminder?.dueAt.toISOString()).toBe("2026-10-06T08:45:00.000Z");
    expect(reminder?.channel).toBe("EMAIL");
    expect(
      w.store.notifications
        .filter((n) => n.kind === "MEETING_SCHEDULED")
        .map((n) => [n.userId, n.kind]),
    ).toEqual([
      [FOUNDER.userId, "MEETING_SCHEDULED"],
      [INVESTOR.userId, "MEETING_SCHEDULED"],
    ]);
    // The "New call" notice carries the Meet link itself.
    expect(
      w.store.notifications.find(
        (n) => n.kind === "MEETING_SCHEDULED" && n.userId === FOUNDER.userId,
      )?.body,
    ).toBe("Meet link: https://meet.google.com/abc-defg-hij");
    // voiceq-63: the organiser is told in the app that it is booked.
    const booked = w.store.notifications.find(
      (n) => n.kind === "MEETING_SCHEDULED" && n.userId === INVESTOR.userId,
    );
    expect(booked?.title).toMatch(/^Booked: /u);
    expect(booked?.body).toContain(
      "Meet link: https://meet.google.com/abc-defg-hij",
    );
    // REHEARSE: everyone on the call is offered a rehearsal of it.
    const rehearse = w.store.notifications.filter(
      (n) => n.kind === "MEETING_PREP_READY",
    );
    expect(rehearse.map((n) => n.linkPath)).toEqual(
      rehearse.map(() => `/rehearsals/meeting/${result.meeting.id}`),
    );
    expect(rehearse.map((n) => n.userId)).toContain(FOUNDER.userId);
    expect(rehearse.length).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent per execution identity: a retry never invites twice", async () => {
    const w = world();
    await w.service.schedule(SCHEDULE);
    const again = await w.service.schedule(SCHEDULE);
    expect(again.outcome === "OK" && again.alreadyScheduled).toBe(true);
    expect(w.investorCalendar.inserted).toHaveLength(1);
    expect(w.activity.recorded).toHaveLength(1);
  });

  it("books once per counterpart per time window, whatever card asked (voiceq-63)", async () => {
    const w = world();
    const first = await w.service.schedule(SCHEDULE);
    if (first.outcome !== "OK") throw new Error("first booking refused");
    // A restated request seconds later: another card, another key, a start
    // a few minutes off. Live 2026-10-04 this invited Nixo twice.
    const again = await w.service.schedule({
      ...SCHEDULE,
      idempotencyKey: "q-action:0002-schedule",
      startsAt: new Date("2026-10-06T09:05:00Z"),
    });
    if (again.outcome !== "OK") throw new Error("restated booking refused");
    expect(again.alreadyScheduled).toBe(true);
    expect(again.meeting.id).toBe(first.meeting.id);
    expect(w.investorCalendar.inserted).toHaveLength(1);
    // Another hour is another call.
    const later = await w.service.schedule({
      ...SCHEDULE,
      idempotencyKey: "q-action:0003-schedule",
      startsAt: new Date("2026-10-06T11:00:00Z"),
    });
    expect(later.outcome === "OK" && later.alreadyScheduled).toBe(false);
    expect(w.investorCalendar.inserted).toHaveLength(2);
  });

  it("retries a failed insert with the same event id", async () => {
    const w = world();
    w.investorCalendar.failInsert = Object.assign(new Error("503"), {
      code: "UNAVAILABLE",
      retryable: true,
    });
    const failed = await w.service.schedule(SCHEDULE);
    expect(failed).toEqual({
      outcome: "FAILED",
      code: "CALENDAR_UNAVAILABLE",
      retryable: true,
    });
    w.investorCalendar.failInsert = null;
    const retried = await w.service.schedule(SCHEDULE);
    expect(retried.outcome).toBe("OK");
    expect(w.store.meetings).toHaveLength(1);
    expect(w.investorCalendar.inserted).toHaveLength(1);
  });

  it("refuses a time in the past and a non-party", async () => {
    const w = world();
    expect(
      await w.service.schedule({
        ...SCHEDULE,
        startsAt: new Date("2026-10-01T09:00:00Z"),
      }),
    ).toEqual({ outcome: "REFUSED", code: "INVALID_TIME" });
    expect(await w.service.schedule({ ...SCHEDULE, actor: STRANGER })).toEqual({
      outcome: "REFUSED",
      code: "NOT_A_PARTY",
    });
    expect(w.investorCalendar.inserted).toHaveLength(0);
  });

  it("marks a booked call held once it has ended, for either side, only while still CONNECTED (no bot)", async () => {
    const w = world({ state: "CONNECTED" });
    const scheduled = await w.service.schedule(SCHEDULE);
    if (scheduled.outcome !== "OK") throw new Error("not scheduled");
    const id = scheduled.meeting.id;
    const confirm = (who: ActorContext, meetingId = id) =>
      w.service.confirmHeld({
        actor: who,
        relationshipId: REL,
        meetingId,
        correlationId: SCHEDULE.correlationId,
      });
    // Before it ends: not yet.
    expect(await confirm(FOUNDER)).toEqual({
      outcome: "REFUSED",
      code: "INVALID_TIME",
    });
    w.advance(new Date("2026-10-06T10:00:00Z"));
    // A stranger, or a call that is not this relationship's: nothing.
    expect((await confirm(STRANGER)).outcome).toBe("REFUSED");
    expect(
      await confirm(FOUNDER, "00000000-0000-4000-8000-0000000fffff"),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });
    // The founder (not the organiser) may say it happened.
    expect(await confirm(FOUNDER)).toEqual({
      outcome: "OK",
      alreadyDone: false,
    });
    expect(
      w.activity.recorded.filter((r) => r.eventType === "meeting_held"),
    ).toEqual([{ eventType: "meeting_held", meetingId: id }]);
  });

  it("does not record a second held call once the match has moved past CONNECTED", async () => {
    const w = world({ state: "MEETING_HELD" });
    const scheduled = await w.service.schedule(SCHEDULE);
    if (scheduled.outcome !== "OK") throw new Error("not scheduled");
    w.advance(new Date("2026-10-06T10:00:00Z"));
    expect(
      await w.service.confirmHeld({
        actor: INVESTOR,
        relationshipId: REL,
        meetingId: scheduled.meeting.id,
        correlationId: SCHEDULE.correlationId,
      }),
    ).toEqual({ outcome: "OK", alreadyDone: true });
    expect(
      w.activity.recorded.some((r) => r.eventType === "meeting_held"),
    ).toBe(false);
  });

  it("lets only the organiser move or cancel; cancel deletes the event and records meeting_cancelled once", async () => {
    const w = world();
    const scheduled = await w.service.schedule(SCHEDULE);
    if (scheduled.outcome !== "OK") throw new Error("not scheduled");
    const id = scheduled.meeting.id;
    expect(
      await w.service.cancel({
        actor: FOUNDER,
        meetingId: id,
        correlationId: SCHEDULE.correlationId,
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_FOUND" });

    const moved = await w.service.reschedule({
      actor: INVESTOR,
      meetingId: id,
      startsAt: new Date("2026-10-07T13:00:00Z"),
      correlationId: SCHEDULE.correlationId,
    });
    expect(moved.outcome === "OK" && moved.meeting.endsAt).toBe(
      "2026-10-07T13:30:00.000Z",
    );
    expect(
      w.store.reminders.find((r) => r.meetingId === id)?.dueAt.toISOString(),
    ).toBe("2026-10-07T12:45:00.000Z");

    const cancelled = await w.service.cancel({
      actor: INVESTOR,
      meetingId: id,
      correlationId: SCHEDULE.correlationId,
    });
    expect(cancelled).toEqual({ outcome: "OK", alreadyDone: false });
    const again = await w.service.cancel({
      actor: INVESTOR,
      meetingId: id,
      correlationId: SCHEDULE.correlationId,
    });
    expect(again).toEqual({ outcome: "OK", alreadyDone: true });
    expect(w.investorCalendar.cancelled).toEqual([googleEventIdFor(id)]);
    expect(w.activity.recorded.map((r) => r.eventType)).toEqual([
      "meeting_scheduled",
      "meeting_rescheduled",
      "meeting_cancelled",
    ]);
    expect(w.store.reminders.find((r) => r.meetingId === id)?.status).toBe(
      "CANCELLED",
    );
  });

  it("shows the Meet link only to invited people", async () => {
    const w = world();
    await w.service.schedule(SCHEDULE);
    const seen = await w.service.listMeetings(FOUNDER, REL);
    expect(seen?.[0]?.meetLink).toBe("https://meet.google.com/abc-defg-hij");
    expect(await w.service.listMeetings(STRANGER, REL)).toBeNull();
  });
});

describe("reminders and briefs", () => {
  it("refuses a reused key carrying a different reminder, and replays an exact retry", async () => {
    const w = world();
    const base = {
      actor: FOUNDER,
      title: "Follow up",
      dueAt: new Date("2026-10-09T09:00:00Z"),
      relationshipId: REL,
      channel: "IN_APP" as const,
      idempotencyKey: "q-action:same-key",
    };
    const first = await w.service.createReminder(base);
    expect(first).toMatchObject({ outcome: "OK", alreadyCreated: false });
    expect(await w.service.createReminder(base)).toMatchObject({
      outcome: "OK",
      alreadyCreated: true,
    });
    expect(
      await w.service.createReminder({ ...base, title: "Something else" }),
    ).toMatchObject({ outcome: "REFUSED", code: "KEY_REUSED" });
  });

  it("refuses a reminder for a time already gone", async () => {
    const w = world();
    const past = await w.service.createReminder({
      actor: FOUNDER,
      title: "Follow up",
      dueAt: new Date("2025-01-01T09:00:00Z"),
      relationshipId: REL,
      channel: "IN_APP",
      idempotencyKey: "q-action:past-reminder",
    });
    expect(past).toMatchObject({ outcome: "REFUSED", code: "INVALID_TIME" });
    expect(await w.service.deliverDue("cor")).toEqual({
      delivered: 0,
      emailed: 0,
    });
  });

  it("delivers a due reminder in-app once and by email once", async () => {
    const w = world();
    const created = await w.service.createReminder({
      actor: FOUNDER,
      title: "Follow up with Ben",
      dueAt: new Date("2026-10-09T09:00:00Z"),
      relationshipId: REL,
      channel: "EMAIL",
      idempotencyKey: "q-action:0002-reminder",
    });
    expect(created.outcome).toBe("OK");
    expect(await w.service.deliverDue("cor")).toEqual({
      delivered: 0,
      emailed: 0,
    });
    w.advance(new Date("2026-10-09T09:00:30Z"));
    expect(await w.service.deliverDue("cor")).toEqual({
      delivered: 1,
      emailed: 1,
    });
    expect(await w.service.deliverDue("cor")).toEqual({
      delivered: 0,
      emailed: 0,
    });
    // DOCS: on the shared Capital Q layout, with its plain-text twin.
    expect(w.email.sent).toEqual([
      {
        to: "ada@co.example.invalid",
        subject: "Reminder: Follow up with Ben",
        text: expect.stringContaining(
          "Follow up with Ben\n\nOpen Capital Q to act on it.",
        ) as unknown,
        html: expect.stringContaining(">Follow up with Ben</h1>") as unknown,
      },
    ]);
    const notices = await w.service.listNotifications(FOUNDER);
    expect(notices.unread).toBe(1);
    await w.service.markNotificationsRead(
      FOUNDER,
      notices.items.map((n) => n.id),
    );
    expect((await w.service.listNotifications(FOUNDER)).unread).toBe(0);
  });

  it("retries a failed email next tick without a second in-app notice", async () => {
    const w = world();
    await w.service.createReminder({
      actor: FOUNDER,
      title: "Send the deck",
      dueAt: NOW,
      channel: "EMAIL",
      idempotencyKey: "own-reminder-0001",
    });
    w.email.fail = true;
    expect(await w.service.deliverDue("cor")).toEqual({
      delivered: 1,
      emailed: 0,
    });
    w.email.fail = false;
    expect(await w.service.deliverDue("cor")).toEqual({
      delivered: 0,
      emailed: 1,
    });
    expect(w.store.notifications).toHaveLength(1);
  });

  it("refuses a reminder about a relationship the person is not party to", async () => {
    const w = world();
    expect(
      await w.service.createReminder({
        actor: STRANGER,
        title: "Snoop",
        dueAt: NOW,
        relationshipId: REL,
        channel: "IN_APP",
        idempotencyKey: "own-reminder-0002",
      }),
    ).toEqual({ outcome: "REFUSED", code: "NOT_A_PARTY" });
  });

  it("prepares one prep brief for the organiser within 24 hours of the call", async () => {
    const w = world();
    await w.service.schedule(SCHEDULE);
    await w.service.createReminder({
      actor: INVESTOR,
      title: "Ask about churn",
      dueAt: new Date("2026-10-10T09:00:00Z"),
      relationshipId: REL,
      channel: "IN_APP",
      idempotencyKey: "own-reminder-0003",
    });
    // 26 hours before: not yet.
    expect(await w.service.prepareBriefs("cor")).toBe(0);
    w.advance(new Date("2026-10-05T09:30:00Z"));
    expect(await w.service.prepareBriefs("cor")).toBe(1);
    expect(await w.service.prepareBriefs("cor")).toBe(0);
    const meetingId = w.store.meetings[0]?.id ?? "";
    const brief = await w.service.brief(INVESTOR, meetingId);
    expect(brief?.body).toContain("Prep brief: Intro call");
    expect(brief?.body).toContain("With: Ada Ventures (Ada)");
    expect(brief?.body).toContain("- Ask about churn");
    expect(await w.service.brief(FOUNDER, meetingId)).toBeNull();
  });
});

// AUTO (2026-10-02): a time agreed in the chat, without Google.
describe("recordAgreed", () => {
  const AGREED = {
    actor: INVESTOR,
    relationshipId: REL,
    purpose: "Intro call",
    startsAt: new Date("2026-10-06T09:00:00Z"),
    durationMinutes: 30,
    timeZone: "Africa/Lagos",
    idempotencyKey: "errand:0001:agreed:2026-10-06T09:00:00.000Z",
    correlationId: "cor_00000000-0000-4000-8000-000000000002",
  };

  it("records the meeting without touching any calendar, with the event, reminder and notices", async () => {
    const w = world();
    const result = await w.service.recordAgreed(AGREED);
    expect(result.outcome).toBe("OK");
    if (result.outcome !== "OK") return;
    expect(result.meeting.meetLink).toBeNull();
    expect(result.meeting.status).toBe("SCHEDULED");
    expect(result.meeting.timeZone).toBe("Africa/Lagos");
    expect(result.organiser).toEqual({
      name: "Ben",
      email: "ben@vc.example.invalid",
    });
    expect(result.invitees).toEqual([
      { name: "Ada", email: "ada@co.example.invalid" },
    ]);
    expect(w.investorCalendar.inserted).toHaveLength(0);
    expect(w.activity.recorded).toEqual([
      { eventType: "meeting_scheduled", meetingId: result.meeting.id },
    ]);
    expect(
      w.store.reminders
        .find((r) => r.meetingId === result.meeting.id)
        ?.dueAt.toISOString(),
    ).toBe("2026-10-06T08:45:00.000Z");
    expect(
      w.store.notifications
        .filter((n) => n.kind === "MEETING_SCHEDULED")
        .map((n) => n.userId),
    ).toEqual([FOUNDER.userId]);
  });

  it("is idempotent: the same agreement twice is one meeting", async () => {
    const w = world();
    await w.service.recordAgreed(AGREED);
    const again = await w.service.recordAgreed(AGREED);
    expect(again.outcome === "OK" && again.alreadyScheduled).toBe(true);
    expect(w.activity.recorded).toHaveLength(1);
  });

  it("refuses an unconnected relationship, a stranger and a time in the past, and falls back to UTC for an unknown zone", async () => {
    expect(
      (await world({ connected: false }).service.recordAgreed(AGREED)).outcome,
    ).toBe("REFUSED");
    expect(
      (await world().service.recordAgreed({ ...AGREED, actor: STRANGER }))
        .outcome,
    ).toBe("REFUSED");
    expect(
      (
        await world().service.recordAgreed({
          ...AGREED,
          startsAt: new Date("2026-10-01T09:00:00Z"),
        })
      ).outcome,
    ).toBe("REFUSED");
    const odd = await world().service.recordAgreed({
      ...AGREED,
      timeZone: "Nowhere/Else",
    });
    expect(odd.outcome === "OK" && odd.meeting.timeZone).toBe("UTC");
  });
});

// AUTO (2026-10-02): a Meet link Google attaches after the booking.
describe("refreshMeetLinks", () => {
  const MIN = 60_000;

  it("re-reads, asks Google again after 10 minutes, then attaches the link, re-invites and tells both sides once", async () => {
    const w = world();
    w.investorCalendar.insertLink = null;
    const booked = await w.service.schedule(SCHEDULE);
    expect(booked.outcome === "OK" && booked.meeting.meetLink).toBeNull();
    if (booked.outcome !== "OK") return;
    w.advance(new Date(NOW.getTime() + 1 * MIN));
    expect(await w.service.refreshMeetLinks("cor_x")).toEqual({
      found: 0,
      waiting: 1,
    });
    expect(w.investorCalendar.conferenceReads.at(-1)?.ask).toBe(false);
    w.advance(new Date(NOW.getTime() + 11 * MIN));
    await w.service.refreshMeetLinks("cor_x");
    expect(w.investorCalendar.conferenceReads.at(-1)?.ask).toBe(true);
    w.investorCalendar.laterLink = "https://meet.google.com/xyz-later-abc";
    w.advance(new Date(NOW.getTime() + 12 * MIN));
    expect((await w.service.refreshMeetLinks("cor_x")).found).toBe(1);
    expect((await w.store.findMeeting(booked.meeting.id))?.meetLink).toBe(
      "https://meet.google.com/xyz-later-abc",
    );
    expect(w.investorCalendar.announced).toEqual([
      {
        eventId: googleEventIdFor(booked.meeting.id),
        meetLink: "https://meet.google.com/xyz-later-abc",
      },
    ]);
    const told = w.store.notifications.filter(
      (n) => n.dedupeKey === `meet-link:${booked.meeting.id}`,
    );
    expect(told.map((n) => n.userId).sort()).toEqual(
      [FOUNDER.userId, INVESTOR.userId].sort(),
    );
    // Nothing more to do: never twice.
    w.advance(new Date(NOW.getTime() + 13 * MIN));
    expect(await w.service.refreshMeetLinks("cor_x")).toEqual({
      found: 0,
      waiting: 0,
    });
    expect(w.investorCalendar.announced).toHaveLength(1);
  });

  it("tells the organiser plainly, once, when it still has none after half an hour, and keeps checking every 10 minutes", async () => {
    const w = world();
    w.investorCalendar.insertLink = null;
    const booked = await w.service.schedule(SCHEDULE);
    if (booked.outcome !== "OK") return;
    w.advance(new Date(NOW.getTime() + 30 * MIN));
    await w.service.refreshMeetLinks("cor_x");
    const reads = w.investorCalendar.conferenceReads.length;
    w.advance(new Date(NOW.getTime() + 34 * MIN));
    await w.service.refreshMeetLinks("cor_x");
    expect(w.investorCalendar.conferenceReads).toHaveLength(reads);
    w.advance(new Date(NOW.getTime() + 40 * MIN));
    await w.service.refreshMeetLinks("cor_x");
    expect(w.investorCalendar.conferenceReads).toHaveLength(reads + 1);
    const missing = w.store.notifications.filter(
      (n) => n.dedupeKey === `meet-link-missing:${booked.meeting.id}`,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]?.userId).toBe(INVESTOR.userId);
  });

  it("leaves a time agreed without Google alone (no such Google event)", async () => {
    const w = world();
    const agreed = await w.service.recordAgreed({
      actor: INVESTOR,
      relationshipId: REL,
      purpose: "Agreed call",
      startsAt: new Date("2026-10-06T09:00:00Z"),
      durationMinutes: 30,
      timeZone: "Africa/Lagos",
      idempotencyKey: "errand:0002:agreed",
      correlationId: "cor_00000000-0000-4000-8000-000000000003",
    });
    expect(agreed.outcome).toBe("OK");
    w.advance(new Date(NOW.getTime() + 31 * MIN));
    await w.service.refreshMeetLinks("cor_x");
    expect(
      w.store.notifications.some((n) => n.dedupeKey.startsWith("meet-link")),
    ).toBe(false);
  });
});
