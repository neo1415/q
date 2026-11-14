import type { ActorContext } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  createMeetingProposalPort,
  createProposalService,
  createScheduleService,
  meetingTimeLabel,
  PROPOSAL_TRANSITIONS,
  transitionProposal,
  type ChatParty,
  type ProposalEvent,
  type ProposalParties,
  type ProposalRecord,
  type ProposalState,
  type ProposalStore,
  type ScheduleService,
  type TimeOption,
} from "../src/index.js";
import { timesOf } from "../src/schedule/proposal-port.js";
import {
  createFakeAppEmail,
  createFakeCalendar,
  createInMemoryScheduleStore,
  createRecordingMeetingActivity,
  createStaticMeetingDirectory,
  inlineScheduleTransactions,
} from "../src/testing/index.js";

/**
 * A meeting time is a proposal the investor accepts (live bug 2026-10-09).
 * Pure: an in-memory store, no provider.
 */

const REL = "00000000-0000-4000-8000-00000000d001";
const TENANT = "00000000-0000-4000-8000-0000000000a1";
const FOUNDER = "founder-user";
const INVESTOR = "investor-user";
const OUTSIDER = "outsider-user";
const OBSERVER = "investor-observer";
const NOW = new Date("2026-10-12T09:00:00Z");

const slot = (day: number): TimeOption => ({
  startsAt: `2026-10-${String(day)}T10:00:00.000Z`,
  endsAt: `2026-10-${String(day)}T10:30:00.000Z`,
  timeZone: "Europe/London",
});

function memoryStore() {
  const proposals = new Map<string, ProposalRecord>();
  const events: ProposalEvent[] = [];
  const store: ProposalStore = {
    find: (id) => Promise.resolve(proposals.get(id) ?? null),
    findEvent: (id, key) =>
      Promise.resolve(
        events.find((e) => e.proposalId === id && e.idempotencyKey === key) ??
          null,
      ),
    findByKey: (rel, key) =>
      Promise.resolve(
        [...proposals.values()].find(
          (p) => p.relationshipId === rel && p.idempotencyKey === key,
        ) ?? null,
      ),
    listForRelationship: (rel) =>
      Promise.resolve(
        [...proposals.values()].filter((p) => p.relationshipId === rel),
      ),
    create: (record, event) => {
      proposals.set(record.id, record);
      events.push(event);
      return Promise.resolve();
    },
    apply: ({ id, expected, patch, event }) => {
      const current = proposals.get(id);
      if (current === undefined || current.state !== expected) {
        return Promise.resolve(false);
      }
      if (
        events.some(
          (e) =>
            e.proposalId === id && e.idempotencyKey === event.idempotencyKey,
        )
      ) {
        return Promise.resolve(false);
      }
      proposals.set(id, {
        ...current,
        state: event.toState,
        options: patch.options ?? current.options,
        counterOptions:
          patch.counterOptions === undefined
            ? current.counterOptions
            : patch.counterOptions,
        acceptedFrom: patch.accepted?.from ?? current.acceptedFrom,
        acceptedOption: patch.accepted?.option ?? current.acceptedOption,
        acceptedByUserId: patch.accepted?.byUserId ?? current.acceptedByUserId,
        acceptedAt: patch.accepted?.at ?? current.acceptedAt,
        revision: current.revision + (patch.revisionIncrement === true ? 1 : 0),
      });
      events.push(event);
      return Promise.resolve(true);
    },
    attachMeeting: (id, meetingId) => {
      const current = proposals.get(id);
      if (current !== undefined) proposals.set(id, { ...current, meetingId });
      return Promise.resolve();
    },
  };
  return { store, proposals, events };
}

const parties: ProposalParties = ({ actorUserId, relationshipId }) => {
  if (relationshipId !== REL) return Promise.resolve(null);
  if (actorUserId === FOUNDER)
    return Promise.resolve({ tenantId: TENANT, side: "FOUNDER", binds: true });
  if (actorUserId === INVESTOR)
    return Promise.resolve({ tenantId: TENANT, side: "INVESTOR", binds: true });
  // An investor-side member without authority to bind (an observer).
  if (actorUserId === OBSERVER)
    return Promise.resolve({
      tenantId: TENANT,
      side: "INVESTOR",
      binds: false,
    });
  return Promise.resolve(null);
};

function setup(options: { bookFails?: boolean } = {}) {
  const mem = memoryStore();
  const booked: { key: string; option: TimeOption }[] = [];
  let n = 0;
  let failing = options.bookFails === true;
  const service = createProposalService({
    store: mem.store,
    parties,
    now: () => NOW,
    newId: () =>
      `00000000-0000-4000-8000-0000000e${String((n += 1)).padStart(4, "0")}`,
    book: ({ proposal, option, idempotencyKey }) => {
      if (failing) return Promise.reject(new Error("calendar down"));
      if (!booked.some((b) => b.key === idempotencyKey)) {
        booked.push({ key: idempotencyKey, option });
      }
      return Promise.resolve({ meetingId: `meeting-for-${proposal.id}` });
    },
  });
  return { ...mem, service, booked, heal: () => (failing = false) };
}

async function proposed(s: ReturnType<typeof setup>) {
  const out = await s.service.propose({
    actorUserId: FOUNDER,
    relationshipId: REL,
    purpose: "Intro call",
    options: [slot(14), slot(15)],
    idempotencyKey: "founder-propose-1",
  });
  if (out.outcome !== "OK") throw new Error("propose refused");
  return out.proposal;
}

describe("the meeting time state machine", () => {
  it("is exactly PROPOSED -> INVESTOR_REVIEW -> CONFIRMED | DECLINED | COUNTERPROPOSED", () => {
    const edges = Object.entries(PROPOSAL_TRANSITIONS).flatMap(
      ([from, actions]) =>
        Object.values(actions ?? {}).map((rule) => `${from}>${rule.to}`),
    );
    expect(edges.sort()).toEqual(
      [
        "PROPOSED>INVESTOR_REVIEW",
        "INVESTOR_REVIEW>CONFIRMED",
        "INVESTOR_REVIEW>DECLINED",
        "INVESTOR_REVIEW>COUNTERPROPOSED",
        "COUNTERPROPOSED>CONFIRMED",
        "COUNTERPROPOSED>DECLINED",
        "COUNTERPROPOSED>PROPOSED",
      ].sort(),
    );
  });

  it("per role: only the investor accepts, declines or counters a proposal; only the founder answers a counter", () => {
    expect(transitionProposal("INVESTOR_REVIEW", "INVESTOR", "ACCEPT").ok).toBe(
      true,
    );
    expect(
      transitionProposal("INVESTOR_REVIEW", "INVESTOR", "DECLINE").ok,
    ).toBe(true);
    expect(
      transitionProposal("INVESTOR_REVIEW", "INVESTOR", "COUNTER").ok,
    ).toBe(true);
    for (const action of ["ACCEPT", "DECLINE", "COUNTER"] as const) {
      expect(transitionProposal("INVESTOR_REVIEW", "FOUNDER", action)).toEqual({
        ok: false,
        reason: "ROLE_NOT_ALLOWED",
      });
      expect(transitionProposal("INVESTOR_REVIEW", "SYSTEM", action).ok).toBe(
        false,
      );
    }
    expect(
      transitionProposal("COUNTERPROPOSED", "FOUNDER", "ACCEPT_COUNTER").ok,
    ).toBe(true);
    expect(
      transitionProposal("COUNTERPROPOSED", "INVESTOR", "ACCEPT_COUNTER"),
    ).toEqual({
      ok: false,
      reason: "ROLE_NOT_ALLOWED",
    });
    expect(transitionProposal("PROPOSED", "SYSTEM", "SEND_FOR_REVIEW").ok).toBe(
      true,
    );
    expect(
      transitionProposal("PROPOSED", "FOUNDER", "SEND_FOR_REVIEW").ok,
    ).toBe(false);
  });

  it("terminal states move nowhere", () => {
    for (const state of ["CONFIRMED", "DECLINED"] as ProposalState[]) {
      for (const role of ["FOUNDER", "INVESTOR", "SYSTEM"] as const) {
        for (const action of [
          "ACCEPT",
          "DECLINE",
          "COUNTER",
          "ACCEPT_COUNTER",
          "REPROPOSE",
        ] as const) {
          expect(transitionProposal(state, role, action).ok).toBe(false);
        }
      }
    }
  });
});

describe("meeting time proposals: nothing is booked until the investor accepts", () => {
  it("a founder's proposal goes to investor review and books nothing", async () => {
    const s = setup();
    const p = await proposed(s);
    expect(p.state).toBe("INVESTOR_REVIEW");
    expect(s.booked).toEqual([]);
    expect(s.events.map((e) => e.eventType)).toEqual([
      "PROPOSED",
      "SENT_FOR_REVIEW",
    ]);
  });

  it("the founder cannot confirm their own proposal (unauthorised confirmation is refused)", async () => {
    const s = setup();
    const p = await proposed(s);
    const out = await s.service.respond({
      actorUserId: FOUNDER,
      proposalId: p.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: "founder-self-accept",
    });
    expect(out).toEqual({ outcome: "REFUSED", reason: "ROLE_NOT_ALLOWED" });
    expect(s.proposals.get(p.id)?.state).toBe("INVESTOR_REVIEW");
    expect(s.booked).toEqual([]);
  });

  it("someone who is not a party, or has no authority to bind, cannot confirm", async () => {
    const s = setup();
    const p = await proposed(s);
    for (const [who, reason] of [
      [OUTSIDER, "NOT_A_PARTY"],
      [OBSERVER, "NOT_AUTHORISED"],
    ] as const) {
      const out = await s.service.respond({
        actorUserId: who,
        proposalId: p.id,
        action: "ACCEPT",
        optionIndex: 0,
        idempotencyKey: `try-${who}`,
      });
      expect(out).toEqual({ outcome: "REFUSED", reason });
    }
    expect(s.proposals.get(p.id)?.state).toBe("INVESTOR_REVIEW");
    expect(s.booked).toEqual([]);
  });

  it("a non-party cannot even propose, and the investor cannot propose as the founder", async () => {
    const s = setup();
    const base = {
      relationshipId: REL,
      purpose: "x",
      options: [slot(14)],
      idempotencyKey: "k-propose-x",
    };
    expect(await s.service.propose({ ...base, actorUserId: OUTSIDER })).toEqual(
      {
        outcome: "REFUSED",
        reason: "NOT_A_PARTY",
      },
    );
    expect(await s.service.propose({ ...base, actorUserId: INVESTOR })).toEqual(
      {
        outcome: "REFUSED",
        reason: "ROLE_NOT_ALLOWED",
      },
    );
  });

  it("the investor's explicit acceptance is recorded, attributed, and only then booked", async () => {
    const s = setup();
    const p = await proposed(s);
    const out = await s.service.respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "ACCEPT",
      optionIndex: 1,
      idempotencyKey: "investor-accept-1",
    });
    expect(out).toMatchObject({
      outcome: "OK",
      recorded: true,
      confirmed: true,
      booked: true,
    });
    const after = s.proposals.get(p.id);
    expect(after).toMatchObject({
      state: "CONFIRMED",
      acceptedByUserId: INVESTOR,
      acceptedOption: 1,
      acceptedFrom: "OPTIONS",
      meetingId: `meeting-for-${p.id}`,
    });
    expect(s.booked).toHaveLength(1);
    expect(s.booked[0]?.option).toEqual(slot(15));
    expect(s.events.at(-1)).toMatchObject({
      eventType: "ACCEPTED",
      actorUserId: INVESTOR,
      actorSide: "INVESTOR",
      idempotencyKey: "investor-accept-1",
    });
  });

  it("acceptance is idempotent: the same key twice records and books once", async () => {
    const s = setup();
    const p = await proposed(s);
    const input = {
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "ACCEPT" as const,
      optionIndex: 0,
      idempotencyKey: "investor-accept-same",
    };
    const first = await s.service.respond(input);
    const second = await s.service.respond(input);
    expect(first).toMatchObject({ recorded: true });
    expect(second).toMatchObject({
      outcome: "OK",
      recorded: false,
      confirmed: true,
    });
    expect(s.events.filter((e) => e.eventType === "ACCEPTED")).toHaveLength(1);
    expect(s.booked).toHaveLength(1);
    // A different key after it is confirmed is not a second acceptance.
    expect(
      await s.service.respond({
        ...input,
        idempotencyKey: "investor-accept-other",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "INVALID_STATE" });
  });

  it("a failed booking leaves the acceptance recorded and is retried without a second booking", async () => {
    const s = setup({ bookFails: true });
    const p = await proposed(s);
    const out = await s.service.respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: "investor-accept-2",
    });
    expect(out).toMatchObject({
      outcome: "OK",
      confirmed: true,
      booked: false,
    });
    expect(s.proposals.get(p.id)?.state).toBe("CONFIRMED");
    s.heal();
    const retry = await s.service.completeBooking({
      actorUserId: FOUNDER,
      proposalId: p.id,
    });
    expect(retry).toMatchObject({ confirmed: true, booked: true });
    await s.service.completeBooking({ actorUserId: FOUNDER, proposalId: p.id });
    expect(s.booked).toHaveLength(1);
  });

  it("decline ends it without a booking", async () => {
    const s = setup();
    const p = await proposed(s);
    const out = await s.service.respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "DECLINE",
      idempotencyKey: "investor-decline-1",
    });
    expect(out).toMatchObject({ outcome: "OK", confirmed: false });
    expect(s.proposals.get(p.id)?.state).toBe("DECLINED");
    expect(s.booked).toEqual([]);
  });

  it("counterproposal: the investor offers times, the founder accepts one, and then it is booked", async () => {
    const s = setup();
    const p = await proposed(s);
    const counter = await s.service.respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "COUNTER",
      options: [slot(20), slot(21)],
      idempotencyKey: "investor-counter-1",
    });
    expect(counter).toMatchObject({ outcome: "OK", confirmed: false });
    expect(s.proposals.get(p.id)?.state).toBe("COUNTERPROPOSED");
    expect(s.booked).toEqual([]);
    // The investor cannot accept their own counter.
    expect(
      await s.service.respond({
        actorUserId: INVESTOR,
        proposalId: p.id,
        action: "ACCEPT_COUNTER",
        optionIndex: 0,
        idempotencyKey: "investor-self-counter",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "ROLE_NOT_ALLOWED" });
    const accepted = await s.service.respond({
      actorUserId: FOUNDER,
      proposalId: p.id,
      action: "ACCEPT_COUNTER",
      optionIndex: 1,
      idempotencyKey: "founder-accept-counter",
    });
    expect(accepted).toMatchObject({ confirmed: true, booked: true });
    expect(s.proposals.get(p.id)).toMatchObject({
      state: "CONFIRMED",
      acceptedFrom: "COUNTER_OPTIONS",
    });
    expect(s.booked[0]?.option).toEqual(slot(21));
  });

  it("the founder can re-propose after a counter; the loop returns to investor review", async () => {
    const s = setup();
    const p = await proposed(s);
    await s.service.respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "COUNTER",
      options: [slot(20)],
      idempotencyKey: "investor-counter-2",
    });
    const again = await s.service.respond({
      actorUserId: FOUNDER,
      proposalId: p.id,
      action: "REPROPOSE",
      options: [slot(22)],
      idempotencyKey: "founder-repropose-1",
    });
    expect(again).toMatchObject({ outcome: "OK" });
    expect(s.proposals.get(p.id)).toMatchObject({
      state: "INVESTOR_REVIEW",
      revision: 2,
      counterOptions: null,
    });
    expect(s.booked).toEqual([]);
  });

  it("rejects bad options and option indexes", async () => {
    const s = setup();
    expect(
      await s.service.propose({
        actorUserId: FOUNDER,
        relationshipId: REL,
        purpose: "Intro",
        options: [
          {
            ...slot(14),
            startsAt: "2020-01-01T10:00:00.000Z",
            endsAt: "2020-01-01T10:30:00.000Z",
          },
        ],
        idempotencyKey: "founder-past",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "INVALID_OPTIONS" });
    const p = await proposed(s);
    expect(
      await s.service.respond({
        actorUserId: INVESTOR,
        proposalId: p.id,
        action: "ACCEPT",
        optionIndex: 7,
        idempotencyKey: "investor-bad-index",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "INVALID_OPTION_INDEX" });
  });

  it("a reschedule is the same negotiation, and the existing meeting is untouched until it is accepted", async () => {
    const s = setup();
    const out = await s.service.propose({
      actorUserId: FOUNDER,
      relationshipId: REL,
      purpose: "Intro call",
      options: [slot(18)],
      rescheduleOfMeetingId: "meeting-existing",
      idempotencyKey: "founder-reschedule-1",
    });
    if (out.outcome !== "OK") throw new Error("refused");
    expect(out.proposal).toMatchObject({
      state: "INVESTOR_REVIEW",
      rescheduleOfMeetingId: "meeting-existing",
    });
    expect(s.booked).toEqual([]);
    await s.service.respond({
      actorUserId: INVESTOR,
      proposalId: out.proposal.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: "investor-accept-resched",
    });
    expect(s.booked).toHaveLength(1);
  });

  it("an existing confirmed meeting (backfilled CONFIRMED) cannot be moved by anyone's response", async () => {
    const s = setup();
    const legacy: ProposalRecord = {
      id: "00000000-0000-4000-8000-0000000e9999",
      tenantId: TENANT,
      relationshipId: REL,
      purpose: "Existing call",
      proposedByUserId: FOUNDER,
      state: "CONFIRMED",
      options: [slot(16)],
      counterOptions: null,
      acceptedFrom: "OPTIONS",
      acceptedOption: 0,
      acceptedByUserId: FOUNDER,
      acceptedAt: new Date("2026-10-01T00:00:00Z"),
      rescheduleOfMeetingId: null,
      meetingId: "meeting-legacy",
      revision: 1,
      idempotencyKey: "legacy-meeting:abc",
    };
    s.proposals.set(legacy.id, legacy);
    for (const action of ["DECLINE", "COUNTER", "ACCEPT"] as const) {
      expect(
        await s.service.respond({
          actorUserId: INVESTOR,
          proposalId: legacy.id,
          action,
          optionIndex: 0,
          options: [slot(17)],
          idempotencyKey: `legacy-${action}`,
        }),
      ).toEqual({ outcome: "REFUSED", reason: "INVALID_STATE" });
    }
    expect(s.proposals.get(legacy.id)).toEqual(legacy);
    expect(s.booked).toEqual([]);
  });

  it("two simultaneous responses: one wins, the other is a conflict", async () => {
    const s = setup();
    const p = await proposed(s);
    const [a, b] = await Promise.all([
      s.service.respond({
        actorUserId: INVESTOR,
        proposalId: p.id,
        action: "ACCEPT",
        optionIndex: 0,
        idempotencyKey: "race-accept",
      }),
      s.service.respond({
        actorUserId: INVESTOR,
        proposalId: p.id,
        action: "DECLINE",
        idempotencyKey: "race-decline",
      }),
    ]);
    const results = [a, b].map((r) => (r.outcome === "OK" ? "OK" : r.reason));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(s.booked.length).toBeLessThanOrEqual(1);
  });
});

/**
 * B1/B2 (2026-11-14): the composed port. Acceptance without a calendar
 * still records the meeting (the honest no-invite record); a proposal and a
 * counter each tell the other side, once.
 */
describe("the meeting proposal port: no-calendar acceptance and notices", () => {
  const actorOf = (userId: string): ActorContext =>
    ({
      userId,
      tenantId: TENANT,
      organisationId: "00000000-0000-4000-8000-0000000000c1",
      membershipId: "00000000-0000-4000-8000-0000000000e1",
      actorType: "HUMAN",
    }) as ActorContext;

  type Booked = Awaited<ReturnType<ScheduleService["schedule"]>>;
  type Agreed = Awaited<ReturnType<ScheduleService["recordAgreed"]>>;
  const view = (id: string, startsAt: Date, meetLink: string | null) => ({
    id,
    relationshipId: REL,
    purpose: "Intro call",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
    timeZone: "Europe/London",
    status: "SCHEDULED" as const,
    organisedByYou: true,
    organiserName: "Investor",
    meetLink,
    attendees: [],
    hasBrief: false,
  });

  function composed(calendar: "CONNECTED" | "NONE" | "REVOKED") {
    const mem = memoryStore();
    const calendarBookings = new Map<string, string>();
    const agreed = new Map<
      string,
      { meetingId: string; actorUserId: string; note: string | undefined }
    >();
    // The notifications table: one row per (side told, dedupe key).
    const notices = new Map<
      string,
      {
        title: string;
        body: string | null;
        /** As a recipient whose profile says New York reads it. */
        inNewYork: string | null;
      }
    >();
    const port = createMeetingProposalPort({
      transactions: {
        run: () => Promise.reject(new Error("no database in this test")),
      },
      store: mem.store,
      parties,
      counterpartNotices: {
        notify: (input) => {
          const told = input.actingSide === "INVESTOR" ? "FOUNDER" : "INVESTOR";
          const key = `${told}:${input.kind.toLowerCase()}:${input.key}`;
          if (notices.has(key)) return Promise.resolve(0);
          notices.set(key, {
            title: input.title,
            body: input.body,
            inNewYork: input.bodyInZone?.("America/New_York") ?? null,
          });
          return Promise.resolve(1);
        },
      },
      schedule: {
        schedule: (input): Promise<Booked> => {
          if (calendar !== "CONNECTED") {
            return Promise.resolve({
              outcome: "REFUSED",
              code:
                calendar === "REVOKED"
                  ? "CALENDAR_REVOKED"
                  : "CALENDAR_NOT_CONNECTED",
            });
          }
          const id =
            calendarBookings.get(input.idempotencyKey) ??
            `calendar-${String(calendarBookings.size + 1)}`;
          calendarBookings.set(input.idempotencyKey, id);
          return Promise.resolve({
            outcome: "OK",
            meeting: view(id, input.startsAt, "https://meet.google.com/abc"),
            alreadyScheduled: false,
          });
        },
        recordAgreed: (input): Promise<Agreed> => {
          if (input.actor.actorType !== "HUMAN") {
            return Promise.resolve({ outcome: "REFUSED", code: "NOT_A_PARTY" });
          }
          const existing = agreed.get(input.idempotencyKey);
          const meetingId =
            existing?.meetingId ?? `agreed-${String(agreed.size + 1)}`;
          agreed.set(input.idempotencyKey, {
            meetingId,
            actorUserId: input.actor.userId,
            note: input.noInviteNote,
          });
          return Promise.resolve({
            outcome: "OK",
            meeting: view(meetingId, input.startsAt, null),
            alreadyScheduled: existing !== undefined,
            organiser: { name: "Investor", email: "i@example.invalid" },
            invitees: [],
          });
        },
      },
    });
    const as = (userId: string) =>
      port.forActor(
        actorOf(userId),
        "cor_00000000-0000-4000-8000-000000000001",
      );
    return { ...mem, port, as, calendarBookings, agreed, notices };
  }

  // Far enough ahead that the service's real clock still sees them ahead.
  const ahead = (days: number): TimeOption => {
    const start = new Date(Date.now() + days * 24 * 3_600_000);
    start.setUTCHours(10, 0, 0, 0);
    return {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      timeZone: "Europe/London",
    };
  };

  async function proposedVia(c: ReturnType<typeof composed>) {
    const out = await c.as(FOUNDER).propose({
      actorUserId: FOUNDER,
      relationshipId: REL,
      purpose: "Intro call",
      options: [ahead(3), ahead(4)],
      idempotencyKey: "founder-propose-1",
    });
    if (out.outcome !== "OK") throw new Error("proposal refused");
    return out.proposal;
  }

  it("accepting without a calendar records the meeting as the accepting investor, with an honest no-invite note", async () => {
    const c = composed("NONE");
    const p = await proposedVia(c);
    const out = await c.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: "investor-accept-1",
    });
    expect(out).toMatchObject({
      outcome: "OK",
      confirmed: true,
      booked: true,
      calendarInvite: false,
    });
    expect(c.proposals.get(p.id)).toMatchObject({
      state: "CONFIRMED",
      meetingId: "agreed-1",
    });
    expect(c.calendarBookings.size).toBe(0);
    const records = [...c.agreed.values()];
    expect(records).toHaveLength(1);
    expect(records[0]?.meetingId).toBe("agreed-1");
    expect(records[0]?.actorUserId).toBe(INVESTOR);
    expect(records[0]?.note).toContain(
      "No calendar invite was sent: no Google Calendar is connected.",
    );
    expect(records[0]?.note).toContain("connect Google Calendar in Settings");
    // A retry under the same key: one meeting, no second record.
    const again = await c.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: "investor-accept-1",
    });
    expect(again).toMatchObject({ outcome: "OK", booked: true });
    expect(c.agreed.size).toBe(1);
    expect(c.proposals.get(p.id)?.meetingId).toBe("agreed-1");
  });

  it("a revoked calendar says reconnect", async () => {
    const c = composed("REVOKED");
    const p = await proposedVia(c);
    await c.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "ACCEPT",
      optionIndex: 1,
      idempotencyKey: "investor-accept-1",
    });
    expect([...c.agreed.values()][0]?.note).toContain(
      "reconnect Google Calendar in Settings",
    );
  });

  it("with a calendar connected, the calendar booking is used and nothing is recorded without it", async () => {
    const c = composed("CONNECTED");
    const p = await proposedVia(c);
    const out = await c.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: "investor-accept-1",
    });
    expect(out).toMatchObject({
      outcome: "OK",
      booked: true,
      calendarInvite: true,
    });
    expect(c.proposals.get(p.id)?.meetingId).toBe("calendar-1");
    expect(c.agreed.size).toBe(0);
  });

  it("a proposal tells the investor once, and a counter tells the founder once, however often retried", async () => {
    const c = composed("NONE");
    const p = await proposedVia(c);
    // A retried proposal: the same key, the same notice.
    await proposedVia(c);
    expect([...c.notices.keys()]).toEqual([
      `INVESTOR:time_proposed:proposal:${p.id}:r1`,
    ]);
    const counter = {
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "COUNTER" as const,
      options: [ahead(6)],
      idempotencyKey: "investor-counter-1",
    };
    await c.as(INVESTOR).respond(counter);
    await c.as(INVESTOR).respond(counter);
    expect([...c.notices.keys()]).toEqual([
      `INVESTOR:time_proposed:proposal:${p.id}:r1`,
      `FOUNDER:time_proposed:proposal:${p.id}:r1:counter`,
    ]);
    const told = c.notices.get(
      `FOUNDER:time_proposed:proposal:${p.id}:r1:counter`,
    );
    expect(told?.title).toBe("{actor} suggested other times for the call");
    // Local time in the option's zone, labelled; never the raw instant.
    expect(told?.body).toContain(
      `1. ${meetingTimeLabel(ahead(6).startsAt, "Europe/London")}`,
    );
    expect(told?.body).not.toContain(ahead(6).startsAt);
    // A founder whose profile names New York reads their own local time.
    expect(told?.inNewYork).toContain(
      `1. ${meetingTimeLabel(ahead(6).startsAt, "America/New_York")}`,
    );
    // The founder re-proposes: a new revision, a new notice for the investor.
    await c.as(FOUNDER).respond({
      actorUserId: FOUNDER,
      proposalId: p.id,
      action: "REPROPOSE",
      options: [ahead(7)],
      idempotencyKey: "founder-repropose-1",
    });
    expect(c.notices.has(`INVESTOR:time_proposed:proposal:${p.id}:r2`)).toBe(
      true,
    );
    expect(c.notices.size).toBe(3);
  });

  // Live audit 2026-11-14 D3: the decline action said the other side is
  // told, and nobody was.
  it("declining tells the side that was waiting, once per proposal and revision", async () => {
    const c = composed("NONE");
    const p = await proposedVia(c);
    const counter = {
      actorUserId: INVESTOR,
      proposalId: p.id,
      action: "COUNTER" as const,
      options: [ahead(6)],
      idempotencyKey: "investor-counter-1",
    };
    await c.as(INVESTOR).respond(counter);
    const decline = {
      actorUserId: FOUNDER,
      proposalId: p.id,
      action: "DECLINE_COUNTER" as const,
      idempotencyKey: "founder-decline-1",
    };
    const out = await c.as(FOUNDER).respond(decline);
    expect(out).toMatchObject({
      outcome: "OK",
      proposal: { state: "DECLINED" },
    });
    // A retry under the same key: the same notice, not a second one.
    await c.as(FOUNDER).respond(decline);
    const key = `INVESTOR:time_proposed:proposal:${p.id}:r1:counter-declined`;
    expect([...c.notices.keys()].filter((k) => k.includes("declined"))).toEqual(
      [key],
    );
    expect(c.notices.get(key)?.title).toBe(
      "{actor} declined the times you suggested",
    );
    expect(c.notices.get(key)?.body).toContain(
      meetingTimeLabel(ahead(6).startsAt, "Europe/London"),
    );
    expect(c.notices.get(key)?.body).toContain("Nothing is booked.");

    // The investor declining the founder's times tells the founder.
    const q = await (async () => {
      const again = await c.as(FOUNDER).propose({
        actorUserId: FOUNDER,
        relationshipId: REL,
        purpose: "Second call",
        options: [ahead(8)],
        idempotencyKey: "founder-propose-2",
      });
      if (again.outcome !== "OK") throw new Error("refused");
      return again.proposal;
    })();
    await c.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: q.id,
      action: "DECLINE",
      idempotencyKey: "investor-decline-1",
    });
    expect(
      c.notices.get(`FOUNDER:time_proposed:proposal:${q.id}:r1:declined`)
        ?.title,
    ).toBe("{actor} declined the proposed call times");
  });

  it("a recipient with a known zone reads the times in their own zone", () => {
    const option: TimeOption = {
      startsAt: "2026-11-17T09:00:00.000Z",
      endsAt: "2026-11-17T09:30:00.000Z",
      timeZone: "Africa/Lagos",
    };
    // The live defect: "2026-11-17T09:00:00.000Z (Africa/Lagos)".
    expect(timesOf([option])).toBe("1. Tue 17 Nov, 10:00 West Africa Time");
    expect(timesOf([option], "Europe/London")).toBe("1. Tue 17 Nov, 09:00 GMT");
  });

  it("a non-party or another relationship is refused: nothing recorded, nobody told", async () => {
    const c = composed("NONE");
    expect(
      await c.as(OUTSIDER).propose({
        actorUserId: OUTSIDER,
        relationshipId: REL,
        purpose: "Intro call",
        options: [ahead(3)],
        idempotencyKey: "outsider-1",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "NOT_A_PARTY" });
    expect(
      await c.as(FOUNDER).propose({
        actorUserId: FOUNDER,
        relationshipId: "00000000-0000-4000-8000-00000000d999",
        purpose: "Intro call",
        options: [ahead(3)],
        idempotencyKey: "other-tenant-1",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "NOT_A_PARTY" });
    const p = await proposedVia(c);
    expect(
      await c.as(OUTSIDER).respond({
        actorUserId: OUTSIDER,
        proposalId: p.id,
        action: "ACCEPT",
        optionIndex: 0,
        idempotencyKey: "outsider-accept",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "NOT_A_PARTY" });
    expect(
      await c.as(OBSERVER).respond({
        actorUserId: OBSERVER,
        proposalId: p.id,
        action: "ACCEPT",
        optionIndex: 0,
        idempotencyKey: "observer-accept",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "NOT_AUTHORISED" });
    expect(c.agreed.size).toBe(0);
    expect(c.notices.size).toBe(1);
  });
});

/**
 * Live audit 2026-11-14 D7: accepting a "move" proposal moves the meeting it
 * names (one row, the new time, `meeting_rescheduled`), never books a second
 * one; a cancelled, past or foreign meeting is refused. D8: each side's
 * decline notice names the step that is theirs. The real schedule service
 * over its in-memory store, composed with the proposal port.
 */
describe("a move proposal moves the meeting (D7) and decline wording (D8)", () => {
  const COMPANY_TENANT = "00000000-0000-4000-8000-0000000000a1";
  const INVESTOR_TENANT = "00000000-0000-4000-8000-0000000000a2";
  const actorOf = (userId: string): ActorContext =>
    ({
      userId,
      tenantId: userId === FOUNDER ? COMPANY_TENANT : INVESTOR_TENANT,
      organisationId: "00000000-0000-4000-8000-0000000000c1",
      membershipId: "00000000-0000-4000-8000-0000000000e1",
      actorType: "HUMAN",
    }) as ActorContext;

  const ahead = (days: number, hour = 10): TimeOption => {
    const start = new Date(Date.now() + days * 24 * 3_600_000);
    start.setUTCHours(hour, 0, 0, 0);
    return {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      timeZone: "Africa/Lagos",
    };
  };

  function world(calendar: "CONNECTED" | "NONE") {
    const scheduleStore = createInMemoryScheduleStore();
    const activity = createRecordingMeetingActivity();
    const investorCalendar = createFakeCalendar("ben@vc.example.invalid");
    let ids = 0;
    const schedule = createScheduleService({
      store: scheduleStore,
      transactions: inlineScheduleTransactions,
      parties: (a, relationshipId) => {
        if (relationshipId !== REL) return Promise.resolve(null);
        const party: ChatParty | null =
          a.userId === INVESTOR
            ? { side: "INVESTOR", connected: true }
            : a.userId === FOUNDER
              ? { side: "COMPANY", connected: true }
              : null;
        return Promise.resolve(party);
      },
      directory: createStaticMeetingDirectory({
        relationshipTenant: COMPANY_TENANT,
        people: {
          COMPANY: [
            {
              userId: FOUNDER,
              tenantId: COMPANY_TENANT,
              name: "Ada",
              email: "ada@co.example.invalid",
            },
          ],
          INVESTOR_ORGANISATION: [
            {
              userId: INVESTOR,
              tenantId: INVESTOR_TENANT,
              name: "Ben",
              email: "ben@vc.example.invalid",
            },
          ],
        },
        persons: {
          [INVESTOR]: { name: "Ben", email: "ben@vc.example.invalid" },
          [FOUNDER]: { name: "Ada", email: "ada@co.example.invalid" },
        },
      }),
      calendars: (userId) =>
        Promise.resolve(
          calendar === "CONNECTED" && userId === INVESTOR
            ? investorCalendar
            : null,
        ),
      calendarState: () =>
        Promise.resolve(
          calendar === "CONNECTED" ? "CONNECTED" : "NOT_CONNECTED",
        ),
      activity,
      email: createFakeAppEmail(),
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    });
    const mem = memoryStore();
    const notices: { title: string; body: string | null }[] = [];
    const port = createMeetingProposalPort({
      transactions: {
        run: () => Promise.reject(new Error("no database in this test")),
      },
      store: mem.store,
      parties,
      schedule,
      counterpartNotices: {
        notify: (input) => {
          notices.push({ title: input.title, body: input.body });
          return Promise.resolve(1);
        },
      },
    });
    const as = (userId: string) =>
      port.forActor(
        actorOf(userId),
        "cor_00000000-0000-4000-8000-000000000009",
      );
    return {
      schedule,
      scheduleStore,
      activity,
      investorCalendar,
      mem,
      as,
      notices,
    };
  }

  /** A booked call: proposed by the founder, accepted by the investor. */
  async function booked(w: ReturnType<typeof world>) {
    const first = await w.as(FOUNDER).propose({
      actorUserId: FOUNDER,
      relationshipId: REL,
      purpose: "Intro call",
      options: [ahead(3)],
      idempotencyKey: "founder-first",
    });
    if (first.outcome !== "OK") throw new Error("first proposal refused");
    const accepted = await w.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: first.proposal.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: "investor-first",
    });
    if (accepted.outcome !== "OK" || accepted.proposal.meetingId === null)
      throw new Error("first call not booked");
    return accepted.proposal.meetingId;
  }

  async function proposeMove(
    w: ReturnType<typeof world>,
    meetingId: string,
    key = "founder-move",
  ) {
    return w.as(FOUNDER).propose({
      actorUserId: FOUNDER,
      relationshipId: REL,
      purpose: "Intro call",
      options: [ahead(5, 14)],
      rescheduleOfMeetingId: meetingId,
      idempotencyKey: key,
    });
  }

  const moveNotices = (w: ReturnType<typeof world>) =>
    w.scheduleStore.notifications.filter((n) =>
      n.title.startsWith("Call moved:"),
    );

  it("accepting a move (no calendar) moves the one meeting, records meeting_rescheduled once and tells the other side once, even on retry", async () => {
    const w = world("NONE");
    const meetingId = await booked(w);
    const move = await proposeMove(w, meetingId);
    if (move.outcome !== "OK") throw new Error("move refused");
    // The original stays as booked until the move is accepted.
    expect(
      w.scheduleStore.meetings.find((m) => m.id === meetingId)?.startsAt,
    ).toEqual(new Date(ahead(3).startsAt));

    const accept = {
      actorUserId: INVESTOR,
      proposalId: move.proposal.id,
      action: "ACCEPT" as const,
      optionIndex: 0,
      idempotencyKey: "investor-move",
    };
    const out = await w.as(INVESTOR).respond(accept);
    expect(out).toMatchObject({
      outcome: "OK",
      confirmed: true,
      booked: true,
      calendarInvite: false,
      proposal: { meetingId },
    });
    // Retried: the same move, nothing new.
    const again = await w.as(INVESTOR).respond(accept);
    expect(again).toMatchObject({ outcome: "OK", recorded: false });
    expect(
      await w.as(INVESTOR).completeBooking({
        actorUserId: INVESTOR,
        proposalId: move.proposal.id,
      }),
    ).toMatchObject({ outcome: "OK", booked: true });

    expect(w.scheduleStore.meetings).toHaveLength(1);
    const row = w.scheduleStore.meetings[0];
    expect(row?.id).toBe(meetingId);
    expect(row?.status).toBe("SCHEDULED");
    expect(row?.startsAt).toEqual(new Date(ahead(5, 14).startsAt));
    expect(w.activity.recorded.map((r) => r.eventType)).toEqual([
      "meeting_scheduled",
      "meeting_rescheduled",
    ]);
    // One "Call moved" to the founder side; the investor moved it.
    expect(moveNotices(w).map((n) => n.userId)).toEqual([FOUNDER]);
    expect(w.investorCalendar.moved).toHaveLength(0);
  });

  it("with a calendar, the organiser's event moves (no second event)", async () => {
    const w = world("CONNECTED");
    const meetingId = await booked(w);
    const move = await proposeMove(w, meetingId);
    if (move.outcome !== "OK") throw new Error("move refused");
    const out = await w.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: move.proposal.id,
      action: "ACCEPT",
      optionIndex: 0,
      idempotencyKey: "investor-move",
    });
    expect(out).toMatchObject({
      outcome: "OK",
      booked: true,
      calendarInvite: true,
      proposal: { meetingId },
    });
    expect(w.investorCalendar.inserted).toHaveLength(1);
    expect(w.investorCalendar.moved).toHaveLength(1);
    expect(w.scheduleStore.meetings).toHaveLength(1);
  });

  it("refuses a move of a cancelled meeting, when proposed and before an acceptance is recorded", async () => {
    const w = world("NONE");
    const meetingId = await booked(w);
    const move = await proposeMove(w, meetingId);
    if (move.outcome !== "OK") throw new Error("move refused");
    await w.schedule.cancel({
      actor: actorOf(INVESTOR),
      meetingId,
      correlationId: "cor_x",
    });
    expect(
      await w.as(INVESTOR).respond({
        actorUserId: INVESTOR,
        proposalId: move.proposal.id,
        action: "ACCEPT",
        optionIndex: 0,
        idempotencyKey: "investor-move",
      }),
    ).toEqual({ outcome: "REFUSED", reason: "MEETING_NOT_MOVABLE" });
    expect(w.mem.proposals.get(move.proposal.id)?.state).toBe(
      "INVESTOR_REVIEW",
    );
    expect(await proposeMove(w, meetingId, "founder-move-2")).toEqual({
      outcome: "REFUSED",
      reason: "MEETING_NOT_MOVABLE",
    });
    expect(w.scheduleStore.meetings).toHaveLength(1);
    expect(
      w.activity.recorded.filter((r) => r.eventType === "meeting_rescheduled"),
    ).toHaveLength(0);
  });

  it("refuses a move of a meeting that is not on this relationship or does not exist", async () => {
    const w = world("NONE");
    expect(
      await proposeMove(w, "00000000-0000-4000-8000-00000000ffff"),
    ).toEqual({ outcome: "REFUSED", reason: "MEETING_NOT_MOVABLE" });
    expect(w.mem.proposals.size).toBe(0);
  });

  it("D8: the founder hears they can propose again; the investor hears the founder may suggest new times", async () => {
    const w = world("NONE");
    const first = await w.as(FOUNDER).propose({
      actorUserId: FOUNDER,
      relationshipId: REL,
      purpose: "Intro call",
      options: [ahead(3)],
      idempotencyKey: "founder-a",
    });
    if (first.outcome !== "OK") throw new Error("refused");
    await w.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: first.proposal.id,
      action: "DECLINE",
      idempotencyKey: "investor-decline",
    });
    const second = await w.as(FOUNDER).propose({
      actorUserId: FOUNDER,
      relationshipId: REL,
      purpose: "Intro call",
      options: [ahead(4)],
      idempotencyKey: "founder-b",
    });
    if (second.outcome !== "OK") throw new Error("refused");
    await w.as(INVESTOR).respond({
      actorUserId: INVESTOR,
      proposalId: second.proposal.id,
      action: "COUNTER",
      options: [ahead(6)],
      idempotencyKey: "investor-counter",
    });
    await w.as(FOUNDER).respond({
      actorUserId: FOUNDER,
      proposalId: second.proposal.id,
      action: "DECLINE_COUNTER",
      idempotencyKey: "founder-decline-counter",
    });
    const toFounder = w.notices.find((n) =>
      n.title.includes("declined the proposed call times"),
    );
    const toInvestor = w.notices.find((n) =>
      n.title.includes("declined the times you suggested"),
    );
    expect(toFounder?.body).toContain(
      "You can propose other times on the relationship page.",
    );
    expect(toInvestor?.body).toContain(
      "They may suggest new times, or you can message them on the relationship page.",
    );
    expect(toInvestor?.body).not.toContain("You can propose");
  });
});
