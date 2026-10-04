import { describe, expect, it } from "vitest";

import { googleMeetLink } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createScheduleService,
  JOINED_CALL_CONSENT,
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
 * meet-47: "Have Q join a call", on demand, for either side. Google Meet
 * links only; the same link at the same time is one call; the other side
 * hears it with the booking's consent line; no calendar event is touched.
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
const NOW = new Date("2026-10-05T09:00:00Z");
const LINK = "https://meet.google.com/abc-defg-hij";

function world(options: { connected?: boolean } = {}) {
  let clock = NOW;
  const store = createInMemoryScheduleStore({ now: () => clock });
  const activity = createRecordingMeetingActivity();
  const founderCalendar = createFakeCalendar("ada@co.example.invalid");
  const joined: string[] = [];
  const parties = (a: ActorContext, relationshipId: string) => {
    if (relationshipId !== REL) return Promise.resolve(null);
    const connected = options.connected ?? true;
    const party: ChatParty | null =
      a.userId === INVESTOR.userId
        ? { side: "INVESTOR", connected }
        : a.userId === FOUNDER.userId
          ? { side: "COMPANY", connected }
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
      Promise.resolve(userId === FOUNDER.userId ? founderCalendar : null),
    activity,
    email: createFakeAppEmail(),
    now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    onJoinRequested: (meetingId) => joined.push(meetingId),
  });
  return {
    service,
    store,
    activity,
    founderCalendar,
    joined,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const join = (a: ActorContext, meetLink = LINK) => ({
  actor: a,
  relationshipId: REL,
  meetLink,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
});

describe("Google Meet links", () => {
  it("accepts a meet.google.com link in any usual form, canonically", () => {
    expect(
      googleMeetLink("https://meet.google.com/ABC-defg-hij?authuser=0"),
    ).toBe(LINK);
    expect(googleMeetLink("meet.google.com/abc-defg-hij")).toBe(LINK);
    expect(googleMeetLink(" https://meet.google.com/abc-defg-hij/ ")).toBe(
      LINK,
    );
  });

  it("refuses anything that is not a Meet call", () => {
    for (const raw of [
      "https://zoom.us/j/123456789",
      "http://meet.google.com/abc-defg-hij",
      "https://meet.google.com.evil.example/abc-defg-hij",
      "https://user@meet.google.com/abc-defg-hij",
      "https://meet.google.com/lookup/abc",
      "https://meet.google.com:8443/abc-defg-hij",
      "javascript:alert(1)",
    ]) {
      expect(googleMeetLink(raw), raw).toBeNull();
    }
  });
});

describe("Have Q join a call (meet-47)", () => {
  it("records a JOINED call now, books Q at once, and tells the other side with the consent line", async () => {
    const w = world();
    const out = await w.service.joinCall(join(FOUNDER));
    expect(out.outcome).toBe("OK");
    if (out.outcome !== "OK") return;
    expect(out.alreadyJoined).toBe(false);
    const [meeting] = w.store.meetings;
    expect(meeting?.origin).toBe("JOINED");
    expect(meeting?.status).toBe("SCHEDULED");
    expect(meeting?.meetLink).toBe(LINK);
    expect(meeting?.startsAt).toEqual(NOW);
    expect(w.joined).toEqual([meeting?.id]);
    const notice = w.store.notifications.find(
      (n) => n.userId === INVESTOR.userId,
    );
    expect(notice?.title).toBe("Ada asked Q to join your call");
    expect(notice?.body).toContain(JOINED_CALL_CONSENT);
    expect(w.store.notifications.some((n) => n.userId === FOUNDER.userId)).toBe(
      false,
    );
    expect(w.activity.recorded.map((e) => e.eventType)).toEqual([
      "meeting_scheduled",
    ]);
  });

  it("works for either side", async () => {
    const out = await world().service.joinCall(join(INVESTOR));
    expect(out.outcome).toBe("OK");
  });

  it("is one call per link and time: asking again joins the same call", async () => {
    const w = world();
    await w.service.joinCall(join(FOUNDER));
    w.advance(20 * 60_000);
    const again = await w.service.joinCall(
      join(INVESTOR, "meet.google.com/ABC-DEFG-HIJ"),
    );
    expect(again.outcome === "OK" && again.alreadyJoined).toBe(true);
    expect(w.store.meetings).toHaveLength(1);
    expect(w.joined).toHaveLength(2);
  });

  it("is a new call on the same link once the last one is over", async () => {
    const w = world();
    await w.service.joinCall(join(FOUNDER));
    w.advance(2 * 3_600_000);
    await w.service.joinCall(join(FOUNDER));
    expect(w.store.meetings).toHaveLength(2);
  });

  it("joins only Google Meet links", async () => {
    const out = await world().service.joinCall(
      join(FOUNDER, "https://zoom.us/j/123456789"),
    );
    expect(out).toEqual({ outcome: "REFUSED", code: "NOT_A_MEET_LINK" });
  });

  it("is self-scoped: only a party to the relationship, once connected", async () => {
    expect(await world().service.joinCall(join(STRANGER))).toEqual({
      outcome: "REFUSED",
      code: "NOT_A_PARTY",
    });
    expect(
      await world({ connected: false }).service.joinCall(join(FOUNDER)),
    ).toEqual({ outcome: "REFUSED", code: "NOT_CONNECTED" });
  });

  it("never touches a calendar: cancelling a joined call skips Google", async () => {
    const w = world();
    const out = await w.service.joinCall(join(FOUNDER));
    if (out.outcome !== "OK") throw new Error("not joined");
    const cancelled = await w.service.cancel({
      actor: FOUNDER,
      meetingId: out.meeting.id,
      correlationId: "cor_00000000-0000-4000-8000-000000000002",
    });
    expect(cancelled.outcome).toBe("OK");
    expect(w.founderCalendar.cancelled).toEqual([]);
  });
});
