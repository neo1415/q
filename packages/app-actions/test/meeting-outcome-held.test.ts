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

function ports(held: "OK" | "REFUSED") {
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
