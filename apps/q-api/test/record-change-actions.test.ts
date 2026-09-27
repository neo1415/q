import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CAPITAL_OBJECTIVE_CHANGE,
  COMPANY_TEAM_CHANGE,
  createRecordChangeBoard,
  requestFor,
} from "../src/composition/record-change-actions.js";

/**
 * R33: record changes Q prepares are checked against the route's own
 * request schema, resolved as the actor (the current raise), held one per
 * run for the run's own person, and re-validated when the Approval Engine
 * asks for them.
 */

const actor = {
  actorType: "HUMAN",
  userId: randomUUID(),
  tenantId: randomUUID(),
  organisationId: randomUUID(),
} as never as Parameters<
  ReturnType<typeof createRecordChangeBoard>["prepare"]
>[0]["actor"];
const COMPANY = randomUUID();
const OBJECTIVE = randomUUID();

function board(currentRaise: boolean) {
  return createRecordChangeBoard({
    capital: {
      getCurrentCapitalObjective: () =>
        currentRaise
          ? Promise.resolve({ id: OBJECTIVE, version: 3 })
          : Promise.reject(new Error("none")),
    } as never,
    investorService: {} as never,
  });
}

describe("requestFor", () => {
  it("accepts what the form accepts and names what does not fit", () => {
    expect(
      requestFor({
        kind: "TEAM_FACTS",
        companyId: COMPANY,
        fields: { teamSize: 12 },
      }).ok,
    ).toBe(true);
    const bad = requestFor({
      kind: "CAPITAL_OBJECTIVE",
      companyId: COMPANY,
      operation: "CREATE",
      fields: { target: { amount: "-5", currency: "USD" } },
    });
    expect(bad.ok).toBe(false);
  });
});

describe("the record change board", () => {
  it("binds an update to the current raise, and proposes it once to its own person", async () => {
    const b = board(true);
    const result = await b.prepare({
      runId: "run-1",
      actor,
      change: {
        kind: "CAPITAL_OBJECTIVE",
        companyId: COMPANY,
        operation: "UPDATE",
        fields: { targetCloseDate: "2027-03-31" },
      },
    });
    expect(result.status).toBe("PREPARED");
    const context = { runId: "run-1", actor } as never;
    const proposal = await b.proposer.propose(context);
    expect(proposal).toEqual({
      actionType: CAPITAL_OBJECTIVE_CHANGE,
      payload: {
        companyId: COMPANY,
        operation: "UPDATE",
        capitalObjectiveId: OBJECTIVE,
        fields: { targetCloseDate: "2027-03-31" },
      },
    });
    expect(await b.proposer.propose(context)).toBeNull();
  });

  it("refuses an update with no raise, and a second different change in one turn", async () => {
    const b = board(false);
    const none = await b.prepare({
      runId: "run-2",
      actor,
      change: {
        kind: "CAPITAL_OBJECTIVE",
        companyId: COMPANY,
        operation: "CLOSE",
        fields: { reason: "ACHIEVED" },
      },
    });
    expect(none.status).toBe("REFUSED");
    await b.prepare({
      runId: "run-3",
      actor,
      change: {
        kind: "TEAM_FACTS",
        companyId: COMPANY,
        fields: { teamSize: 5 },
      },
    });
    const second = await b.prepare({
      runId: "run-3",
      actor,
      change: {
        kind: "TEAM_FACTS",
        companyId: COMPANY,
        fields: { teamSize: 6 },
      },
    });
    expect(second.status).toBe("ONE_PER_TURN");
    const proposal = await b.proposer.propose({
      runId: "run-3",
      actor,
    } as never);
    expect(proposal).toMatchObject({ actionType: COMPANY_TEAM_CHANGE });
  });

  it("never hands a change to another person's run", async () => {
    const b = board(true);
    await b.prepare({
      runId: "run-4",
      actor,
      change: {
        kind: "TEAM_FACTS",
        companyId: COMPANY,
        fields: { teamSize: 5 },
      },
    });
    const other = { ...(actor as object), userId: randomUUID() };
    expect(
      await b.proposer.propose({ runId: "run-4", actor: other } as never),
    ).toBeNull();
  });
});
