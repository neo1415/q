import { describe, expect, it } from "vitest";

import {
  QClientActionToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  createOpenPageTool,
  createQToolExecutor,
  createQToolRegistry,
  type RelationshipIntelligencePort,
} from "../src/index.js";
import {
  COMPANY_B_NETWORK,
  actorA,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * Owner replay batch 8 (production log): one fast navigation, "take me to
 * harbourline cargos profile", took 3 s and 124 database round trips.
 * open_page by name built the whole list of records the person can reach
 * (relationships, feed decisions, feed page, network search) once to
 * match the name and again, by the record's own name, to check the record
 * is reachable -- though it had just been matched from that list. Now the
 * list is built once, and its reads are sent together.
 */

const NAMED = "Beacon Analytics";

/** Their own conversation, as the run's plan carries it. */
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

function counted() {
  const reads = { own: 0, decisions: 0, feed: 0 };
  let inFlight = 0;
  let together = 0;
  const track = <T>(value: T): Promise<T> => {
    inFlight += 1;
    together = Math.max(together, inFlight);
    return new Promise((resolve) =>
      setTimeout(() => {
        inFlight -= 1;
        resolve(value);
      }, 1),
    );
  };
  const relationships: RelationshipIntelligencePort = {
    ownRelationships: () => {
      reads.own += 1;
      return track({
        side: "INVESTOR" as const,
        items: [
          {
            relationshipId: "r1",
            counterpart: {
              kind: "COMPANY" as const,
              id: COMPANY_B_NETWORK,
              name: NAMED,
            },
            state: "CONNECTED" as const,
            stateSince: "2026-09-20T10:00:00.000Z",
            nextStep: "SCHEDULE_MEETING" as const,
            milestones: [],
          },
        ],
      });
    },
    withCompany: () => Promise.resolve(null),
    withInvestor: () => Promise.resolve(null),
    byRelationship: () => Promise.resolve(null),
    incomingInterest: () => Promise.resolve([]),
    mayExpressInterest: () => Promise.resolve(false),
    mayAnswerInterest: () => Promise.resolve(false),
    prepareForApproval: () => "PREPARED",
  };
  const investorFeed = {
    decisions: () => {
      reads.decisions += 1;
      return track([]);
    },
    page: () => {
      reads.feed += 1;
      return track({ items: [], notes: [] });
    },
  };
  return {
    reads,
    together: () => together,
    ports: fakePorts({ relationships, investorFeed }),
  };
}

describe("open_page by name reads the reachable records once (batch 8 speed)", () => {
  it("a company in another tenant matched by a misheard name: one list build, its reads together", async () => {
    const { reads, together, ports } = counted();
    const executor = createQToolExecutor({
      registry: createQToolRegistry([createOpenPageTool(ports)]),
    });
    const outcome = await executor.execute(
      {
        id: "call-1",
        name: "open_page",
        arguments: { page: "COMPANY", name: "beacon analitics" },
      } as never,
      contextFor(actorA, ownPlan()),
    );
    const data = (outcome as { result: { ok: boolean; data?: unknown } })
      .result;
    expect(data).toMatchObject({ ok: true });
    expect(QClientActionToolResultSchema.parse(data.data).clientAction).toEqual(
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: COMPANY_B_NETWORK },
    );
    expect(reads).toEqual({ own: 1, decisions: 1, feed: 1 });
    expect(together()).toBeGreaterThanOrEqual(3);
  });
});

describe("batch-9 replay: the Q Workspace hides open_page from the model, never from code's own lookups", () => {
  const withWorkspace = (plan: PermittedContextPlan): PermittedContextPlan => ({
    ...plan,
    screen: {
      route: "HOME",
      workspace: { qPane: "open", pagePane: "open", at: "/home" },
    },
  });
  const ask = {
    id: "call-ws",
    name: "open_page",
    arguments: { page: "COMPANY", name: "Beacon Analytics" },
  } as never;

  it("not offered to the model, and a model's proposal for it is refused", async () => {
    const { ports } = counted();
    const registry = createQToolRegistry([createOpenPageTool(ports)]);
    const executor = createQToolExecutor({ registry });
    const context = contextFor(actorA, withWorkspace(ownPlan()));
    expect(
      (await executor.offer(context)).map((tool) => tool.definition.name),
    ).not.toContain("open_page");
    const outcome = await executor.execute(ask, context);
    expect(outcome).toMatchObject({
      status: "DENIED",
      failureCode: "TOOL_NOT_ELIGIBLE",
    });
  });

  it("code's own call (the page-move decision's record lookup) executes through open_page's authorize step", async () => {
    const { ports } = counted();
    const executor = createQToolExecutor({
      registry: createQToolRegistry([createOpenPageTool(ports)]),
    });
    const outcome = await executor.execute(ask, {
      ...contextFor(actorA, withWorkspace(ownPlan())),
      invokedBy: "CODE",
    });
    const result = (outcome as { result: { ok: boolean; data?: unknown } })
      .result;
    expect(result).toMatchObject({ ok: true });
    expect(
      QClientActionToolResultSchema.parse(result.data).clientAction,
    ).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
      id: COMPANY_B_NETWORK,
    });
  });
});

describe("batch-11 replay: in the Q Workspace a company's deck opens on its Deck tab, not in the viewer", () => {
  const DECK_DOCUMENT = "d0000000-0000-4000-8000-0000000000aa";
  const withDeck = () => {
    const { ports } = counted();
    return {
      ...ports,
      profileMaterial: {
        deck: () =>
          Promise.resolve({
            deck: { documentId: DECK_DOCUMENT, title: "Seed deck" },
          }),
      },
    } as unknown as typeof ports;
  };
  const ask = {
    id: "call-deck",
    name: "open_page",
    arguments: { page: "COMPANY_DECK", name: "Beacon Analytics" },
  } as never;
  const clientAction = (outcome: unknown) =>
    QClientActionToolResultSchema.parse(
      (outcome as { result: { data?: unknown } }).result.data,
    ).clientAction;

  it("outside the workspace: the deck opens in the material viewer where they are (as before)", async () => {
    const executor = createQToolExecutor({
      registry: createQToolRegistry([createOpenPageTool(withDeck())]),
    });
    expect(
      clientAction(await executor.execute(ask, contextFor(actorA, ownPlan()))),
    ).toMatchObject({ page: "DATA_ROOM_DOCUMENT", id: DECK_DOCUMENT });
  });

  it("in the workspace: the page pane beside them is where they are, so the deck opens on the company's Deck tab", async () => {
    const executor = createQToolExecutor({
      registry: createQToolRegistry([createOpenPageTool(withDeck())]),
    });
    const plan: PermittedContextPlan = {
      ...ownPlan(),
      screen: {
        route: "DISCOVER",
        workspace: { qPane: "open", pagePane: "open", at: "/discover" },
      },
    };
    expect(
      clientAction(
        await executor.execute(ask, {
          ...contextFor(actorA, plan),
          invokedBy: "CODE",
        }),
      ),
    ).toMatchObject({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY_DECK",
      id: COMPANY_B_NETWORK,
    });
  });
});
