import { describe, expect, it } from "vitest";

import { createScheduleService } from "@capital-q/communication";
import {
  createFakeAppEmail,
  createFakeCalendar,
  createInMemoryScheduleStore,
  createRecordingMeetingActivity,
  createStaticMeetingDirectory,
  inlineScheduleTransactions,
} from "@capital-q/communication/testing";
import type { ActorContext } from "@capital-q/security";

import { createChatActionBoard } from "../src/composition/chat-actions.js";
import {
  createMeetingCancelAction,
  createMeetingScheduleAction,
  createReminderCreateAction,
  MEETING_CANCEL,
  MEETING_SCHEDULE,
  REMINDER_CREATE,
} from "../src/composition/schedule-actions.js";

/**
 * BIZ-008 actions over the real schedule service with a fake calendar:
 * authorize re-checks the party, the connection, Calendar and the
 * organiser; execution is idempotent by the approved action's key and
 * books a Meet invite to the other side only.
 */

const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const actor = {
  actorType: "HUMAN",
  tenantId: "00000000-0000-4000-8000-00000000000a",
  userId: "00000000-0000-4000-8000-0000000000b1",
  organisationId: "00000000-0000-4000-8000-0000000000b2",
} as unknown as ActorContext;
const founder = {
  ...actor,
  tenantId: "00000000-0000-4000-8000-00000000000b",
  userId: "00000000-0000-4000-8000-0000000000f1",
  organisationId: "00000000-0000-4000-8000-0000000000f2",
} as unknown as ActorContext;
const stranger = {
  ...actor,
  userId: "00000000-0000-4000-8000-0000000000b9",
  organisationId: "00000000-0000-4000-8000-0000000000b8",
} as unknown as ActorContext;

function world(options: { calendar?: boolean } = {}) {
  const store = createInMemoryScheduleStore();
  const calendar = createFakeCalendar("ben@vc.example.invalid");
  const schedule = createScheduleService({
    store,
    transactions: inlineScheduleTransactions,
    parties: (who, relationshipId) =>
      Promise.resolve(
        relationshipId !== RELATIONSHIP
          ? null
          : who.userId === actor.userId
            ? { side: "INVESTOR" as const, connected: true }
            : who.userId === founder.userId
              ? { side: "COMPANY" as const, connected: true }
              : null,
      ),
    directory: createStaticMeetingDirectory({
      relationshipTenant: founder.tenantId,
      people: {
        COMPANY: [
          {
            userId: founder.userId,
            tenantId: founder.tenantId,
            name: "Ada",
            email: "ada@co.example.invalid",
          },
        ],
        INVESTOR_ORGANISATION: [],
      },
      persons: {
        [actor.userId]: { name: "Ben", email: "ben@vc.example.invalid" },
      },
    }),
    calendars: (userId) =>
      Promise.resolve(
        options.calendar !== false && userId === actor.userId ? calendar : null,
      ),
    activity: createRecordingMeetingActivity(),
    email: createFakeAppEmail(),
    now: () => new Date("2026-10-05T07:00:00Z"),
  });
  return { store, calendar, schedule };
}

const approved = <P>(actionType: string, payload: P, key: string) =>
  ({
    actionId: "00000000-0000-4000-8000-0000000000e1",
    runId: "00000000-0000-4000-8000-0000000000e2",
    tenantId: actor.tenantId,
    organisationId: actor.organisationId,
    actionType,
    payload,
    idempotencyKey: key,
  }) as never;
const context = {
  approver: actor,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
  attempt: 1,
} as never;

const meetingPayload = {
  relationshipId: RELATIONSHIP,
  counterpartName: "Acme",
  purpose: "Intro call",
  startsAt: "2026-10-06T09:00:00.000Z",
  durationMinutes: 30,
};

describe("meeting.schedule", () => {
  it("authorises a connected party with Calendar, and nobody else", async () => {
    const { schedule } = world();
    const action = createMeetingScheduleAction({ schedule });
    expect(await action.authorize(meetingPayload, actor)).toEqual({
      outcome: "ALLOW",
    });
    expect(await action.authorize(meetingPayload, stranger)).toEqual({
      outcome: "DENY",
      code: "NOT_A_PARTY",
    });
    const noCalendar = createMeetingScheduleAction({
      schedule: world({ calendar: false }).schedule,
    });
    expect(await noCalendar.authorize(meetingPayload, actor)).toEqual({
      outcome: "DENY",
      code: "CALENDAR_NOT_CONNECTED",
    });
  });

  it("books once per execution identity and cancels only as the organiser", async () => {
    const { schedule, calendar, store } = world();
    const book = createMeetingScheduleAction({ schedule });
    const first = await book.executor.execute(
      approved(MEETING_SCHEDULE, meetingPayload, "q_action:m:1"),
      context,
    );
    const again = await book.executor.execute(
      approved(MEETING_SCHEDULE, meetingPayload, "q_action:m:1"),
      context,
    );
    expect(first).toMatchObject({
      outcome: "EXECUTED",
      result: {
        meetLink: "https://meet.google.com/abc-defg-hij",
        alreadyDone: false,
      },
    });
    expect(again).toMatchObject({
      outcome: "EXECUTED",
      result: { alreadyDone: true },
    });
    expect(calendar.inserted).toHaveLength(1);
    expect(calendar.inserted[0]?.attendees).toEqual([
      { email: "ada@co.example.invalid", displayName: "Ada" },
    ]);

    const meetingId = store.meetings[0]?.id ?? "";
    const cancel = createMeetingCancelAction({ schedule });
    const cancelPayload = {
      meetingId,
      relationshipId: RELATIONSHIP,
      purpose: "Intro call",
      startsAt: meetingPayload.startsAt,
    };
    expect(await cancel.authorize(cancelPayload, founder)).toEqual({
      outcome: "DENY",
      code: "NOT_ORGANISER",
    });
    expect(
      await cancel.executor.execute(
        approved(MEETING_CANCEL, cancelPayload, "q_action:c:1"),
        context,
      ),
    ).toEqual({ outcome: "EXECUTED", result: { alreadyDone: false } });
    expect(calendar.cancelled).toHaveLength(1);
  });
});

describe("reminder.create", () => {
  it("creates the approver's own reminder once, with or without a relationship", async () => {
    const { schedule, store } = world();
    const action = createReminderCreateAction({ schedule });
    const payload = {
      title: "Follow up with Acme",
      remindAt: "2026-10-09T08:00:00.000Z",
      channel: "EMAIL" as const,
    };
    expect(await action.authorize(payload, actor)).toEqual({
      outcome: "ALLOW",
    });
    expect(
      await action.authorize(
        { ...payload, relationshipId: RELATIONSHIP },
        stranger,
      ),
    ).toEqual({ outcome: "DENY", code: "NOT_A_PARTY" });
    await action.executor.execute(
      approved(REMINDER_CREATE, payload, "q_action:r:1"),
      context,
    );
    const again = await action.executor.execute(
      approved(REMINDER_CREATE, payload, "q_action:r:1"),
      context,
    );
    expect(again).toMatchObject({
      outcome: "EXECUTED",
      result: { alreadyCreated: true },
    });
    expect(store.reminders).toHaveLength(1);
    expect(store.reminders[0]?.ownerUserId).toBe(actor.userId);
  });
});

describe("the chat board carries schedule proposals", () => {
  it("validates a meeting proposal against its bound payload", async () => {
    const board = createChatActionBoard();
    board.prepareForApproval({
      runId: "run-9",
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      proposal: { actionType: "meeting.schedule", payload: meetingPayload },
    });
    expect(
      await board.proposer.propose({ runId: "run-9", actor } as never),
    ).toEqual({ actionType: MEETING_SCHEDULE, payload: meetingPayload });
  });
});
