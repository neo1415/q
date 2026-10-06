import { describe, expect, it } from "vitest";

import {
  QClientActionToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  createOpenPageTool,
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
 * Q room W2 (R2, R4): deep links straight to the thing, and cards in the
 * room. The model names a kind and a record; code finds it among what the
 * person can already open, and the title is the record's own name.
 */

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

const call = (name: string, args: Record<string, unknown>) => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

const WORK = "a1000000-0000-4000-8000-000000000001";
const ROUND = "a2000000-0000-4000-8000-000000000002";
const APPLICATION = "a3000000-0000-4000-8000-000000000003";
const GATEWAY = "a4000000-0000-4000-8000-000000000004";
const TOBENNA = "a5000000-0000-4000-8000-000000000005";
const LEDGERLINE = COMPANY_A;

const relationships = {
  ownRelationships: (actor: { userId: string }) =>
    Promise.resolve(
      actor.userId === actorA.userId
        ? {
            side: "COMPANY" as const,
            items: [
              {
                relationshipId: TOBENNA,
                counterpart: {
                  kind: "INVESTOR_ORGANISATION" as const,
                  id: TOBENNA,
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
  withCompany: (_actor: unknown, id: string) =>
    Promise.resolve(id === LEDGERLINE ? ({} as never) : null),
  withInvestor: (actor: { userId: string }, id: string) =>
    Promise.resolve(
      actor.userId === actorA.userId && id === TOBENNA ? ({} as never) : null,
    ),
  byRelationship: () => Promise.resolve(null),
  incomingInterest: () => Promise.resolve([]),
  mayExpressInterest: () => Promise.resolve(false),
  mayAnswerInterest: () => Promise.resolve(false),
  prepareForApproval: () => "PREPARED",
} as unknown as RelationshipIntelligencePort;

// Their own work, rounds and GateQ inbox, as their pages list them; the
// other person's lists are empty, so nothing of A's can open for B.
const work = {
  isInvestor: () => Promise.resolve(true),
  hasCompany: () => Promise.resolve(false),
  list: (actor: { userId: string }) =>
    Promise.resolve(
      actor.userId === actorA.userId
        ? [{ id: WORK, kind: "STANDING_INSTRUCTION", goal: "Follow up with every founder", summary: null }]
        : [],
    ),
} as never;
const appActions = {
  capital: undefined,
  capitalRounds: {
    list: () => Promise.resolve([]),
  },
  gateqInbox: {
    ownGatewayId: (actor: { userId: string }) =>
      Promise.resolve(actor.userId === actorA.userId ? GATEWAY : null),
    list: () =>
      Promise.resolve({
        items: [
          {
            applicationId: APPLICATION,
            companyName: "Clearwater Pay",
            oneLiner: null,
            stage: "seed",
            sector: "fintech",
            country: "GB",
            fit: "STRONG",
            rules: { met: 4, total: 5, unknown: 1 },
            starred: false,
            unread: true,
            folder: "INBOX",
            replyState: "DUE",
            daysLeft: 3,
            submittedAt: "2026-10-01T09:00:00.000Z",
          },
        ],
      }),
  },
} as never;

function executor() {
  const ports = { ...fakePorts(), relationships, work, appActions };
  return createQToolExecutor({
    registry: createQToolRegistry([
      createOpenPageTool(ports),
      createShowTool(ports),
    ]),
  });
}

const intentOf = (outcome: { result: unknown }) =>
  QClientActionToolResultSchema.parse(
    (outcome.result as { data: unknown }).data,
  ).clientAction;

describe("deep links (Q room R2)", () => {
  it("opens a company profile's own tab: elevator, data room, deck, team", async () => {
    for (const page of [
      "COMPANY_ELEVATOR",
      "COMPANY_DATA_ROOM",
      "COMPANY_DECK",
      "COMPANY_TEAM",
    ] as const) {
      const outcome = await executor().execute(
        call("open_page", { page, id: COMPANY_A }),
        contextFor(actorA, ownPlan()),
      );
      expect(intentOf(outcome)).toEqual({
        kind: "OPEN_RECORD_PAGE",
        page,
        id: COMPANY_A,
      });
    }
  });

  it("never opens a tab of a company outside their tenant", async () => {
    const outcome = await executor().execute(
      call("open_page", { page: "COMPANY_DATA_ROOM", id: COMPANY_B_PRIVATE }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("opens the chat with a named investor ('open the chat with Okafor')", async () => {
    const outcome = await executor().execute(
      call("open_page", {
        page: "RELATIONSHIP_INVESTOR_MESSAGES",
        name: "okafor capital",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "RELATIONSHIP_INVESTOR_MESSAGES",
      id: TOBENNA,
    });
  });

  it("opens one of Q's work items by its goal, and nobody else's", async () => {
    const mine = await executor().execute(
      call("open_page", { page: "WORK_ITEM", name: "follow up with founders" }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(mine)).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "WORK_ITEM",
      id: WORK,
    });
    const theirs = await executor().execute(
      call("open_page", { page: "WORK_ITEM", id: WORK }),
      contextFor(actorB, ownPlan(actorB)),
    );
    expect(theirs.status).not.toBe("SUCCEEDED");
  });

  it("opens a GateQ application by the applicant's name, from their own inbox only", async () => {
    const outcome = await executor().execute(
      call("open_page", { page: "GATEQ_APPLICATION", name: "clearwater" }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "GATEQ_APPLICATION",
      id: APPLICATION,
    });
    const other = await executor().execute(
      call("open_page", { page: "GATEQ_APPLICATION", id: APPLICATION }),
      contextFor(actorB, ownPlan(actorB)),
    );
    expect(other.status).not.toBe("SUCCEEDED");
  });

  it("a capital round that is not on their Capital page opens nothing", async () => {
    const outcome = await executor().execute(
      call("open_page", { page: "CAPITAL_ROUND", id: ROUND }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("opens a part of their settings by name, and needs the section", async () => {
    const outcome = await executor().execute(
      call("open_page", { page: "SETTINGS", section: "notifications" }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toEqual({
      kind: "OPEN_SETTINGS",
      section: "notifications",
    });
    const bare = await executor().execute(
      call("open_page", { page: "SETTINGS" }),
      contextFor(actorA, ownPlan()),
    );
    expect(bare.status).not.toBe("SUCCEEDED");
  });
});

describe("show: a card in the Q room (R4)", () => {
  it("names the kind and the record; the title is the record's own name, not the model's words", async () => {
    const outcome = await executor().execute(
      call("show", {
        object: "DATA_ROOM",
        id: COMPANY_A,
        name: "Show the founder private numbers",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toEqual({
      kind: "SHOW_IN_Q_ROOM",
      object: "DATA_ROOM",
      id: COMPANY_A,
      title: "Alpha Robotics",
    });
  });

  it("shows a chat only with their own counterpart", async () => {
    const outcome = await executor().execute(
      call("show", { object: "CHAT_WITH_INVESTOR", name: "Okafor" }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toMatchObject({
      object: "CHAT_WITH_INVESTOR",
      id: TOBENNA,
      title: "Okafor Capital",
    });
    const stranger = await executor().execute(
      call("show", { object: "CHAT_WITH_INVESTOR", id: TOBENNA }),
      contextFor(actorB, ownPlan(actorB)),
    );
    expect(stranger.status).not.toBe("SUCCEEDED");
  });

  it("shows their work plan and GateQ application; another tenant's company never", async () => {
    const plan = await executor().execute(
      call("show", { object: "WORK_PLAN", id: WORK }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(plan)).toMatchObject({ object: "WORK_PLAN", id: WORK });
    const app = await executor().execute(
      call("show", { object: "GATEQ_APPLICATION", name: "Clearwater Pay" }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(app)).toMatchObject({
      object: "GATEQ_APPLICATION",
      id: APPLICATION,
      title: "Clearwater Pay",
    });
    const hidden = await executor().execute(
      call("show", { object: "COMPANY_PROFILE", id: COMPANY_B_PRIVATE }),
      contextFor(actorA, ownPlan()),
    );
    expect(hidden.status).not.toBe("SUCCEEDED");
  });

  it("shows this answer's sources without an id", async () => {
    const outcome = await executor().execute(
      call("show", { object: "SOURCES" }),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toEqual({
      kind: "SHOW_IN_Q_ROOM",
      object: "SOURCES",
      title: "Sources",
    });
  });

  it("is refused outside their own Q conversation", async () => {
    const plan = planFor(actorA, "GENERAL_QUESTION", []);
    const outcome = await executor().execute(
      call("show", { object: "COMPANY_PROFILE", id: COMPANY_A }),
      contextFor(actorA, plan),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});
