import { describe, expect, it } from "vitest";

import type { MeetingView } from "@capital-q/communication";
import {
  ActorContextSchema,
  type ActorContextResolver,
} from "@capital-q/security";
import type { WorkSlotReaderResult } from "@capital-q/q-core";

import {
  createErrandRunner,
  type ErrandPatch,
  type ErrandRow,
  type ErrandStore,
} from "../src/composition/errands.js";
import { wallClock } from "../src/composition/slots.js";

/**
 * Booking without Google (founder direction 2026-10-02): the owner has no
 * calendar, so Q offers times in the chat once, reads the reply by
 * meaning, records the agreed meeting once with an emailed invite, and
 * says "link to follow". Every wait names what it waits for; the other
 * side hears about Q's first message and the proposed times.
 */

const USER = "00000000-0000-4000-8000-0000000000b1";
const TENANT = "00000000-0000-4000-8000-00000000000a";
const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const MEETING = "00000000-0000-4000-8000-0000000000e1";
const NOW = new Date("2026-10-02T09:00:00Z"); // a Friday
const ZONE = "Africa/Lagos";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});
const resolves: ActorContextResolver = {
  resolveHumanContext: () =>
    Promise.resolve({ status: "RESOLVED", context: actor }),
};

type Message = {
  id: string;
  viaQ: boolean;
  envelope: null;
  from: "OTHER_SIDE";
  senderName: string;
  kind: "TEXT";
  text: string;
  attachmentTitle: null;
  sentAt: string;
};

function world(read: (reply: string) => WorkSlotReaderResult | null) {
  let current: ErrandRow = {
    id: "00000000-0000-4000-8000-0000000000f1",
    tenant_id: TENANT,
    user_id: USER,
    organisation_id: null,
    q_action_id: "00000000-0000-4000-8000-0000000000d1",
    relationship_id: RELATIONSHIP,
    counterpart_name: "Ledgerfold",
    plan: {
      relationshipId: RELATIONSHIP,
      counterpartName: "Ledgerfold",
      expressInterest: false,
      openingMessage: "Hello from our fund, glad to be connected.",
      brief: null,
      bookCall: { purpose: "Intro call", durationMinutes: 30 },
    },
    stage: "WAITING_CONNECTION",
    seen_until: null,
    replies_sent: 0,
    meeting_id: null,
    expires_at: new Date(NOW.getTime() + 14 * 24 * 3_600_000),
    created_at: NOW,
    proposed_slots: null,
  };
  const messages: Message[] = [];
  const patches: ErrandPatch[] = [];
  const sent: { key: string; body: string }[] = [];
  const owner: string[] = [];
  const other: { kind: string; key: string }[] = [];
  const recorded: string[] = [];
  const invited: string[] = [];
  let clock = NOW;
  const view: MeetingView = {
    id: MEETING,
    relationshipId: RELATIONSHIP,
    purpose: "Intro call",
    startsAt: "2026-10-05T09:00:00.000Z",
    endsAt: "2026-10-05T09:30:00.000Z",
    timeZone: ZONE,
    status: "SCHEDULED",
    organisedByYou: true,
    organiserName: "Ada",
    meetLink: null,
    attendees: [],
    hasBrief: false,
  };
  const store: ErrandStore = {
    due: () => Promise.resolve([current]),
    dueFor: () => Promise.resolve([current]),
    authUserOf: () => Promise.resolve("00000000-0000-4000-8000-0000000000aa"),
    update: (_id, patch) => {
      patches.push(patch);
      current = {
        ...current,
        ...(patch.stage === undefined ? {} : { stage: patch.stage }),
        ...(patch.seenUntil === undefined
          ? {}
          : { seen_until: patch.seenUntil }),
        ...(patch.meetingId === undefined
          ? {}
          : { meeting_id: patch.meetingId }),
        ...(patch.proposedSlots === undefined
          ? {}
          : {
              proposed_slots: current.proposed_slots ?? [
                ...patch.proposedSlots,
              ],
            }),
      };
      return Promise.resolve();
    },
    meetingOf: () => Promise.resolve(current.meeting_id),
    notify: (notice) => {
      if (!owner.includes(notice.step)) owner.push(notice.step);
      return Promise.resolve();
    },
    list: () => Promise.resolve([]),
    stop: () => Promise.resolve(false),
  };
  const keys = new Set<string>();
  const runner = createErrandRunner({
    store,
    resolver: resolves,
    chat: {
      readForQ: () =>
        Promise.resolve({
          side: "INVESTOR" as const,
          connected: true,
          blocked: false,
          messages: [...messages],
        }),
      send: (input) => {
        if (input.request.kind === "TEXT" && !keys.has(input.idempotencyKey)) {
          keys.add(input.idempotencyKey);
          sent.push({ key: input.idempotencyKey, body: input.request.body });
        }
        return Promise.resolve(null);
      },
    },
    schedule: {
      findSlots: () =>
        Promise.resolve({
          outcome: "REFUSED" as const,
          code: "CALENDAR_NOT_CONNECTED" as const,
        }),
      schedule: () =>
        Promise.resolve({
          outcome: "REFUSED" as const,
          code: "CALENDAR_NOT_CONNECTED" as const,
        }),
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
    nameOf: () => Promise.resolve("Ada"),
    counterpartNotices: {
      notify: (input) => {
        const key = `${input.kind}:${input.key}`;
        if (other.some((entry) => `${entry.kind}:${entry.key}` === key)) {
          return Promise.resolve(0);
        }
        other.push({ kind: input.kind, key: input.key });
        return Promise.resolve(1);
      },
    },
    negotiation: {
      zoneOf: () => Promise.resolve(ZONE),
      readSlots: (input) => Promise.resolve(read(input.reply)),
      recordAgreed: (input) => {
        const first = !recorded.includes(input.idempotencyKey);
        if (first) recorded.push(input.idempotencyKey);
        return Promise.resolve({
          outcome: "OK" as const,
          meeting: { ...view, startsAt: input.startsAt.toISOString() },
          alreadyScheduled: !first,
          organiser: { name: "Ada", email: "ada@fund.example" },
          invitees: [{ name: "Femi", email: "femi@ledgerfold.example" }],
        });
      },
      sendInvites: (invite) => {
        invited.push(invite.meetingId);
        return Promise.resolve();
      },
    },
    now: () => clock,
  });
  return {
    runner,
    sent,
    owner,
    other,
    recorded,
    invited,
    patches,
    row: () => current,
    say: (text: string) => {
      clock = new Date(clock.getTime() + 60_000);
      messages.push({
        id: `00000000-0000-4000-8000-${String(messages.length + 1).padStart(12, "0")}`,
        viaQ: false,
        envelope: null,
        from: "OTHER_SIDE",
        senderName: "Femi",
        kind: "TEXT",
        text,
        attachmentTitle: null,
        sentAt: clock.toISOString(),
      });
    },
  };
}

describe("booking without Google", () => {
  it("offers 3 times once, in the owner's zone, and tells both sides", async () => {
    const w = world(() => ({
      answer: "NONE",
      pick: null,
      otherTime: null,
      quote: null,
    }));
    await w.runner.tick();
    await w.runner.tick();
    const offers = w.sent.filter((post) => post.key.endsWith(":slots"));
    expect(offers).toHaveLength(1);
    expect(offers[0]?.body).toContain("Would one of these suit you?");
    const slots = (w.row().proposed_slots as string[]).map(
      (iso) => new Date(iso),
    );
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect([10, 14]).toContain(wallClock(slot, ZONE).hour);
      // At least 18 hours ahead.
      expect(slot.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(
        18 * 3_600_000,
      );
    }
    expect(w.owner).toContain("slots-offered");
    expect(w.other.map((entry) => entry.kind).sort()).toEqual([
      "Q_MESSAGE",
      "TIME_PROPOSED",
    ]);
    expect(w.patches.at(-1)?.lastStep).toBe(
      "Waiting for Ledgerfold to pick one of the times Q offered.",
    );
  });

  it("books the time they pick, once, with an invite and 'link to follow'", async () => {
    const w = world(() => ({
      answer: "PICKED",
      pick: 2,
      otherTime: null,
      quote: "the second",
    }));
    await w.runner.tick();
    const slots = w.row().proposed_slots as string[];
    w.say("The second works for me");
    // A double event: woken twice.
    await Promise.all([
      w.runner.wake(RELATIONSHIP),
      w.runner.wake(RELATIONSHIP),
    ]);
    await w.runner.tick();
    expect(w.recorded).toEqual([
      `errand:${w.row().id}:agreed:${slots[1] ?? ""}`,
    ]);
    expect(w.invited).toEqual([MEETING]);
    // Booked, then (no brief to answer from) the errand is done.
    expect(w.patches.some((patch) => patch.stage === "CALL_BOOKED")).toBe(true);
    expect(w.row().meeting_id).toBe(MEETING);
    const agreed = w.sent.filter((post) => post.key.includes(":agreed:"));
    expect(agreed).toHaveLength(1);
    expect(agreed[0]?.body).toContain("A video link will follow.");
    expect(w.owner).toContain("call");
  });

  it("takes a time they name inside working hours, and asks the owner about one outside", async () => {
    const inside = world(() => ({
      answer: "OTHER_TIME",
      pick: null,
      otherTime: "2026-10-07T15:00:00+01:00",
      quote: "Wednesday at 3pm",
    }));
    await inside.runner.tick();
    inside.say("Could we do Wednesday at 3pm instead?");
    await inside.runner.tick();
    expect(inside.recorded).toEqual([
      `errand:${inside.row().id}:agreed:2026-10-07T14:00:00.000Z`,
    ]);

    const outside = world(() => ({
      answer: "OTHER_TIME",
      pick: null,
      otherTime: "2026-10-07T21:00:00+01:00",
      quote: "Wednesday 9pm",
    }));
    await outside.runner.tick();
    outside.say("Wednesday 9pm?");
    await outside.runner.tick();
    expect(outside.recorded).toEqual([]);
    expect(
      outside.owner.some((step) => step.startsWith("call-suggested:")),
    ).toBe(true);
    expect(outside.row().stage).toBe("CONVERSING");
  });

  it("never books on an unclear reply or a pick it did not offer", async () => {
    const unclear = world(() => ({
      answer: "NONE",
      pick: null,
      otherTime: null,
      quote: null,
    }));
    await unclear.runner.tick();
    unclear.say("Let me check with my cofounder");
    await unclear.runner.tick();
    expect(unclear.recorded).toEqual([]);

    const bogus = world(() => ({
      answer: "PICKED",
      pick: 5,
      otherTime: null,
      quote: "five",
    }));
    await bogus.runner.tick();
    bogus.say("number five");
    await bogus.runner.tick();
    expect(bogus.recorded).toEqual([]);
  });
});
