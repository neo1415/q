import { describe, expect, it } from "vitest";

import type { MeetingView } from "@capital-q/communication";
import { GOOGLE_RECONNECT_PATH } from "@capital-q/contracts";
import {
  ActorContextSchema,
  type ActorContextResolver,
} from "@capital-q/security";

import {
  createErrandRunner,
  type ErrandRow,
  type ErrandStore,
} from "../src/composition/errands.js";

/**
 * meetfix-57 (live 2026-10-04, relationship da9b1bc5): an errand whose call
 * could not be booked because the organiser's Google Calendar connection
 * had been revoked asked the calendar again every minute, for ever. Now:
 * one attempt, the reason recorded, one notice with the reconnect link,
 * then nothing until the calendar is reconnected -- when it books.
 */

const USER = "00000000-0000-4000-8000-0000000000b1";
const TENANT = "00000000-0000-4000-8000-00000000000a";
const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const MEETING = "00000000-0000-4000-8000-0000000000e1";
const NOW = new Date("2026-10-04T14:13:00Z");

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});
const resolves: ActorContextResolver = {
  resolveHumanContext: () =>
    Promise.resolve({ status: "RESOLVED", context: actor }),
};

function world(options: { negotiation?: boolean } = {}) {
  let calendar: "CONNECTED" | "CALENDAR_REVOKED" = "CALENDAR_REVOKED";
  let current: ErrandRow = {
    id: "00000000-0000-4000-8000-0000000000f1",
    tenant_id: TENANT,
    user_id: USER,
    organisation_id: null,
    q_action_id: "00000000-0000-4000-8000-0000000000d1",
    relationship_id: RELATIONSHIP,
    counterpart_name: "Nixo",
    plan: {
      relationshipId: RELATIONSHIP,
      counterpartName: "Nixo",
      expressInterest: false,
      openingMessage: null,
      brief: null,
      bookCall: { purpose: "Intro call", durationMinutes: 30 },
    },
    stage: "CONVERSING",
    seen_until: NOW,
    replies_sent: 0,
    meeting_id: null,
    expires_at: new Date(NOW.getTime() + 14 * 24 * 3_600_000),
    created_at: NOW,
    proposed_slots: null,
  };
  const attempts = { findSlots: 0, schedule: 0 };
  const notices: { step: string; title: string; link: string | null }[] = [];
  const steps: string[] = [];
  const view: MeetingView = {
    id: MEETING,
    relationshipId: RELATIONSHIP,
    purpose: "Intro call",
    startsAt: "2026-10-05T09:00:00.000Z",
    endsAt: "2026-10-05T09:30:00.000Z",
    timeZone: "UTC",
    status: "SCHEDULED",
    organisedByYou: true,
    organiserName: "Zino",
    meetLink: "https://meet.google.com/abc-defg-hij",
    attendees: [],
    hasBrief: false,
  };
  const store: ErrandStore = {
    due: () => Promise.resolve([current]),
    authUserOf: () => Promise.resolve("00000000-0000-4000-8000-0000000000aa"),
    update: (_id, patch) => {
      if (patch.lastStep !== undefined) steps.push(patch.lastStep);
      if (patch.meetingId !== undefined) {
        current = { ...current, meeting_id: patch.meetingId };
      }
      return Promise.resolve();
    },
    meetingOf: () => Promise.resolve(current.meeting_id),
    // The notifications table's own dedupe, as the store has it.
    notify: (notice) => {
      if (!notices.some((known) => known.step === notice.step)) {
        notices.push({
          step: notice.step,
          title: notice.title,
          link: notice.link,
        });
      }
      return Promise.resolve();
    },
    told: (_row, step) =>
      Promise.resolve(notices.some((known) => known.step === step)),
    list: () => Promise.resolve([]),
    stop: () => Promise.resolve(false),
  };
  const runner = createErrandRunner({
    store,
    resolver: resolves,
    chat: {
      readForQ: () =>
        Promise.resolve({
          side: "INVESTOR" as const,
          connected: true,
          blocked: false,
          messages: [],
        }),
      send: () => Promise.resolve(null),
    },
    schedule: {
      calendarStatus: () => Promise.resolve(calendar),
      counterpartCanHost: () => Promise.resolve(false),
      findSlots: () => {
        attempts.findSlots += 1;
        return Promise.resolve(
          calendar === "CONNECTED"
            ? {
                outcome: "OK" as const,
                timeZone: "UTC",
                slots: [
                  {
                    start: new Date("2026-10-05T09:00:00Z"),
                    end: new Date("2026-10-05T09:30:00Z"),
                  },
                ],
              }
            : {
                outcome: "REFUSED" as const,
                code: "CALENDAR_REVOKED" as const,
              },
        );
      },
      schedule: () => {
        attempts.schedule += 1;
        return Promise.resolve({
          outcome: "OK" as const,
          meeting: view,
          alreadyScheduled: false,
        });
      },
    },
    relationships: {
      byRelationship: () =>
        Promise.resolve({
          side: "INVESTOR" as const,
          counterpart: {
            kind: "COMPANY" as const,
            id: "00000000-0000-4000-8000-0000000000c9",
          },
          status: null,
        }),
    },
    composer: {
      compose: () => Promise.resolve({ reply: null, forPerson: [] }),
    },
    nameOf: () => Promise.resolve("Zino"),
    ...(options.negotiation === true
      ? {
          negotiation: {
            zoneOf: () => Promise.resolve("UTC"),
            readSlots: () => Promise.resolve(null),
            recordAgreed: () => Promise.reject(new Error("not reached")),
            sendInvites: () => Promise.resolve(),
          },
        }
      : {}),
    now: () => NOW,
  });
  return {
    runner,
    attempts,
    notices,
    steps,
    reconnect: () => {
      calendar = "CONNECTED";
    },
  };
}

describe("a call blocked on a revoked calendar (meetfix-57)", () => {
  it("is attempted once, told once with the reconnect link, and left alone every minute after", async () => {
    const w = world();
    for (let minute = 0; minute < 16; minute += 1) await w.runner.tick();
    expect(w.attempts.findSlots).toBe(1);
    expect(w.attempts.schedule).toBe(0);
    expect(w.notices).toEqual([
      {
        step: "call-blocked:CALENDAR_REVOKED",
        title: "Reconnect Google to book your call with Nixo",
        link: GOOGLE_RECONNECT_PATH,
      },
    ]);
    expect(w.steps).toEqual([
      "Call on hold: your Google Calendar connection expired. Reconnect Google to book it.",
    ]);
  });

  it("books on the first tick after the calendar is reconnected", async () => {
    const w = world();
    await w.runner.tick();
    await w.runner.tick();
    w.reconnect();
    await w.runner.tick();
    expect(w.attempts.findSlots).toBe(2);
    expect(w.attempts.schedule).toBe(1);
    expect(w.notices.map((notice) => notice.step)).toEqual([
      "call-blocked:CALENDAR_REVOKED",
      "call",
    ]);
  });

  it("parks a revoked calendar even where Q could arrange the time without Google", async () => {
    const w = world({ negotiation: true });
    for (let minute = 0; minute < 5; minute += 1) await w.runner.tick();
    expect(w.attempts.findSlots).toBe(1);
    expect(w.notices.map((notice) => notice.step)).toEqual([
      "call-blocked:CALENDAR_REVOKED",
    ]);
  });
});
