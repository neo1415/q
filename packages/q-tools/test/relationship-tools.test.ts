import { describe, expect, it } from "vitest";

import type {
  DisclosureScope,
  IncomingInterestDto,
  PermittedContextPlan,
  RelationshipStatusDto,
} from "@capital-q/contracts";
import {
  nextStepFor,
  projectRelationshipState,
  visibleToParty,
  type ProjectableEvent,
  type RelationshipParty,
} from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type RelationshipIntelligencePort,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  INVESTOR_B,
  planFor,
  RUN,
} from "./support.js";

/**
 * Relationship intelligence tools (CQ-Q-030), held to three properties:
 *
 *   1. a party's answer is the projector's fold of exactly the history that
 *      party may see -- so another party's private facts never leak;
 *   2. the firewall comes first: a counterparty the plan named but did not
 *      admit is refused before the Network service is ever asked;
 *   3. nothing is written but a prepared proposal: no tool can accept,
 *      decline or express anything, and a refused precondition prepares
 *      nothing.
 *
 * actorA founds COMPANY_A; actorB is a member of INVESTOR_B. The fake port
 * folds a seeded random history with the real CQ-NET-012 projector.
 */

function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = [
  "interest_expressed",
  "connection_accepted",
  "interest_declined",
] as const;
const SCOPES: readonly DisclosureScope[] = [
  "investor_private",
  "founder_private",
  "relationship_shared",
];

function randomHistory(seed: number): ProjectableEvent[] {
  const next = generator(seed);
  const length = 1 + Math.floor(next() * 8);
  const events: ProjectableEvent[] = [];
  for (let sequence = 1; sequence <= length; sequence += 1) {
    events.push({
      sequence,
      // Every pair starts with the investor's private discovery.
      eventType:
        sequence === 1
          ? "discovered"
          : (TYPES[Math.floor(next() * TYPES.length)] ?? "interest_expressed"),
      occurredAt: new Date(Date.UTC(2026, 8, 1 + sequence)).toISOString(),
      visibilityScope:
        sequence === 1
          ? "investor_private"
          : (SCOPES[Math.floor(next() * SCOPES.length)] ??
            "relationship_shared"),
    });
  }
  return events;
}

function statusFor(
  history: readonly ProjectableEvent[],
  party: RelationshipParty,
  companyId: string,
): RelationshipStatusDto | null {
  const projection = projectRelationshipState(visibleToParty(history, party));
  return projection === null
    ? null
    : {
        relationshipId: "88888888-0000-4000-8000-000000000001",
        companyId,
        investorOrganisationId: INVESTOR_B,
        state: projection.state,
        stateSince: projection.stateSince,
        milestones: projection.milestones.map((m) => ({
          state: m.state,
          at: m.at,
        })),
        nextStep: nextStepFor(projection.state, party),
        projectorVersion: projection.version,
      };
}

type Calls = {
  reads: string[];
  prepared: {
    actionType: string;
    payload: Readonly<Record<string, string | null>>;
  }[];
};

function fakeRelationships(
  history: readonly ProjectableEvent[],
  options: {
    readonly mayExpress?: boolean;
    readonly incoming?: readonly IncomingInterestDto[];
  } = {},
): { port: RelationshipIntelligencePort; calls: Calls } {
  const calls: Calls = { reads: [], prepared: [] };
  const port: RelationshipIntelligencePort = {
    withCompany: (actor: ActorContext, companyId) => {
      calls.reads.push(`withCompany:${companyId}`);
      if (actor.userId !== actorB.userId) {
        return Promise.reject(new Error("not an investor"));
      }
      return Promise.resolve(statusFor(history, "INVESTOR", companyId));
    },
    withInvestor: (actor: ActorContext) => {
      calls.reads.push("withInvestor");
      if (actor.userId !== actorA.userId) return Promise.resolve(null);
      return Promise.resolve(statusFor(history, "COMPANY", COMPANY_A));
    },
    byRelationship: (actor: ActorContext, relationshipId) => {
      calls.reads.push(`byRelationship:${relationshipId}`);
      if (relationshipId !== RELATIONSHIP) return Promise.resolve(null);
      if (actor.userId === actorA.userId) {
        return Promise.resolve({
          side: "COMPANY" as const,
          counterpart: {
            kind: "INVESTOR_ORGANISATION" as const,
            id: INVESTOR_B,
          },
          status: statusFor(history, "COMPANY", COMPANY_A),
        });
      }
      if (actor.userId === actorB.userId) {
        return Promise.resolve({
          side: "INVESTOR" as const,
          counterpart: { kind: "COMPANY" as const, id: COMPANY_B_NETWORK },
          status: statusFor(history, "INVESTOR", COMPANY_B_NETWORK),
        });
      }
      return Promise.resolve(null);
    },
    incomingInterest: (actor: ActorContext, companyId) => {
      calls.reads.push(`incoming:${companyId}`);
      if (actor.userId !== actorA.userId || companyId !== COMPANY_A) {
        return Promise.reject(new Error("not this company's member"));
      }
      return Promise.resolve(options.incoming ?? []);
    },
    pendingInterests: (actor: ActorContext) => {
      calls.reads.push("pendingInterests");
      if (actor.userId !== actorA.userId) {
        return Promise.reject(new Error("not a company's member"));
      }
      return Promise.resolve(
        (options.incoming ?? [])
          .filter((item) => item.response === "PENDING")
          .map((item) => ({
            interestId: item.interestId,
            companyId: COMPANY_A,
            investorOrganisationId: item.investorOrganisationId,
            investorName: item.investorName,
          })),
      );
    },
    mayExpressInterest: () => Promise.resolve(options.mayExpress ?? true),
    mayAnswerInterest: () => Promise.resolve(true),
    prepareForApproval: (entry) => {
      calls.prepared.push({
        actionType: entry.actionType,
        payload: entry.payload,
      });
      return "PREPARED";
    },
  };
  return { port, calls };
}

function executorWith(port: RelationshipIntelligencePort) {
  return createQToolExecutor({
    registry: createQToolRegistry(
      createDefaultQTools(fakePorts({ relationships: port })),
    ),
  });
}

const investorPlan = planFor(actorB, "GENERAL_QUESTION", [
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);
const founderPlan = planFor(actorA, "OWN_COMPANY_QUESTION", [
  { kind: "COMPANY_PROFILE", sensitivity: "INTERNAL", companyId: COMPANY_A },
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

type RelationshipData = {
  yourSide: string;
  counterpart: { name: string | null };
  relationship: {
    state: string;
    milestones: { state: string; at: string }[];
  } | null;
};

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

const RELATIONSHIP = "88888888-0000-4000-8000-000000000001";

/**
 * A plan the firewall made for a RELATIONSHIP subject: one
 * RELATIONSHIP_CONTEXT scope bound to that relationship, labelled for the
 * asker's own side (q-firewall relationshipLabelsFor).
 */
function relationshipPlan(
  base: PermittedContextPlan,
  side: "COMPANY" | "INVESTOR",
): PermittedContextPlan {
  const template = base.scopes[0];
  if (template === undefined) throw new Error("plan has no scope");
  return {
    ...base,
    purpose: { ...base.purpose, taskClass: "RELATIONSHIP_QUESTION" },
    subjects: [{ kind: "RELATIONSHIP", relationshipId: RELATIONSHIP }],
    scopes: [
      ...base.scopes,
      {
        ...template,
        kind: "RELATIONSHIP_CONTEXT",
        subject: { kind: "RELATIONSHIP", relationshipId: RELATIONSHIP },
        contextLabel: "relationship_shared",
        filter: {
          tenantId: base.tenantId,
          relationshipIds: [RELATIONSHIP],
          contextLabels: [
            side === "COMPANY" ? "founder_private" : "investor_private",
            "relationship_shared",
            "specifically_shared",
            "network_visible",
            "public_external",
          ],
        },
      },
    ],
  };
}

describe("get_relationship", () => {
  it("answers each side with the projector's fold of exactly what that side may see (200 random histories)", async () => {
    for (const seed of SEEDS) {
      const history = randomHistory(seed);
      const { port } = fakeRelationships(history);
      const tools = executorWith(port);

      const asInvestor = await tools.execute(
        {
          callId: "r1",
          name: "get_relationship",
          arguments: { companyId: COMPANY_B_NETWORK },
        },
        contextFor(actorB, investorPlan),
      );
      const asCompany = await tools.execute(
        {
          callId: "r2",
          name: "get_relationship",
          arguments: { investorOrganisationId: INVESTOR_B },
        },
        contextFor(actorA, founderPlan),
      );
      for (const [outcome, party] of [
        [asInvestor, "INVESTOR"],
        [asCompany, "COMPANY"],
      ] as const) {
        expect(outcome.status, `seed ${seed} ${party}`).toBe("SUCCEEDED");
        if (!outcome.result.ok) throw new Error("unreachable");
        const data = outcome.result.data as RelationshipData;
        const expected = projectRelationshipState(
          visibleToParty(history, party),
        );
        expect(data.relationship?.state ?? null, `seed ${seed} ${party}`).toBe(
          expected?.state ?? null,
        );
        expect(
          data.relationship?.milestones ?? [],
          `seed ${seed} ${party}`,
        ).toEqual(
          (expected?.milestones ?? []).map((m) => ({
            state: m.state,
            at: m.at,
          })),
        );
      }

      // The company never sees the investor's private events: no
      // milestone dated at an investor-private event reaches it.
      if (!asCompany.result.ok) throw new Error("unreachable");
      const companyData = asCompany.result.data as RelationshipData;
      const privateDates = new Set(
        history
          .filter((e) => e.visibilityScope === "investor_private")
          .map((e) => e.occurredAt),
      );
      for (const milestone of companyData.relationship?.milestones ?? []) {
        expect(privateDates.has(milestone.at), `seed ${seed}`).toBe(false);
      }
      // Nothing shared: the company learns neither a state nor a name.
      if (companyData.relationship === null) {
        expect(companyData.counterpart.name, `seed ${seed}`).toBeNull();
      }
    }
  });

  it("is refused before the Network service is asked when the firewall named the counterparty but did not admit it", async () => {
    const { port, calls } = fakeRelationships(randomHistory(1));
    const tools = executorWith(port);
    // The run is about COMPANY_B_NETWORK, and the firewall bound no scope to it.
    const denied: PermittedContextPlan = {
      ...investorPlan,
      subjects: [{ kind: "COMPANY", companyId: COMPANY_B_NETWORK }],
    };
    const outcome = await tools.execute(
      {
        callId: "r1",
        name: "get_relationship",
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      contextFor(actorB, denied),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
    expect(calls.reads).toEqual([]);
  });

  it("answers only for the asker's own side: a founder asking as an investor is refused", async () => {
    const { port } = fakeRelationships(randomHistory(2));
    const outcome = await executorWith(port).execute(
      {
        callId: "r1",
        name: "get_relationship",
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("DENIED");
  });

  it("names exactly one counterparty", async () => {
    const { port } = fakeRelationships(randomHistory(3));
    const outcome = await executorWith(port).execute(
      {
        callId: "r1",
        name: "get_relationship",
        arguments: {
          companyId: COMPANY_B_NETWORK,
          investorOrganisationId: INVESTOR_B,
        },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("FAILED");
    expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
  });
});

describe("get_relationship by relationship (the RELATIONSHIP subject)", () => {
  it("a founder asking by relationship id gets exactly the company's fold and never an investor-private fact (200 random histories)", async () => {
    const plan = relationshipPlan(founderPlan, "COMPANY");
    for (const seed of SEEDS) {
      const history = randomHistory(seed);
      const { port } = fakeRelationships(history);
      const outcome = await executorWith(port).execute(
        {
          callId: "r1",
          name: "get_relationship",
          arguments: { relationshipId: RELATIONSHIP },
        },
        contextFor(actorA, plan),
      );
      expect(outcome.status, `seed ${seed}`).toBe("SUCCEEDED");
      if (!outcome.result.ok) throw new Error("unreachable");
      const data = outcome.result.data as RelationshipData;
      expect(data.yourSide, `seed ${seed}`).toBe("COMPANY");

      const expected = projectRelationshipState(
        visibleToParty(history, "COMPANY"),
      );
      expect(data.relationship?.state ?? null, `seed ${seed}`).toBe(
        expected?.state ?? null,
      );
      const privateDates = new Set(
        history
          .filter((e) => e.visibilityScope === "investor_private")
          .map((e) => e.occurredAt),
      );
      for (const milestone of data.relationship?.milestones ?? []) {
        expect(privateDates.has(milestone.at), `seed ${seed}`).toBe(false);
        expect(milestone.state, `seed ${seed}`).not.toBe("DISCOVERED");
      }
      // The company's answer does not move when the investor's private
      // events do: dropping them all leaves it identical.
      const withoutPrivate = history.filter(
        (e) => e.visibilityScope !== "investor_private",
      );
      expect(
        projectRelationshipState(visibleToParty(withoutPrivate, "COMPANY")),
        `seed ${seed}`,
      ).toEqual(expected);
      if (data.relationship === null) {
        expect(data.counterpart.name, `seed ${seed}`).toBeNull();
      }
    }
  });

  it("an investor asking by relationship id gets the investor's own fold", async () => {
    const history = randomHistory(7);
    const { port } = fakeRelationships(history);
    const outcome = await executorWith(port).execute(
      {
        callId: "r1",
        name: "get_relationship",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(actorB, relationshipPlan(investorPlan, "INVESTOR")),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = outcome.result.data as RelationshipData;
    expect(data.yourSide).toBe("INVESTOR");
    expect(data.relationship?.state ?? null).toBe(
      projectRelationshipState(visibleToParty(history, "INVESTOR"))?.state ??
        null,
    );
  });

  it("is refused before the Network service is asked when the firewall bound no scope to that relationship", async () => {
    const { port, calls } = fakeRelationships(randomHistory(8));
    const outcome = await executorWith(port).execute(
      {
        callId: "r1",
        name: "get_relationship",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
    expect(calls.reads).toEqual([]);
  });

  it("is refused when the Network context says the actor is not a party", async () => {
    const { port } = fakeRelationships(randomHistory(9));
    const outsider: ActorContext = {
      ...actorA,
      userId: "99999999-0000-4000-8000-000000000009" as ActorContext["userId"],
    };
    const outcome = await executorWith(port).execute(
      {
        callId: "r1",
        name: "get_relationship",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(outsider, relationshipPlan(founderPlan, "COMPANY")),
    );
    expect(outcome.status).toBe("DENIED");
  });
});

const PENDING: IncomingInterestDto = {
  interestId: "77777777-0000-4000-8000-000000000001",
  investorOrganisationId: INVESTOR_B,
  investorName: "Beacon Ventures",
  investorType: "VC",
  expressedAt: "2026-09-25T10:00:00.000Z",
  response: "PENDING",
  respondedAt: null,
  connection: null,
};

describe("proposal tools write nothing but a prepared proposal", () => {
  it("propose_express_interest prepares exactly the approved action's payload and executes nothing", async () => {
    const { port, calls } = fakeRelationships(randomHistory(4));
    const outcome = await executorWith(port).execute(
      {
        callId: "p1",
        name: "propose_express_interest",
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(calls.prepared).toHaveLength(1);
    const [prepared] = calls.prepared;
    expect(prepared?.actionType).toBe("relationship.interest.express");
    // Exactly the approved action's payload: the company and its name.
    expect(Object.keys(prepared?.payload ?? {}).sort()).toEqual([
      "companyId",
      "companyName",
    ]);
    expect(prepared?.payload["companyId"]).toBe(COMPANY_B_NETWORK);
  });

  it("by name from any page (action parity 2026-10-02): 'express interest in beacon analytics' prepares it for that company", async () => {
    const { port: base, calls } = fakeRelationships(randomHistory(4));
    // Beacon is a company they already have a relationship with.
    const port: RelationshipIntelligencePort = {
      ...base,
      ownRelationships: () =>
        Promise.resolve({
          side: "INVESTOR" as const,
          items: [
            {
              relationshipId: RELATIONSHIP,
              counterpart: {
                kind: "COMPANY",
                id: COMPANY_B_NETWORK,
                name: "Beacon Analytics",
              },
              state: "INTEREST_EXPRESSED",
            },
          ],
        } as never),
    };
    const outcome = await executorWith(port).execute(
      {
        callId: "p1n",
        name: "propose_express_interest",
        arguments: { company: "beacon analytics" },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(calls.prepared[0]?.payload["companyId"]).toBe(COMPANY_B_NETWORK);
    const unknown = await executorWith(port).execute(
      {
        callId: "p1u",
        name: "propose_express_interest",
        arguments: { company: "Nowhere Holdings" },
      },
      contextFor(actorB, investorPlan),
    );
    expect(unknown.status).not.toBe("SUCCEEDED");
    expect(calls.prepared).toHaveLength(1);
  });

  it("prepares nothing when the command itself would refuse", async () => {
    const { port, calls } = fakeRelationships(randomHistory(5), {
      mayExpress: false,
    });
    const outcome = await executorWith(port).execute(
      {
        callId: "p1",
        name: "propose_express_interest",
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(calls.prepared).toEqual([]);
  });

  it("propose_interest_answer resolves the pending interest by code and prepares the answer the model chose", async () => {
    const { port, calls } = fakeRelationships(randomHistory(6), {
      incoming: [PENDING],
    });
    const tools = executorWith(port);
    for (const decision of ["ACCEPTED", "DECLINED"] as const) {
      calls.prepared.length = 0;
      const outcome = await tools.execute(
        {
          callId: "p2",
          name: "propose_interest_answer",
          arguments: {
            companyId: COMPANY_A,
            investorOrganisationId: INVESTOR_B,
            decision,
          },
        },
        contextFor(actorA, founderPlan),
      );
      expect(outcome.status).toBe("SUCCEEDED");
      expect(calls.prepared).toEqual([
        {
          actionType: "relationship.interest.respond",
          payload: {
            interestId: PENDING.interestId,
            companyId: COMPANY_A,
            decision,
            investorName: "Beacon Ventures",
          },
        },
      ]);
    }
  });

  it("names the investor: one match is prepared and named; several are asked about; none says what is waiting (lead 2026-10-03)", async () => {
    const KAZIKIT: IncomingInterestDto = {
      ...PENDING,
      interestId: "77777777-0000-4000-8000-000000000002",
      investorOrganisationId: "99999999-0000-4000-8000-000000000002",
      investorName: "Kazikit Capital",
    };
    const KAZIKIT_TWO: IncomingInterestDto = {
      ...PENDING,
      interestId: "77777777-0000-4000-8000-000000000003",
      investorOrganisationId: "99999999-0000-4000-8000-000000000003",
      investorName: "Kazikit Partners",
    };
    const ask = async (
      incoming: readonly IncomingInterestDto[],
      investor: string | null,
    ) => {
      const { port, calls } = fakeRelationships(randomHistory(10), {
        incoming,
      });
      const outcome = await executorWith(port).execute(
        {
          callId: "named",
          name: "propose_interest_answer",
          arguments: { investor, decision: "ACCEPTED" },
        },
        contextFor(actorA, founderPlan),
      );
      return { outcome, calls };
    };
    const one = await ask([PENDING, KAZIKIT], "Kazikit");
    expect(one.outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "PREPARED",
        awaitingApprovalOf: "Accept Kazikit Capital's interest",
      },
    });
    expect(one.calls.prepared).toEqual([
      {
        actionType: "relationship.interest.respond",
        payload: {
          interestId: KAZIKIT.interestId,
          companyId: COMPANY_A,
          decision: "ACCEPTED",
          investorName: "Kazikit Capital",
        },
      },
    ]);
    const several = await ask([KAZIKIT, KAZIKIT_TWO], "Kazikit");
    expect(several.outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "WHICH_ONE",
        awaitingApprovalOf:
          'More than one interest waiting matches "Kazikit": Kazikit Capital or Kazikit Partners. Which one should I accept?',
      },
    });
    expect(several.calls.prepared).toEqual([]);
    const none = await ask([PENDING], "Ledgerfold");
    expect(none.outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "NOT_FOUND",
        awaitingApprovalOf:
          '"Ledgerfold" isn\'t one of the interests waiting for your answer; those are from Beacon Ventures.',
      },
    });
    const empty = await ask([], "Kazikit");
    expect(empty.outcome.result).toMatchObject({
      ok: true,
      data: { status: "NO_PENDING_INTEREST" },
    });
  });

  it("an interest already answered, or another company's inbox, prepares nothing", async () => {
    const answered = fakeRelationships(randomHistory(7), {
      incoming: [{ ...PENDING, response: "ACCEPTED" }],
    });
    const already = await executorWith(answered.port).execute(
      {
        callId: "p3",
        name: "propose_interest_answer",
        arguments: {
          companyId: COMPANY_A,
          investorOrganisationId: INVESTOR_B,
          decision: "DECLINED",
        },
      },
      contextFor(actorA, founderPlan),
    );
    expect(already.status).toBe("DENIED");
    expect(answered.calls.prepared).toEqual([]);

    const other = fakeRelationships(randomHistory(8), { incoming: [PENDING] });
    const investorTry = await executorWith(other.port).execute(
      {
        callId: "p4",
        name: "propose_interest_answer",
        arguments: {
          companyId: COMPANY_A,
          investorOrganisationId: INVESTOR_B,
          decision: "ACCEPTED",
        },
      },
      contextFor(actorB, investorPlan),
    );
    expect(investorTry.status).toBe("DENIED");
    expect(other.calls.prepared).toEqual([]);
  });

  it("offers the two proposal tools only in the one write lane, and no tool that accepts, declines or expresses", () => {
    const { port } = fakeRelationships(randomHistory(9));
    const registry = createQToolRegistry(
      createDefaultQTools(fakePorts({ relationships: port })),
    );
    const relationshipTools = registry
      .list()
      .map((record) => record.definition)
      .filter((definition) => definition.id.startsWith("relationship."));
    expect(
      relationshipTools.map((d) => [d.providerName, d.riskClass]).sort(),
    ).toEqual([
      ["get_relationship", "SAFE_READ"],
      ["list_incoming_interest", "SAFE_READ"],
      ["propose_express_interest", "LOW_RISK_INTERNAL"],
      ["propose_interest_answer", "LOW_RISK_INTERNAL"],
    ]);
    expect(RUN).toBeTruthy();
  });
});

describe("a founder's Connection Request by name (action parity 2026-10-02)", () => {
  const KAZIKIT = "1a000000-0000-4000-8000-0000000000a1";
  function world(mayRequest: boolean) {
    const { port: base, calls } = fakeRelationships(randomHistory(7));
    const asked: string[] = [];
    const port: RelationshipIntelligencePort = {
      ...base,
      mayRequestConnection: (_actor, investorOrganisationId) => {
        asked.push(investorOrganisationId);
        return Promise.resolve(mayRequest);
      },
    };
    const executor = createQToolExecutor({
      registry: createQToolRegistry(
        createDefaultQTools(
          fakePorts({
            relationships: port,
            discovery: {
              discoverInvestors: () =>
                Promise.resolve({
                  items: [
                    {
                      investorOrganisationId: KAZIKIT,
                      displayName: "Kazikit Capital",
                    },
                  ],
                }),
            } as never,
          }),
        ),
      ),
    });
    return { executor, calls, asked };
  }
  const plan = planFor(actorA, "GENERAL_QUESTION", [
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  ]);

  it("'send Kazikit Capitol a connection request' prepares one, for approval, to Kazikit Capital", async () => {
    const { executor, calls, asked } = world(true);
    const outcome = await executor.execute(
      {
        callId: "cr1",
        name: "propose_connection_request",
        arguments: { investor: "Kazikit Capitol" },
      },
      contextFor(actorA, plan),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "PREPARED",
        awaitingApprovalOf: "Send Kazikit Capital a Connection Request",
      },
    });
    expect(asked).toEqual([KAZIKIT]);
    expect(calls.prepared).toEqual([
      {
        actionType: "relationship.connection_request.send",
        payload: {
          investorOrganisationId: KAZIKIT,
          investorName: "Kazikit Capital",
        },
      },
    ]);
  });

  it("prepares nothing where the command would refuse, or for a name they cannot see", async () => {
    const refused = world(false);
    const no = await refused.executor.execute(
      {
        callId: "cr2",
        name: "propose_connection_request",
        arguments: { investor: "Kazikit Capital" },
      },
      contextFor(actorA, plan),
    );
    expect(no.status).toBe("DENIED");
    expect(refused.calls.prepared).toEqual([]);
    const unseen = world(true);
    const nobody = await unseen.executor.execute(
      {
        callId: "cr3",
        name: "propose_connection_request",
        arguments: { investor: "Zorblax Ventures" },
      },
      contextFor(actorA, plan),
    );
    expect(nobody.status).toBe("DENIED");
    expect(unseen.asked).toEqual([]);
  });
});
