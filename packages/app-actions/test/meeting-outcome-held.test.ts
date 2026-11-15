import { describe, expect, it, vi } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import { APP_ACTIONS, type AppActionPorts } from "../src/index.js";

/**
 * "How did the call go?" without the meeting bot (2026-10-03): the
 * existing relationship.outcome.meeting action, given the call's id, asks
 * the call's owner (the schedule service) to mark it held first; a call
 * that is not this relationship's own ended booking records nothing.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const context = {
  actor,
  idempotencyKey: "screen:1",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
  surface: "SCREEN" as const,
};
const REL = "11111111-0000-4000-8000-000000000001";
const CALL = "22222222-0000-4000-8000-000000000001";

const action = APP_ACTIONS.find(
  (candidate) => candidate.name === "relationship.outcome.meeting",
);

type Listed = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly status: "SCHEDULED" | "CANCELLED";
};

function meeting(id: string, startsAt: string, endsAt: string): Listed {
  return { id, startsAt, endsAt, timeZone: "UTC", status: "SCHEDULED" };
}

function ports(held: "OK" | "REFUSED", calls: readonly Listed[] = []) {
  const order: string[] = [];
  const confirmHeld = vi.fn(() => {
    order.push("held");
    return Promise.resolve(
      held === "OK"
        ? { outcome: "OK" as const, alreadyDone: false }
        : { outcome: "REFUSED" as const, code: "NOT_FOUND" as const },
    );
  });
  const recordMeetingOutcome = vi.fn(() => {
    order.push("outcome");
    return Promise.resolve({
      outcome: "OK" as const,
      relationshipId: REL,
      deduplicated: false,
    });
  });
  return {
    order,
    confirmHeld,
    recordMeetingOutcome,
    ports: {
      // Only the two calls under test are reachable; the rest are inert.
      schedule: {
        confirmHeld,
        schedule: vi.fn(),
        cancel: vi.fn(),
        createReminder: vi.fn(),
        dismissReminder: vi.fn(),
        organisedMeeting: vi.fn(),
        joinCall: vi.fn(),
        listMeetings: vi.fn(() =>
          Promise.resolve(
            calls.map((call) => ({
              ...call,
              relationshipId: REL,
              purpose: "Introductory call",
              organisedByYou: true,
              organiserName: "Ama",
              meetLink: null,
              attendees: [],
              hasBrief: false,
            })),
          ),
        ),
      },
      outcomes: {
        recordMeetingOutcome,
        pass: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      },
    } satisfies AppActionPorts,
  };
}

describe("relationship.outcome.meeting with a call", () => {
  it("marks the named call held, then records what it led to", async () => {
    if (action === undefined) throw new Error("no action");
    const world = ports("OK");
    const out = await action.run(world.ports, context, {
      relationshipId: REL,
      input: { outcome: "FOLLOW_UP_MEETING", meetingId: CALL },
    });
    expect(out).toMatchObject({ outcome: "OK" });
    expect(world.order).toEqual(["held", "outcome"]);
    expect(world.confirmHeld).toHaveBeenCalledWith(
      expect.objectContaining({ relationshipId: REL, meetingId: CALL, actor }),
    );
  });

  it("records nothing when the call is not this relationship's ended booking", async () => {
    if (action === undefined) throw new Error("no action");
    const world = ports("REFUSED");
    const out = await action.run(world.ports, context, {
      relationshipId: REL,
      input: { outcome: "DILIGENCE", meetingId: CALL },
    });
    expect(out).toMatchObject({ outcome: "REFUSED" });
    expect(world.recordMeetingOutcome).not.toHaveBeenCalled();
  });

  it("without a call, behaves as before: the outcome alone", async () => {
    if (action === undefined) throw new Error("no action");
    const world = ports("OK");
    await action.run(world.ports, context, {
      relationshipId: REL,
      input: { outcome: "INTRODUCTIONS" },
    });
    expect(world.order).toEqual(["outcome"]);
  });
});

/**
 * Live 15 Nov 2026 (D-Q2; audit 2026-11-15-meetings-through-q-live.md,
 * step 5): "Mark the Introductory call with Savanna Seed as held" prepared
 * `{outcome: OTHER}` with no meetingId for a call two days away, so
 * approving it would skip confirmHeld and record an outcome early.
 */
describe("D-Q2: a meeting outcome binds its call, and never one still to come", () => {
  const FUTURE = meeting(
    CALL,
    "2099-11-17T10:00:00.000Z",
    "2099-11-17T10:30:00.000Z",
  );
  const ENDED = meeting(
    "22222222-0000-4000-8000-000000000002",
    "2020-11-10T10:00:00.000Z",
    "2020-11-10T10:30:00.000Z",
  );
  const family = APP_ACTIONS.find(
    (candidate) => candidate.name === "relationship.outcome.change",
  );

  it("the live shape (no meetingId, the only call in the future) is refused server-side; nothing recorded", async () => {
    if (action === undefined) throw new Error("no action");
    const world = ports("OK", [FUTURE]);
    const out = await action.run(world.ports, context, {
      relationshipId: REL,
      input: { outcome: "OTHER" },
    });
    expect(out).toEqual({ outcome: "REFUSED", code: "MEETING_NOT_ENDED" });
    expect(world.confirmHeld).not.toHaveBeenCalled();
    expect(world.recordMeetingOutcome).not.toHaveBeenCalled();
    expect(
      action.done(
        out,
        { relationshipId: REL, input: { outcome: "OTHER" } },
        {},
      ),
    ).toContain("hasn't happened yet");
  });

  it("unnamed, it binds the latest ended call and marks it held first", async () => {
    if (action === undefined) throw new Error("no action");
    const world = ports("OK", [FUTURE, ENDED]);
    await action.run(world.ports, context, {
      relationshipId: REL,
      input: { outcome: "FOLLOW_UP_MEETING" },
    });
    expect(world.order).toEqual(["held", "outcome"]);
    expect(world.confirmHeld).toHaveBeenCalledWith(
      expect.objectContaining({ meetingId: ENDED.id }),
    );
  });

  it("a named call still to come is refused, said as not ended (not 'not found')", async () => {
    if (action === undefined) throw new Error("no action");
    const world = ports("OK", [FUTURE]);
    const out = await action.run(world.ports, context, {
      relationshipId: REL,
      input: { outcome: "OTHER", meetingId: CALL },
    });
    expect(out).toEqual({ outcome: "REFUSED", code: "MEETING_NOT_ENDED" });
    expect(world.recordMeetingOutcome).not.toHaveBeenCalled();
  });

  it("Q's path refuses before preparing a card, with the call's time; after it ends the card binds the call", async () => {
    const tool = family?.tool;
    if (tool === undefined) throw new Error("no tool");
    const qContext = { ...context, surface: "Q" as const };
    const early = await tool.toCanonical(
      {
        relationship: REL,
        operation: "MEETING_OUTCOME",
        meetingOutcome: "OTHER",
      },
      qContext,
      ports("OK", [FUTURE]).ports,
    );
    expect(early).toEqual({
      refused: expect.stringContaining(
        "That call hasn't happened yet",
      ) as unknown,
    });
    const late = await tool.toCanonical(
      {
        relationship: REL,
        operation: "MEETING_OUTCOME",
        meetingOutcome: "OTHER",
      },
      qContext,
      ports("OK", [ENDED]).ports,
    );
    expect(late).toEqual({
      operation: "MEETING_OUTCOME",
      input: {
        relationshipId: REL,
        input: { outcome: "OTHER", meetingId: ENDED.id },
      },
    });
  });
});
