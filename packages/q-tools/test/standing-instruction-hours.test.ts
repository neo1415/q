import { describe, expect, it } from "vitest";

import {
  InstructionGrantPayloadSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  createQToolExecutor,
  createQToolRegistry,
  createQWorkTools,
  type QWorkIntelligencePort,
} from "../src/index.js";
import { actorA, contextFor, planFor } from "./support.js";

/**
 * Their own working hours on a standing instruction (lead 2026-10-03):
 * "including weekends, 8am to 10pm" is what the grant they approve says,
 * in their own time zone; nothing said keeps Monday-Friday 09:00-17:00.
 */

const NIXO = "9d1c0000-0000-4000-8000-000000000001";

function ownPlan(): PermittedContextPlan {
  const plan = planFor(actorA, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actorA.userId } }
        : scope,
    ),
  };
}

function world() {
  const prepared: unknown[] = [];
  const unused = () => Promise.reject(new Error("not this tool"));
  const port: QWorkIntelligencePort = {
    isInvestor: () => Promise.resolve(true),
    hasCompany: () => Promise.resolve(false),
    list: () => Promise.resolve([]),
    stop: unused,
    answer: unused,
    setAway: unused,
    timeZoneOf: () => Promise.resolve("Africa/Lagos"),
    counterpartsNamed: (_actor, names) =>
      Promise.resolve({
        found: names
          .filter((name) => name === "Nixo")
          .map((name) => ({ counterpartId: NIXO, name })),
        unknown: names.filter((name) => name !== "Nixo"),
      }),
    prepareForApproval: (entry) => {
      prepared.push(entry.proposal.payload);
      return "PREPARED";
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createQWorkTools(port)),
  });
  const propose = async (args: Record<string, unknown>) => {
    const outcome = await executor.execute(
      {
        callId: "c-1",
        name: "propose_standing_instruction",
        arguments: { goal: "Monitor new founders", ...args },
      },
      contextFor(actorA, ownPlan()),
    );
    return { outcome, prepared };
  };
  return { propose };
}

const grantOf = (payload: unknown) =>
  InstructionGrantPayloadSchema.parse(payload).grant;

describe("propose_standing_instruction: their working hours", () => {
  it("nothing said keeps the default, Monday-Friday 09:00-17:00 in their zone", async () => {
    const { outcome, prepared } = await world().propose({});
    expect(outcome.result.ok).toBe(true);
    expect(grantOf(prepared[0]).workingHours).toEqual({
      timeZone: "Africa/Lagos",
      days: [1, 2, 3, 4, 5],
      start: "09:00",
      end: "17:00",
    });
  });

  it("'including weekends, 8am to 10pm' is every day 08:00-22:00, in their zone", async () => {
    const { outcome, prepared } = await world().propose({
      workingHours: {
        days: [7, 1, 2, 3, 4, 5, 6],
        start: "08:00",
        end: "22:00",
      },
    });
    expect(outcome.result.ok).toBe(true);
    expect(grantOf(prepared[0]).workingHours).toEqual({
      timeZone: "Africa/Lagos",
      days: [1, 2, 3, 4, 5, 6, 7],
      start: "08:00",
      end: "22:00",
    });
  });

  it("a day that ends before it starts, or a day outside 1-7, is refused, never guessed", async () => {
    for (const workingHours of [
      { days: [6, 7], start: "22:00", end: "08:00" },
      { days: [0], start: "08:00", end: "22:00" },
      { days: [1], start: "8am", end: "10pm" },
    ]) {
      const { outcome, prepared } = await world().propose({ workingHours });
      expect(outcome.result.ok).toBe(false);
      expect(prepared).toHaveLength(0);
    }
  });

  it("an investor's grant holds only investor actions", async () => {
    const { prepared } = await world().propose({});
    const actions = grantOf(prepared[0]).actions.map((entry) => entry.action);
    expect(actions).toContain("relationship.interest.express");
    expect(actions).toContain("relationship.connection_request.accept");
    expect(actions).not.toContain("relationship.connection_request.send");
    expect(actions).not.toContain("relationship.interest.accept");
  });

  it("'except Nixo' leaves Nixo out by id; a name that matches no one is asked about, never dropped", async () => {
    const { outcome, prepared } = await world().propose({
      excludeNames: ["Nixo"],
    });
    expect(outcome.result.ok).toBe(true);
    expect(grantOf(prepared[0]).counterparts.exclude).toEqual([
      { counterpartId: NIXO, name: "Nixo" },
    ]);
    const unknown = await world().propose({ excludeNames: ["Nobody Ltd"] });
    expect(unknown.outcome.result.ok).toBe(false);
    expect(unknown.prepared).toHaveLength(0);
  });
});

describe("propose_standing_instruction: prepare is not do (weekend test 6ea17898)", () => {
  it("asked to prepare or line up: every step is a card; handed the doing: the default's own steps", async () => {
    const prepare = await world().propose({
      goal: "Find new founders matching my mandate and prepare intros",
    });
    // The tool says how many steps are Q's own: none here.
    expect(
      prepare.outcome.result.ok &&
        (prepare.outcome.result.data as { onItsOwn: number }).onItsOwn,
    ).toBe(0);
    const asked = grantOf(prepare.prepared[0]).actions;
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((entry) => entry.mode === "ASK")).toBe(true);
    const handed = await world().propose({
      goal: "Handle all the work for me",
      handsOverDoing: true,
    });
    expect(
      grantOf(handed.prepared[0]).actions.some(
        (entry) =>
          entry.action === "relationship.interest.express" &&
          entry.mode === "AUTO",
      ),
    ).toBe(true);
    // Asked first, even when handed over.
    const askFirst = await world().propose({
      handsOverDoing: true,
      askFirst: true,
    });
    expect(
      grantOf(askFirst.prepared[0]).actions.every(
        (entry) => entry.mode === "ASK",
      ),
    ).toBe(true);
  });
});
