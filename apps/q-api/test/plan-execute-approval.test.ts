import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  proposedLine,
  QActionPayloadMismatchError,
} from "@capital-q/q-actions";
import {
  decidePending,
  type PendingDecisionPort,
} from "@capital-q/q-specialists";
import { ActorContextSchema } from "@capital-q/security";

import { createPlanCardApprove } from "../src/composition/workforce/plan-ask.js";

/**
 * Owner 2026-11-04: "after I click on execute, I still have to click on
 * yes or approve ... and it doesn't start; when I say okay ... it should
 * just go ahead." The plan card's Execute is the approval of its card
 * (CARD channel, payload-bound, continued once); an "okay" to the waiting
 * execute card approves it by the card's own path; with nothing waiting,
 * "okay" approves nothing.
 */

const actor = ActorContextSchema.parse({
  userId: randomUUID(),
  tenantId: randomUUID(),
  organisationId: randomUUID(),
  membershipId: randomUUID(),
  actorType: "HUMAN",
});

function engine(
  options: {
    readonly tampered?: boolean;
    readonly status?: "APPROVED" | "EXECUTED";
  } = {},
) {
  const actionId = randomUUID();
  const runId = randomUUID();
  const approveCalls: unknown[] = [];
  const continued: string[] = [];
  let decided = false;
  const approve = createPlanCardApprove({
    actions: () => ({
      findApprovalForAction: (_tenant, id) =>
        Promise.resolve(
          id === actionId ? ({ id: randomUUID() } as never) : null,
        ),
      approve: (command) => {
        approveCalls.push(command.via);
        if (options.tampered === true) {
          return Promise.reject(new QActionPayloadMismatchError());
        }
        const first = !decided && options.status === undefined;
        decided = true;
        return Promise.resolve({
          decided: first,
          action: {
            id: actionId,
            runId,
            status: first ? "APPROVED" : (options.status ?? "EXECUTED"),
          },
        } as never);
      },
    }),
    continueApproved: () => (input) => {
      continued.push(input.actionId);
      return Promise.resolve();
    },
  });
  return { approve, actionId, approveCalls, continued };
}

describe("the card's Execute approves its execute card", () => {
  it("approves on the CARD channel and continues it exactly once", async () => {
    const e = engine();
    expect(await e.approve(actor, e.actionId)).toBe("STARTED");
    expect(e.approveCalls).toEqual([{ channel: "CARD" }]);
    expect(e.continued).toEqual([e.actionId]);
    // A second press: the engine's retry (decided: false, already run).
    expect(await e.approve(actor, e.actionId)).toBe("STARTED");
    expect(e.continued).toEqual([e.actionId]);
  });

  it("a payload that changed is refused: nothing continues", async () => {
    const e = engine({ tampered: true });
    expect(await e.approve(actor, e.actionId)).toBe("CHANGED");
    expect(e.continued).toEqual([]);
  });

  it("an id that is not an execute card's approves nothing", async () => {
    const e = engine();
    expect(await e.approve(actor, randomUUID())).toBe("FAILED");
    expect(e.approveCalls).toEqual([]);
  });
});

function port(pending: boolean) {
  const approved: string[] = [];
  const proposalId = randomUUID();
  const decisions: PendingDecisionPort = {
    proposals: () =>
      Promise.resolve(
        pending
          ? [
              {
                proposalId,
                summary: "Run your plan: Raise a seed round by March",
                status: "PENDING" as const,
              },
            ]
          : [],
      ),
    // No model reading here: the plain words alone must decide.
    read: () => Promise.resolve(null),
    approve: (_context, id) => {
      approved.push(id);
      return Promise.resolve({ status: "SAVED" as const });
    },
    decline: () => Promise.resolve({ status: "DECLINED" as const }),
  };
  return { decisions, approved, proposalId };
}

const context = {
  actor,
  runId: randomUUID(),
  correlationId: `cor_${randomUUID()}`,
  tenantId: actor.tenantId,
  userId: actor.userId,
};

describe("an 'okay' to the waiting execute card", () => {
  it("approves that card by code, straight after Q's own ask", async () => {
    const p = port(true);
    const outcome = await decidePending(p.decisions, {
      context,
      utterance: "okay",
      recentTurns: [
        {
          role: "Q",
          text: proposedLine("Run your plan: Raise a seed round by March"),
        },
      ],
    });
    expect(p.approved).toEqual([p.proposalId]);
    expect(outcome.kind).toBe("REPLY");
  });

  it("with nothing waiting, approves nothing", async () => {
    const p = port(false);
    const outcome = await decidePending(p.decisions, {
      context,
      utterance: "okay",
      recentTurns: [{ role: "Q", text: "Your plan is ready." }],
    });
    expect(outcome.kind).toBe("NONE");
    expect(p.approved).toEqual([]);
  });
});
