import { randomUUID } from "node:crypto";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";

import type { AppEmailPort, OrganiserCalendar } from "../schedule/service.js";
import type {
  MeetingActivityWriter,
  MeetingDirectory,
  MeetingRecord,
  NewNotification,
  NotificationRecord,
  ReminderRecord,
  ScheduleStore,
} from "../schedule/store.js";

/**
 * Test doubles for meetings and reminders (BIZ-008). The in-memory store
 * keeps the database's rules (one meeting per idempotency key, one
 * notification per dedupe key, one T-15 reminder per meeting); the fake
 * calendar records what Google would have been asked and never reaches it.
 */

export const inlineScheduleTransactions: TransactionManager = {
  run: (work) => work({ sql: undefined as never } satisfies TransactionContext),
};

type MutableMeeting = {
  -readonly [K in keyof MeetingRecord]: MeetingRecord[K];
};
type MutableReminder = {
  -readonly [K in keyof ReminderRecord]: ReminderRecord[K];
} & { qActionId: string | null; idempotencyKey: string };

export type InMemoryScheduleStore = ScheduleStore & {
  readonly meetings: MutableMeeting[];
  readonly reminders: MutableReminder[];
  readonly notifications: (NewNotification & {
    id: string;
    readAt: Date | null;
  })[];
  readonly briefs: { meetingId: string; userId: string; body: string }[];
};

export function createInMemoryScheduleStore(): InMemoryScheduleStore {
  const meetings: MutableMeeting[] = [];
  const reminders: MutableReminder[] = [];
  const notifications: (NewNotification & {
    id: string;
    readAt: Date | null;
  })[] = [];
  const briefs: { meetingId: string; userId: string; body: string }[] = [];
  const copy = (m: MutableMeeting): MeetingRecord => ({ ...m });
  return {
    meetings,
    reminders,
    notifications,
    briefs,
    claimMeeting: (input) => {
      const existing = meetings.find(
        (m) =>
          m.idempotencyKey === input.idempotencyKey ||
          (input.qActionId !== null && m.qActionId === input.qActionId),
      );
      if (existing !== undefined) {
        return Promise.resolve({ record: copy(existing), created: false });
      }
      const record: MutableMeeting = {
        ...input,
        status: "SCHEDULING",
        meetLink: null,
        prepBriefAt: null,
      };
      meetings.push(record);
      return Promise.resolve({ record: copy(record), created: true });
    },
    findMeeting: (id) => {
      const found = meetings.find((m) => m.id === id);
      return Promise.resolve(found === undefined ? null : copy(found));
    },
    listMeetingsForRelationship: (relationshipId) =>
      Promise.resolve(
        meetings.filter((m) => m.relationshipId === relationshipId).map(copy),
      ),
    listMeetingsForUser: (userId, from) =>
      Promise.resolve(
        meetings
          .filter(
            (m) =>
              m.endsAt >= from &&
              m.participants.some((p) => p.userId === userId),
          )
          .map(copy),
      ),
    markMeetingScheduled: (_tx, id, meetLink) => {
      const m = meetings.find((x) => x.id === id);
      if (
        m !== undefined &&
        (m.status === "SCHEDULING" || m.status === "FAILED")
      ) {
        m.status = "SCHEDULED";
        m.meetLink = meetLink;
      }
      return Promise.resolve();
    },
    markMeetingFailed: (id) => {
      const m = meetings.find((x) => x.id === id);
      if (m?.status === "SCHEDULING") m.status = "FAILED";
      return Promise.resolve();
    },
    moveMeeting: (_tx, id, times) => {
      const m = meetings.find((x) => x.id === id);
      if (m?.status !== "SCHEDULED") return Promise.resolve(false);
      m.startsAt = times.startsAt;
      m.endsAt = times.endsAt;
      m.prepBriefAt = null;
      return Promise.resolve(true);
    },
    cancelMeeting: (_tx, id) => {
      const m = meetings.find((x) => x.id === id);
      if (m === undefined || m.status === "CANCELLED") {
        return Promise.resolve(false);
      }
      m.status = "CANCELLED";
      return Promise.resolve(true);
    },
    meetingsNeedingBrief: (now, until) =>
      Promise.resolve(
        meetings
          .filter(
            (m) =>
              m.status === "SCHEDULED" &&
              m.prepBriefAt === null &&
              m.startsAt > now &&
              m.startsAt <= until,
          )
          .map(copy),
      ),
    saveBrief: (_tx, input) => {
      if (!briefs.some((b) => b.meetingId === input.meetingId)) {
        briefs.push({
          meetingId: input.meetingId,
          userId: input.userId,
          body: input.body,
        });
      }
      const m = meetings.find((x) => x.id === input.meetingId);
      if (m !== undefined) m.prepBriefAt = new Date();
      return Promise.resolve();
    },
    findBrief: (meetingId, userId) => {
      const b = briefs.find(
        (x) => x.meetingId === meetingId && x.userId === userId,
      );
      return Promise.resolve(
        b === undefined ? null : { body: b.body, createdAt: new Date() },
      );
    },
    createReminder: (input) => {
      const existing = reminders.find(
        (r) =>
          (r.ownerUserId === input.ownerUserId &&
            r.idempotencyKey === input.idempotencyKey) ||
          (input.qActionId !== null && r.qActionId === input.qActionId),
      );
      if (existing !== undefined) {
        return Promise.resolve({ record: { ...existing }, created: false });
      }
      const record: MutableReminder = {
        ...input,
        id: randomUUID(),
        meetingId: null,
        status: "PENDING",
        source: "PERSON",
        emailSentAt: null,
      };
      reminders.push(record);
      return Promise.resolve({ record: { ...record }, created: true });
    },
    upsertMeetingReminder: (_tx, input) => {
      const existing = reminders.find((r) => r.meetingId === input.meetingId);
      if (existing !== undefined) {
        existing.dueAt = input.dueAt;
        existing.title = input.title;
        existing.status = "PENDING";
        existing.emailSentAt = null;
      } else {
        reminders.push({
          id: randomUUID(),
          tenantId: input.tenantId,
          ownerUserId: input.ownerUserId,
          relationshipId: input.relationshipId,
          meetingId: input.meetingId,
          title: input.title,
          note: null,
          dueAt: input.dueAt,
          channel: "EMAIL",
          status: "PENDING",
          source: "MEETING",
          emailSentAt: null,
          qActionId: null,
          idempotencyKey: `meeting:${input.meetingId}`,
        });
      }
      return Promise.resolve();
    },
    cancelMeetingReminder: (_tx, meetingId) => {
      for (const r of reminders) {
        if (r.meetingId === meetingId && r.status === "PENDING") {
          r.status = "CANCELLED";
        }
      }
      return Promise.resolve();
    },
    listReminders: (ownerUserId) =>
      Promise.resolve(
        reminders
          .filter(
            (r) =>
              r.ownerUserId === ownerUserId &&
              (r.status === "PENDING" || r.status === "DELIVERED"),
          )
          .map((r) => ({ ...r })),
      ),
    dismissReminder: (ownerUserId, id) => {
      const r = reminders.find(
        (x) => x.id === id && x.ownerUserId === ownerUserId,
      );
      if (
        r === undefined ||
        (r.status !== "PENDING" && r.status !== "DELIVERED")
      ) {
        return Promise.resolve(false);
      }
      r.status = "DISMISSED";
      return Promise.resolve(true);
    },
    dueReminders: (now) =>
      Promise.resolve(
        reminders
          .filter(
            (r) =>
              (r.status === "PENDING" && r.dueAt <= now) ||
              (r.status === "DELIVERED" &&
                r.channel === "EMAIL" &&
                r.emailSentAt === null &&
                now.getTime() - r.dueAt.getTime() < 3_600_000),
          )
          .map((r) => ({ ...r })),
      ),
    markReminderDelivered: (_tx, id) => {
      const r = reminders.find((x) => x.id === id);
      if (r?.status === "PENDING") r.status = "DELIVERED";
      return Promise.resolve();
    },
    markReminderEmailed: (id, at) => {
      const r = reminders.find((x) => x.id === id);
      if (r !== undefined && r.emailSentAt === null) r.emailSentAt = at;
      return Promise.resolve();
    },
    notify: (_tx, input) => {
      if (
        !notifications.some(
          (n) => n.userId === input.userId && n.dedupeKey === input.dedupeKey,
        )
      ) {
        notifications.push({ ...input, id: randomUUID(), readAt: null });
      }
      return Promise.resolve();
    },
    listNotifications: (userId) => {
      const mine = notifications.filter((n) => n.userId === userId);
      const items: NotificationRecord[] = mine.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        linkPath: n.linkPath,
        readAt: n.readAt,
        createdAt: new Date(),
      }));
      return Promise.resolve({
        items,
        unread: mine.filter((n) => n.readAt === null).length,
      });
    },
    markNotificationsRead: (userId, ids, at) => {
      for (const n of notifications) {
        if (n.userId === userId && ids.includes(n.id)) n.readAt = at;
      }
      return Promise.resolve();
    },
  };
}

export type FakeCalendar = OrganiserCalendar & {
  readonly inserted: Parameters<OrganiserCalendar["insert"]>[0][];
  readonly moved: string[];
  readonly cancelled: string[];
  busyTimes: { start: Date; end: Date }[];
  /** How many times free/busy was read from this calendar. */
  busyQueries: number;
  failInsert: Error | null;
};

export function createFakeCalendar(
  email: string,
  timeZone = "Europe/London",
): FakeCalendar {
  const events = new Set<string>();
  const fake: FakeCalendar = {
    email,
    inserted: [],
    moved: [],
    cancelled: [],
    busyTimes: [],
    busyQueries: 0,
    failInsert: null,
    busy: () => {
      fake.busyQueries += 1;
      return Promise.resolve(fake.busyTimes);
    },
    timeZone: () => Promise.resolve(timeZone),
    insert: (event) => {
      if (fake.failInsert !== null) return Promise.reject(fake.failInsert);
      // Google dedupes by event id: a retry is the same event.
      if (!events.has(event.eventId)) fake.inserted.push(event);
      events.add(event.eventId);
      return Promise.resolve({
        meetLink: "https://meet.google.com/abc-defg-hij",
      });
    },
    move: (eventId) => {
      fake.moved.push(eventId);
      return Promise.resolve();
    },
    cancel: (eventId) => {
      fake.cancelled.push(eventId);
      events.delete(eventId);
      return Promise.resolve();
    },
  };
  return fake;
}

export function createRecordingMeetingActivity(): MeetingActivityWriter & {
  readonly recorded: { eventType: string; meetingId: string }[];
} {
  const recorded: { eventType: string; meetingId: string }[] = [];
  return {
    recorded,
    record: (_tx, input) => {
      recorded.push({ eventType: input.eventType, meetingId: input.meetingId });
      return Promise.resolve();
    },
  };
}

export function createFakeAppEmail(): AppEmailPort & {
  readonly sent: { to: string; subject: string; text: string }[];
  fail: boolean;
} {
  const fake = {
    available: true,
    sent: [] as { to: string; subject: string; text: string }[],
    fail: false,
    send: (message: { to: string; subject: string; text: string }) => {
      if (fake.fail) return Promise.reject(new Error("smtp down"));
      fake.sent.push({ ...message });
      return Promise.resolve();
    },
  };
  return fake;
}

export function createStaticMeetingDirectory(input: {
  readonly relationshipTenant: string;
  readonly people: Readonly<
    Record<
      "COMPANY" | "INVESTOR_ORGANISATION",
      readonly {
        userId: string;
        tenantId: string;
        name: string;
        email: string;
      }[]
    >
  >;
  readonly persons: Readonly<Record<string, { name: string; email: string }>>;
}): MeetingDirectory {
  return {
    relationshipTenant: () => Promise.resolve(input.relationshipTenant),
    counterpartPeople: ({ counterpart }) =>
      Promise.resolve(input.people[counterpart]),
    person: (userId) => Promise.resolve(input.persons[userId] ?? null),
    counterpartName: () => Promise.resolve("Ada Ventures"),
  };
}
