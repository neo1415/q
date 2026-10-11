import { describe, expect, it } from "vitest";

import {
  createProposalService,
  type ProposalEvent,
  type ProposalRecord,
  type ProposalStore,
} from "@capital-q/communication";
import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
  type AppActionContext,
  type AppActionPorts,
} from "../src/index.js";

/**
 * Meeting time proposals as declared actions (D, 2026-10-11): who may take
 * which step is derived from membership, a proposal is never "confirmed"
 * before an authorised acceptance, and the booking happens as the accepting
 * person -- never on anyone's say-so in a call.
 */

const REL = "11111111-0000-4000-8000-000000000001";
const TENANT = "c0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-12T09:00:00Z");
const SLOT = (day: number) => ({
  startsAt: `2026-10-${String(day)}T14:00:00.000Z`,
  endsAt: `2026-10-${String(day)}T14:30:00.000Z`,
  timeZone: "Africa/Lagos",
});

const actorOf = (n: number) =>
  ActorContextSchema.parse({
    userId: `b0000000-0000-4000-8000-00000000000${String(n)}`,
    tenantId: TENANT,
    organisationId: `d0000000-0000-4000-8000-00000000000${String(n)}`,
    membershipId: `e0000000-0000-4000-8000-00000000000${String(n)}`,
    actorType: "HUMAN",
  });
const FOUNDER = actorOf(1);
const INVESTOR = actorOf(2);
const OBSERVER = actorOf(3);
const OUTSIDER = actorOf(4);

const contextOf = (
  actor: ReturnType<typeof actorOf>,
  key: string,
  surface: "SCREEN" | "Q" = "Q",
): AppActionContext => ({
  actor,
  idempotencyKey: key,
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
  surface,
});

function setup() {
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
  const booked: { by: string; startsAt: string }[] = [];
  let n = 0;
  const party: NonNullable<AppActionPorts["proposals"]>["party"] = ({
    actorUserId,
    relationshipId,
  }) => {
    if (relationshipId !== REL) return Promise.resolve(null);
    if (actorUserId === FOUNDER.userId)
      return Promise.resolve({
        tenantId: TENANT,
        side: "FOUNDER",
        binds: true,
      });
    if (actorUserId === INVESTOR.userId)
      return Promise.resolve({
        tenantId: TENANT,
        side: "INVESTOR",
        binds: true,
      });
    if (actorUserId === OBSERVER.userId)
      return Promise.resolve({
        tenantId: TENANT,
        side: "INVESTOR",
        binds: false,
      });
    return Promise.resolve(null);
  };
  const ports: AppActionPorts = {
    proposals: {
      party,
      forActor: (actor) =>
        createProposalService({
          store,
          parties: party,
          now: () => NOW,
          newId: () =>
            `00000000-0000-4000-8000-0000000f${String((n += 1)).padStart(4, "0")}`,
          book: ({ proposal, option }) => {
            booked.push({ by: actor.userId, startsAt: option.startsAt });
            return Promise.resolve({ meetingId: `meeting-for-${proposal.id}` });
          },
        }),
    },
  };
  return { ports, booked, proposals };
}

const action = (name: string) => {
  const found = APP_ACTIONS.find((a) => a.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};
const ids = { relationshipId: REL };

async function allowed(
  name: string,
  ports: AppActionPorts,
  actor: ReturnType<typeof actorOf>,
  input: unknown,
): Promise<boolean> {
  const verdict = await action(name).authorize(
    ports,
    contextOf(actor, "k-000001"),
    input,
  );
  return verdict.ok;
}

describe("meeting time proposal actions", () => {
  it("are consequential, bind a commitment, and each has its own route and tool", () => {
    for (const name of [
      "schedule.proposal.propose",
      "schedule.proposal.accept",
      "schedule.proposal.counter",
    ]) {
      expect(action(name).classification).toBe("CONSEQUENTIAL");
      expect(action(name).consequence).toBe("COMMITMENT");
      expect(action(name).http?.path).toContain("/meeting-proposals");
      expect(action(name).tool?.name).toBeDefined();
    }
    expect(action("schedule.proposal.review").classification).toBe("READ");
  });

  it("propose: only a founder-side member who may bind; never the investor, an observer or an outsider", async () => {
    const { ports } = setup();
    const input = {
      ...ids,
      idempotencyKey: "key-propose-1",
      input: { purpose: "Intro", options: [SLOT(14)] },
    };
    expect(
      await allowed("schedule.proposal.propose", ports, FOUNDER, input),
    ).toBe(true);
    expect(
      await allowed("schedule.proposal.propose", ports, INVESTOR, input),
    ).toBe(false);
    expect(
      await allowed("schedule.proposal.propose", ports, OBSERVER, input),
    ).toBe(false);
    expect(
      await allowed("schedule.proposal.propose", ports, OUTSIDER, input),
    ).toBe(false);
  });

  it("founder proposes -> investor accepts: confirmed only then, booked as the investor, replay safe", async () => {
    const { ports, booked } = setup();
    const proposed = await action("schedule.proposal.propose").run(
      ports,
      contextOf(FOUNDER, "key-propose-1", "SCREEN"),
      {
        ...ids,
        idempotencyKey: "key-propose-1",
        input: { purpose: "Intro", options: [SLOT(14), SLOT(15)] },
      },
    );
    expect(proposed).toMatchObject({
      outcome: "OK",
      confirmed: false,
      booked: false,
    });
    const id = (proposed as { proposal: { id: string } }).proposal.id;
    expect(booked).toEqual([]);

    const accept = {
      ...ids,
      proposalId: id,
      idempotencyKey: "key-accept-1",
      input: { optionIndex: 1 },
    };
    // The founder cannot accept their own proposed time; nor can an observer or outsider.
    expect(
      await allowed("schedule.proposal.accept", ports, FOUNDER, accept),
    ).toBe(false);
    expect(
      await allowed("schedule.proposal.accept", ports, OBSERVER, accept),
    ).toBe(false);
    expect(
      await allowed("schedule.proposal.accept", ports, OUTSIDER, accept),
    ).toBe(false);
    expect(
      await allowed("schedule.proposal.accept", ports, INVESTOR, accept),
    ).toBe(true);

    const accepted = await action("schedule.proposal.accept").run(
      ports,
      contextOf(INVESTOR, "key-accept-1"),
      accept,
    );
    expect(accepted).toMatchObject({
      outcome: "OK",
      confirmed: true,
      booked: true,
      recorded: true,
    });
    expect(booked).toEqual([
      { by: INVESTOR.userId, startsAt: SLOT(15).startsAt },
    ]);

    // A screen retry reaches the idempotent replay; Q prepares no new card.
    expect(
      (
        await action("schedule.proposal.accept").authorize(
          ports,
          contextOf(INVESTOR, "key-accept-1", "SCREEN"),
          accept,
        )
      ).ok,
    ).toBe(true);
    expect(
      await allowed("schedule.proposal.accept", ports, INVESTOR, accept),
    ).toBe(false);
    const replay = await action("schedule.proposal.accept").run(
      ports,
      contextOf(INVESTOR, "key-accept-1"),
      accept,
    );
    expect(replay).toMatchObject({ outcome: "OK", recorded: false });
    expect(booked).toHaveLength(1);
  });

  it("counter: investor only; then the founder (not the investor) answers it", async () => {
    const { ports } = setup();
    const proposed = (await action("schedule.proposal.propose").run(
      ports,
      contextOf(FOUNDER, "key-propose-2"),
      {
        ...ids,
        idempotencyKey: "key-propose-2",
        input: { purpose: "Intro", options: [SLOT(14)] },
      },
    )) as { proposal: { id: string } };
    const id = proposed.proposal.id;
    const counter = {
      ...ids,
      proposalId: id,
      idempotencyKey: "key-counter-1",
      input: { options: [SLOT(16)] },
    };
    expect(
      await allowed("schedule.proposal.counter", ports, FOUNDER, counter),
    ).toBe(false);
    expect(
      await allowed("schedule.proposal.counter", ports, INVESTOR, counter),
    ).toBe(true);
    await action("schedule.proposal.counter").run(
      ports,
      contextOf(INVESTOR, "key-counter-1"),
      counter,
    );
    const accept = {
      ...ids,
      proposalId: id,
      idempotencyKey: "key-accept-2",
      input: { optionIndex: 0 },
    };
    expect(
      await allowed("schedule.proposal.accept", ports, INVESTOR, accept),
    ).toBe(false);
    expect(
      await allowed("schedule.proposal.accept", ports, FOUNDER, accept),
    ).toBe(true);
    const decline = { ...ids, proposalId: id, idempotencyKey: "key-decline-1" };
    expect(
      await allowed("schedule.proposal.decline", ports, FOUNDER, decline),
    ).toBe(true);
    expect(
      await allowed("schedule.proposal.decline", ports, INVESTOR, decline),
    ).toBe(false);
  });

  it("review: any party reads; an outsider does not, and nothing reads as confirmed before acceptance", async () => {
    const { ports } = setup();
    await action("schedule.proposal.propose").run(
      ports,
      contextOf(FOUNDER, "key-propose-3"),
      {
        ...ids,
        idempotencyKey: "key-propose-3",
        input: { purpose: "Intro", options: [SLOT(14)] },
      },
    );
    expect(
      await allowed("schedule.proposal.review", ports, INVESTOR, ids),
    ).toBe(true);
    expect(await allowed("schedule.proposal.review", ports, FOUNDER, ids)).toBe(
      true,
    );
    expect(
      await allowed("schedule.proposal.review", ports, OUTSIDER, ids),
    ).toBe(false);
    const out = await action("schedule.proposal.review").run(
      ports,
      contextOf(INVESTOR, "key-review-1"),
      ids,
    );
    const said = action("schedule.proposal.review").done(out, ids, {});
    expect(said).toContain("Proposed, not confirmed");
    expect(said).not.toMatch(/^Confirmed/m);
  });
});
