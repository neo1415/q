import { describe, expect, it } from "vitest";

import {
  createProposalService,
  PROPOSAL_TRANSITIONS,
  transitionProposal,
  type ProposalEvent,
  type ProposalParties,
  type ProposalRecord,
  type ProposalState,
  type ProposalStore,
  type TimeOption,
} from "../src/index.js";

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
