import { describe, expect, it } from "vitest";

import {
  QClientActionToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  createQToolExecutor,
  createQToolRegistry,
  createShowTool,
  type RelationshipIntelligencePort,
} from "../src/index.js";
import {
  COMPANY_A,
  COMPANY_B_PRIVATE,
  actorA,
  actorB,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * Overdeliver: "show me my six-month plan" (Q.04) and "what does Okafor
 * look for / draft my application" (Q.05) by voice or text. The plan is
 * the founder's own company, resolved by the server whatever id the model
 * names; the investor card is for founders only and names an investor
 * they can already name. Neither card carries a private mandate: the card
 * itself is read later under the founder's session.
 */

const OKAFOR = "a5000000-0000-4000-8000-000000000005";

function ownPlan(actor = actorA): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

const call = (args: Record<string, unknown>) => ({
  callId: "c-show",
  name: "show",
  arguments: args,
});

const relationships = {
  ownRelationships: (actor: { userId: string }) =>
    Promise.resolve(
      actor.userId === actorA.userId
        ? {
            side: "COMPANY" as const,
            items: [
              {
                relationshipId: OKAFOR,
                counterpart: {
                  kind: "INVESTOR_ORGANISATION" as const,
                  id: OKAFOR,
                  name: "Okafor Capital",
                },
                state: "CONNECTED" as const,
                stateSince: "2026-09-20T10:00:00.000Z",
                nextStep: "SCHEDULE_MEETING" as const,
                milestones: [],
              },
            ],
          }
        : null,
    ),
} as unknown as RelationshipIntelligencePort;

// actorA is a founder of COMPANY_A; actorB has no company (an investor).
const appActions = {
  ownCompanyId: (actor: { userId: string }) =>
    Promise.resolve(actor.userId === actorA.userId ? COMPANY_A : null),
} as never;

function executor() {
  const ports = { ...fakePorts(), relationships, appActions };
  return createQToolExecutor({
    registry: createQToolRegistry([createShowTool(ports)]),
  });
}

const intentOf = (outcome: { result: unknown }) =>
  QClientActionToolResultSchema.parse(
    (outcome.result as { data: unknown }).data,
  ).clientAction;

describe("show READINESS_BLUEPRINT (Q.04)", () => {
  it("is the founder's own company, whatever id the model names", async () => {
    const outcome = await executor().execute(
      call({ object: "READINESS_BLUEPRINT", id: COMPANY_B_PRIVATE }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toEqual({
      kind: "SHOW_IN_Q_ROOM",
      object: "READINESS_BLUEPRINT",
      id: COMPANY_A.toLowerCase(),
      title: "Your 3/6/12-month plan",
    });
  });

  it("is refused for a person with no company of their own", async () => {
    const outcome = await executor().execute(
      call({ object: "READINESS_BLUEPRINT" }),
      contextFor(actorB, ownPlan(actorB)),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});

describe("show INVESTOR_LOOKS_FOR (Q.05)", () => {
  it("finds a nameable investor by name for a founder", async () => {
    const outcome = await executor().execute(
      call({ object: "INVESTOR_LOOKS_FOR", name: "Okafor" }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toMatchObject({
      object: "INVESTOR_LOOKS_FOR",
      id: OKAFOR,
      title: "Okafor Capital",
    });
  });

  it("is for founders only: an investor gets nothing", async () => {
    const outcome = await executor().execute(
      call({ object: "INVESTOR_LOOKS_FOR", id: OKAFOR }),
      contextFor(actorB, ownPlan(actorB)),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("an unknown name opens nothing rather than a guess", async () => {
    const outcome = await executor().execute(
      call({ object: "INVESTOR_LOOKS_FOR", name: "Nobody Ventures" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});
