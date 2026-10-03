import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  handleEverythingGrant,
  Q_INSTRUCTION_GRANT,
  type InstructionGrantPayload,
} from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInstructionActions,
  grantCard,
  grantIsSettled,
} from "../src/composition/instructions/actions.js";
import type {
  InstructionRow,
  InstructionStore,
} from "../src/composition/instructions/store.js";
import {
  createWorkActionBoard,
  createWorkPort,
} from "../src/composition/work/actions.js";
import type { WorkStore } from "../src/composition/work/store.js";

/** ADR 0043 S2: the grant card, its authority, the board and the work list. */

const tenantId = randomUUID();
const userId = randomUUID();
const actor = ActorContextSchema.parse({
  userId,
  tenantId,
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

function payload(
  overrides: Partial<InstructionGrantPayload> = {},
): InstructionGrantPayload {
  return {
    ownerUserId: userId,
    goal: "Handle all the work for me",
    grant: handleEverythingGrant({ timeZone: "Europe/London" }),
    ...overrides,
  };
}

function fakeStore(calls: unknown[]): InstructionStore {
  return {
    activate: (input: unknown) => {
      calls.push(input);
      return Promise.resolve({ instructionId: randomUUID(), version: 1 });
    },
  } as unknown as InstructionStore;
}

describe("the q.instruction.grant card", () => {
  const [definition] = createInstructionActions({ store: fakeStore([]) });
  if (definition === undefined) throw new Error("not composed");

  it("says in plain words what Q does alone, asks first, and never does", () => {
    const card = grantCard(payload());
    expect(card).toContain(
      "On my own, within Mon-Fri 09:00-17:00 (Europe/London)",
    );
    expect(card).toContain(
      "Send a chat message (up to 8 per person, then I ask",
    );
    expect(card).toContain("I ask you first:");
    expect(card).toContain(
      "Never without your explicit yes: terms, money, commitments, signing, passing or declining.",
    );
    expect(card).toContain("Budget: $5.00 a month");
    expect(card).toContain("Until: 30 days from now");
    // Autonomy off (the default): their AUTO choices shown, and the line.
    expect(card).toContain(
      "Q will ask for each step until autonomy is switched on.",
    );
    expect(grantCard(payload(), { autoEnabled: true })).not.toContain(
      "until autonomy is switched on",
    );
  });

  it("binds to the person who asked, as its target", () => {
    expect(definition.targets(payload())).toEqual([{ kind: "USER", userId }]);
  });

  it("only the person themself, and only a grant code allows", async () => {
    expect(await definition.authorize(payload(), actor)).toEqual({
      outcome: "ALLOW",
    });
    expect(
      await definition.authorize(payload({ ownerUserId: randomUUID() }), actor),
    ).toEqual({ outcome: "DENY", code: "NOT_YOURS" });
    const base = handleEverythingGrant({ timeZone: "UTC" });
    const terms = {
      ...base,
      actions: [
        ...base.actions,
        { action: "relationship.outcome.change", mode: "AUTO" as const },
      ],
    };
    expect(grantIsSettled(terms)).toBe(false);
    expect(
      await definition.authorize(payload({ grant: terms }), actor),
    ).toEqual({ outcome: "DENY", code: "GRANT_NOT_ALLOWED" });
  });

  it("activates as the approver, for the approved action", async () => {
    const calls: unknown[] = [];
    const [live] = createInstructionActions({ store: fakeStore(calls) });
    const actionId = randomUUID();
    const result = await live?.executor.execute(
      { actionId, payload: payload() } as never,
      { approver: actor } as never,
    );
    expect(result?.outcome).toBe("EXECUTED");
    expect(calls).toEqual([
      expect.objectContaining({
        qActionId: actionId,
        instructionId: undefined,
      }),
    ]);
    const refused = await live?.executor.execute(
      { actionId, payload: payload({ ownerUserId: randomUUID() }) } as never,
      { approver: actor } as never,
    );
    expect(refused?.outcome).toBe("FAILED");
  });
});

describe("the work board for an instruction", () => {
  it("draws the card code allows: unknown dropped, AUTO on outcomes asked", async () => {
    const board = createWorkActionBoard();
    const base = handleEverythingGrant({ timeZone: "UTC" });
    board.prepareForApproval({
      runId: "run-1",
      tenantId,
      actorUserId: userId,
      proposal: {
        actionType: Q_INSTRUCTION_GRANT,
        payload: payload({
          grant: {
            ...base,
            actions: [
              { action: "relationship.outcome.change", mode: "AUTO" },
              { action: "capital.objective.update", mode: "AUTO" },
              { action: "wire.money.anywhere", mode: "AUTO" },
              { action: "chat.message.send", mode: "AUTO" },
            ],
          },
        }),
      },
    });
    const proposed = await board.proposer.propose({
      runId: "run-1",
      actor,
    } as never);
    expect(proposed).not.toBeNull();
    const grant = (proposed as { payload: InstructionGrantPayload }).payload
      .grant;
    expect(grant.actions).toEqual(
      expect.arrayContaining([
        { action: "relationship.outcome.change", mode: "ASK" },
        { action: "chat.message.send", mode: "AUTO" },
      ]),
    );
    expect(grant.actions.map((entry) => entry.action)).not.toContain(
      "wire.money.anywhere",
    );
    expect(
      grant.actions.find((entry) => entry.action.startsWith("capital."))
        ?.mode ?? "ASK",
    ).toBe("ASK");
    expect(grantIsSettled(grant)).toBe(true);
  });

  it("refuses an instruction prepared for someone else", async () => {
    const board = createWorkActionBoard();
    board.prepareForApproval({
      runId: "run-2",
      tenantId,
      actorUserId: userId,
      proposal: {
        actionType: Q_INSTRUCTION_GRANT,
        payload: payload({ ownerUserId: randomUUID() }),
      },
    });
    expect(
      await board.proposer.propose({ runId: "run-2", actor } as never),
    ).toEqual({ refused: expect.any(String) as string });
  });
});

describe("instructions on the work list", () => {
  const now = new Date("2026-10-03T10:00:00Z");
  const row: InstructionRow = {
    id: randomUUID(),
    tenant_id: tenantId,
    user_id: userId,
    organisation_id: null,
    goal_text: "Handle all the work for me",
    status: "ACTIVE",
    grant_version: 1,
    budget_usd_month: "5.00",
    spent_usd_month: "0.123456",
    spent_this_month: "0.123456",
    pause_reason: null,
    expires_at: new Date("2026-11-02T10:00:00Z"),
    stopped_at: null,
    conversation_id: null,
    created_at: now,
    updated_at: now,
    grant_payload: handleEverythingGrant({ timeZone: "UTC" }),
  };
  const stopped: string[] = [];
  const instructions = {
    list: () =>
      Promise.resolve([row, { ...row, id: randomUUID(), status: "DRAFT" }]),
    stop: (_owner: unknown, id: string) => {
      stopped.push(id);
      return Promise.resolve(id === row.id);
    },
    own: () => Promise.resolve(null),
    steps: () => Promise.resolve([]),
    timeZoneOf: () => Promise.resolve("Africa/Lagos"),
  } as unknown as InstructionStore;
  const work = {
    own: () => Promise.resolve([]),
    stop: () => Promise.resolve(false),
  } as unknown as WorkStore;
  const port = createWorkPort({
    store: work,
    instructions,
    board: createWorkActionBoard(),
    isInvestor: () => Promise.resolve(true),
    ownCompany: () => Promise.resolve(null),
  });

  it("lists live instructions (never drafts) with their running cost", async () => {
    const items = await port.list(actor);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "STANDING_INSTRUCTION",
      status: "ACTIVE",
      lanes: [],
    });
    expect(items[0]?.summary).toContain("3 things on my own");
    expect(items[0]?.summary).toContain("$0.12 of $5.00 this month");
  });

  it("stops an instruction from the same stop as other work", async () => {
    expect(await port.stop(actor, row.id, null)).toBe(true);
    expect(stopped).toEqual([row.id]);
    expect(await port.stop(actor, randomUUID(), null)).toBe(false);
  });

  it("knows the person's time zone for their working hours", async () => {
    expect(await port.timeZoneOf?.(actor)).toBe("Africa/Lagos");
  });
});
