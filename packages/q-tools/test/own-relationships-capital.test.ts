import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type {
  CompanyProfileFacts,
  CompanyQueryPort,
} from "@capital-q/companies";
import {
  PermittedContextPlanSchema,
  Q_TASK_CLASSES,
  type PermittedContextPlan,
  type QTaskClass,
} from "@capital-q/contracts";
import type {
  DisclosureAccessService,
  DisclosureDecision,
} from "@capital-q/permissions";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type InvestorFeedPort,
  type OwnRelationships,
  type RelationshipIntelligencePort,
} from "../src/index.js";
import {
  contextFor,
  fakeAuthorization,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * R35 live report (investor): "Q doesn't know anything about the companies
 * I expressed interest in ... how much is the company looking for? it
 * doesn't know." Reproduced here at the planner/tool level with a fake
 * model, and held as properties:
 *
 *   1. the person's own relationships, interests, saves and passes are
 *      listable in EVERY purpose a run can have -- no word in the question
 *      decides it, so every paraphrase lands on the same plan and tools;
 *   2. "compare the companies I'm interested in" resolves the set from
 *      their own records, never from names they must supply;
 *   3. a raise is answered when disclosure lets this person see it
 *      (network_visible, or shared to their relationship), and is
 *      NOT_SHARED_WITH_YOU otherwise -- never "unknown", never leaked;
 *   4. another organisation's interests and a founder-private raise never
 *      reach this investor.
 *
 * Before R35: no tool listed an investor's own relationships (only a
 * company's inbox), and get_capital_objective was neither offered for a
 * general question nor reachable without a company named on screen.
 */

const TENANT_I = "11111111-1111-4111-8111-111111111111";
const ORG_I = "11111111-0000-4000-8000-000000000001";
const ORG_J = "11111111-0000-4000-8000-000000000002";
const INVESTOR_I = "12121212-0000-4000-8000-000000000001";
const INVESTOR_J = "12121212-0000-4000-8000-000000000002";

const TENANT_F = "22222222-2222-4222-8222-222222222222";
const ORG_F1 = "22222222-0000-4000-8000-000000000001";
const ORG_F2 = "22222222-0000-4000-8000-000000000002";
const ORG_F3 = "22222222-0000-4000-8000-000000000003";
/** Pending interest; raise network_visible. */
const NORTHWIND = "33333333-0000-4000-8000-000000000001";
/** Accepted interest (CONNECTED); raise relationship_shared to it. */
const KESTREL = "33333333-0000-4000-8000-000000000002";
/** Saved only; raise founder_private. */
const SAVED_CO = "33333333-0000-4000-8000-000000000003";
const OBJ_NORTHWIND = "44444444-0000-4000-8000-000000000001";
const OBJ_KESTREL = "44444444-0000-4000-8000-000000000002";
const OBJ_SAVED = "44444444-0000-4000-8000-000000000003";
const REL_NORTHWIND = "55555555-0000-4000-8000-000000000001";
const REL_KESTREL = "55555555-0000-4000-8000-000000000002";
const REL_J = "55555555-0000-4000-8000-000000000009";

/** A founder-private amount and another organisation's counterparty: must never surface. */
const PRIVATE_AMOUNT = "987654321";
const J_ONLY_COMPANY_NAME = "Jays Private Pipeline Co";

function human(organisationId: string, tenantId: string): ActorContext {
  return ActorContextSchema.parse({
    userId: randomUUID(),
    tenantId,
    organisationId,
    membershipId: randomUUID(),
    actorType: "HUMAN",
  });
}

const investorI = human(ORG_I, TENANT_I);
const investorJ = human(ORG_J, TENANT_I);
const founderKestrel = human(ORG_F2, TENANT_F);

function company(
  id: string,
  organisationId: string,
  canonicalName: string,
): CompanyProfileFacts {
  return {
    id,
    tenantId: TENANT_F,
    organisationId,
    canonicalName,
    legalName: null,
    websiteUrl: null,
    foundedDate: null,
    headquartersCountry: "GB",
    headquartersCity: null,
    currentStageCode: "seed",
    primaryDescription: null,
    shortDescription: `${canonicalName} (synthetic).`,
    companyStatus: "active",
    marketplaceVisibility: "network_visible",
  } as CompanyProfileFacts;
}

const COMPANIES = new Map<string, CompanyProfileFacts>([
  [NORTHWIND, company(NORTHWIND, ORG_F1, "Northwind Grid")],
  [KESTREL, company(KESTREL, ORG_F2, "Kestrel Bio")],
  [SAVED_CO, company(SAVED_CO, ORG_F3, "Saved Co")],
]);

const OBJECTIVES = new Map<
  string,
  { id: string; amount: string; currency: string }
>([
  [NORTHWIND, { id: OBJ_NORTHWIND, amount: "1500000", currency: "GBP" }],
  [KESTREL, { id: OBJ_KESTREL, amount: "3000000.00", currency: "USD" }],
  [SAVED_CO, { id: OBJ_SAVED, amount: PRIVATE_AMOUNT, currency: "EUR" }],
]);

const companies: CompanyQueryPort = {
  ...fakePorts().companies,
  findCanonicalCompany: (id) => {
    const p = COMPANIES.get(id);
    return Promise.resolve(
      p === undefined
        ? null
        : {
            id: p.id,
            tenantId: p.tenantId,
            organisationId: p.organisationId,
            canonicalName: p.canonicalName,
            companyStatus: p.companyStatus,
          },
    );
  },
  findCanonicalCompanyProfile: (id) =>
    Promise.resolve(COMPANIES.get(id) ?? null),
};

const capital: CapitalObjectiveQueryPort = {
  findCanonicalCapitalObjective: () => Promise.resolve(null),
  getById: () => Promise.resolve(null),
  getCurrentForCompany: (tenantId, companyId) => {
    const o = OBJECTIVES.get(companyId);
    return Promise.resolve(
      o === undefined || tenantId !== TENANT_F
        ? null
        : ({
            id: o.id,
            tenantId: TENANT_F,
            companyId,
            objectiveType: "RAISE",
            status: "ACTIVE",
            target: { amount: o.amount, currency: o.currency },
            targetStage: "seed",
            instrumentCode: "safe",
            targetCloseDate: null,
            startedAt: "2026-09-01T00:00:00.000Z",
            closedAt: null,
            version: 1,
          } as unknown as Awaited<
            ReturnType<CapitalObjectiveQueryPort["getCurrentForCompany"]>
          >),
    );
  },
};

/**
 * The disclosure engine, scripted: every company is network-visible; the
 * Northwind raise is network_visible; the Kestrel raise is shared to its
 * relationship with investor I only (RELATIONSHIP_PARTY); the Saved Co
 * raise is founder_private. Owners see their own.
 */
const disclosure: DisclosureAccessService = (() => {
  const decide = (
    request: Parameters<DisclosureAccessService["canDisclose"]>[0],
  ): DisclosureDecision => {
    const actor =
      request.principal.kind === "ACTOR" ? request.principal.actor : null;
    const allow = (
      reasonCode:
        "NETWORK_VISIBLE" | "RELATIONSHIP_PARTY" | "SAME_ORGANISATION",
    ): DisclosureDecision => ({
      outcome: "ALLOW",
      resource: request.resource,
      requestedAccess: request.requestedAccess,
      grantedAccess: "view",
      reasonCode,
      via: { kind: "INTRINSIC" },
    });
    const deny: DisclosureDecision = {
      outcome: "DENY",
      resource: request.resource,
      requestedAccess: request.requestedAccess,
      reasonCode: "NO_MATCHING_SCOPE",
    };
    if (actor === null) return deny;
    if (request.resource.type === "company") {
      return COMPANIES.has(request.resource.id)
        ? allow("NETWORK_VISIBLE")
        : deny;
    }
    if (request.resource.type === "capital_objective") {
      if (request.resource.id === OBJ_NORTHWIND)
        return allow("NETWORK_VISIBLE");
      if (request.resource.id === OBJ_KESTREL) {
        if (actor.organisationId === ORG_F2) return allow("SAME_ORGANISATION");
        return actor.organisationId === ORG_I
          ? allow("RELATIONSHIP_PARTY")
          : deny;
      }
      return deny;
    }
    return deny;
  };
  return {
    canDisclose: (request) => Promise.resolve(decide(request)),
    evaluateMany: (requests) => Promise.resolve(requests.map(decide)),
  };
})();

const at = (day: number) => new Date(Date.UTC(2026, 8, day)).toISOString();

/** Each organisation's own side, keyed by the actor's membership -- never by input. */
const OWN: Readonly<Record<string, OwnRelationships>> = {
  [ORG_I]: {
    side: "INVESTOR",
    items: [
      {
        relationshipId: REL_NORTHWIND,
        counterpart: { kind: "COMPANY", id: NORTHWIND, name: "Northwind Grid" },
        state: "INTEREST_EXPRESSED",
        stateSince: at(10),
        nextStep: "AWAIT_ANSWER",
        milestones: [
          { state: "DISCOVERED", at: at(9) },
          { state: "INTEREST_EXPRESSED", at: at(10) },
        ],
      },
      {
        relationshipId: REL_KESTREL,
        counterpart: { kind: "COMPANY", id: KESTREL, name: "Kestrel Bio" },
        state: "CONNECTED",
        stateSince: at(14),
        nextStep: "SCHEDULE_MEETING",
        milestones: [
          { state: "INTEREST_EXPRESSED", at: at(12) },
          { state: "CONNECTED", at: at(14) },
        ],
      },
    ],
  },
  [ORG_J]: {
    side: "INVESTOR",
    items: [
      {
        relationshipId: REL_J,
        counterpart: {
          kind: "COMPANY",
          id: "33333333-0000-4000-8000-00000000000f",
          name: J_ONLY_COMPANY_NAME,
        },
        state: "INTEREST_EXPRESSED",
        stateSince: at(3),
        nextStep: "AWAIT_ANSWER",
        milestones: [{ state: "INTEREST_EXPRESSED", at: at(3) }],
      },
    ],
  },
  [ORG_F2]: {
    side: "COMPANY",
    items: [
      {
        relationshipId: REL_KESTREL,
        counterpart: {
          kind: "INVESTOR_ORGANISATION",
          id: INVESTOR_I,
          name: "Ivy Capital",
        },
        state: "CONNECTED",
        stateSince: at(14),
        nextStep: "SCHEDULE_MEETING",
        milestones: [
          { state: "INTEREST_EXPRESSED", at: at(12) },
          { state: "CONNECTED", at: at(14) },
        ],
      },
    ],
  },
};

const ownRelationshipCalls: string[] = [];
const relationships: RelationshipIntelligencePort = {
  ownRelationships: (actor) => {
    ownRelationshipCalls.push(actor.organisationId ?? "none");
    return Promise.resolve(OWN[actor.organisationId ?? ""] ?? null);
  },
  withCompany: () => Promise.resolve(null),
  withInvestor: () => Promise.resolve(null),
  byRelationship: () => Promise.resolve(null),
  incomingInterest: () => Promise.resolve([]),
  mayExpressInterest: () => Promise.resolve(false),
  mayAnswerInterest: () => Promise.resolve(false),
  prepareForApproval: () => "PREPARED",
};

const investorFeed: InvestorFeedPort = {
  page: () => Promise.resolve(null),
  decisions: (actor) =>
    Promise.resolve(
      actor.organisationId === ORG_I
        ? [
            {
              companyId: SAVED_CO,
              name: "Saved Co",
              stageCode: "seed",
              headquartersCountry: "GB",
              decision: "SAVED" as const,
            },
          ]
        : [],
    ),
};

void INVESTOR_J;

const ports = fakePorts({
  companies,
  capital,
  disclosure,
  authorization: fakeAuthorization(),
  relationships,
  investorFeed,
});
const registry = createQToolRegistry(createDefaultQTools(ports));
const executor = createQToolExecutor({ registry });

/**
 * The plan the firewall builds for a turn that names no company: the
 * actor-wide scopes only (OWN_Q_CONVERSATION bound to this person). The
 * task class is the firewall's derivation from capability and subjects;
 * words never enter it, so every paraphrase of a question gets this plan.
 */
function unnamedPlan(
  actor: ActorContext,
  taskClass: QTaskClass,
): PermittedContextPlan {
  const base = planFor(actor, taskClass, [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    { kind: "OWN_ONBOARDING", sensitivity: "CONFIDENTIAL" },
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
    { kind: "PUBLIC_EXTERNAL_DATA", sensitivity: "PUBLIC" },
  ]);
  return PermittedContextPlanSchema.parse({
    ...base,
    purpose: {
      capability: taskClass === "COMPARISON" ? "COMPARE" : "ANSWER",
      taskClass,
    },
    scopes: base.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  });
}

async function call(
  actor: ActorContext,
  plan: PermittedContextPlan,
  name: string,
  args: Record<string, unknown>,
) {
  return executor.execute(
    { callId: randomUUID(), name, arguments: args },
    contextFor(actor, plan),
  );
}

type Listed = {
  yourSide: string;
  relationships: {
    counterpart: { id: string; name: string };
    state: string;
    milestones: { state: string; at: string }[];
  }[];
  saved: { companyId: string; name: string }[];
  passed: unknown[];
};

async function listMine(actor: ActorContext, plan: PermittedContextPlan) {
  const outcome = await call(actor, plan, "list_my_relationships", {});
  expect(outcome.status).toBe("SUCCEEDED");
  if (!outcome.result.ok) throw new Error("list failed");
  return outcome.result.data as Listed;
}

type Raise = {
  availability: string;
  objective: { target: { amount: string; currency: string } } | null;
};

async function raiseOf(
  actor: ActorContext,
  plan: PermittedContextPlan,
  companyId: string,
) {
  const outcome = await call(actor, plan, "get_capital_objective", {
    companyId,
  });
  return outcome;
}

describe("R35: the relationship and capital part of the product is Q's to read", () => {
  it.each(Q_TASK_CLASSES)(
    "%s: their own relationships, a company's raise and profile are offered with no company named",
    async (taskClass) => {
      const offered = (
        await executor.offer(
          contextFor(investorI, unnamedPlan(investorI, taskClass)),
        )
      ).map((tool) => tool.definition.name);
      expect(offered).toContain("list_my_relationships");
      expect(offered).toContain("get_capital_objective");
      expect(offered).toContain("get_relationship");
    },
  );

  it("(a) 'have I expressed interest in anyone? which?': both interests, named, with state and dates", async () => {
    const listed = await listMine(
      investorI,
      unnamedPlan(investorI, "GENERAL_QUESTION"),
    );
    expect(listed.yourSide).toBe("INVESTOR");
    expect(
      listed.relationships.map((r) => [r.counterpart.name, r.state]),
    ).toEqual([
      ["Northwind Grid", "INTEREST_EXPRESSED"],
      ["Kestrel Bio", "CONNECTED"],
    ]);
    // Dated: when the interest was expressed, and when it was accepted.
    expect(listed.relationships[1]?.milestones).toEqual([
      { state: "INTEREST_EXPRESSED", at: at(12) },
      { state: "CONNECTED", at: at(14) },
    ]);
    // A save is theirs to know, and is not an interest.
    expect(listed.saved.map((s) => s.name)).toEqual(["Saved Co"]);
  });

  it("(b) 'compare the companies I'm interested in': the set comes from their records, and only what they may see is compared", async () => {
    const plan = unnamedPlan(investorI, "COMPARISON");
    // The fake model: resolve the set, then read each company and its raise.
    const listed = await listMine(investorI, plan);
    const interested = listed.relationships
      .filter(
        (r) => r.state === "INTEREST_EXPRESSED" || r.state === "CONNECTED",
      )
      .map((r) => r.counterpart.id);
    expect(interested).toEqual([NORTHWIND, KESTREL]);
    const rows = [];
    for (const id of interested) {
      const profile = await call(investorI, plan, "get_company", {
        companyId: id,
      });
      const raise = await raiseOf(investorI, plan, id);
      expect(profile.status).toBe("SUCCEEDED");
      expect(raise.status).toBe("SUCCEEDED");
      rows.push(raise.result.ok ? (raise.result.data as Raise) : null);
    }
    expect(rows.map((r) => [r?.availability, r?.objective?.target])).toEqual([
      ["CURRENT", { amount: "1500000", currency: "GBP" }],
      ["CURRENT", { amount: "3000000.00", currency: "USD" }],
    ]);
  });

  it("(c) 'how much is Kestrel raising?': exact decimal and currency, when shared to their relationship", async () => {
    const outcome = await raiseOf(
      investorI,
      unnamedPlan(investorI, "GENERAL_QUESTION"),
      KESTREL,
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        availability: "CURRENT",
        objective: { target: { amount: "3000000.00", currency: "USD" } },
      },
    });
  });

  it("(c) a founder-private raise is NOT_SHARED_WITH_YOU -- never unknown, never the amount", async () => {
    for (const taskClass of Q_TASK_CLASSES) {
      const outcome = await raiseOf(
        investorI,
        unnamedPlan(investorI, taskClass),
        SAVED_CO,
      );
      expect(outcome.status).toBe("SUCCEEDED");
      expect(outcome.result).toMatchObject({
        ok: true,
        data: { availability: "NOT_SHARED_WITH_YOU", objective: null },
      });
      expect(JSON.stringify(outcome)).not.toContain(PRIVATE_AMOUNT);
    }
  });

  it("a raise shared to one relationship does not reach another investor", async () => {
    const outcome = await raiseOf(
      investorJ,
      unnamedPlan(investorJ, "GENERAL_QUESTION"),
      KESTREL,
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { availability: "NOT_SHARED_WITH_YOU", objective: null },
    });
    expect(JSON.stringify(outcome)).not.toContain("3000000");
  });

  it("another organisation's interests are never visible: the list is the asker's own, and takes no counterparty", async () => {
    ownRelationshipCalls.length = 0;
    const listed = await listMine(
      investorI,
      unnamedPlan(investorI, "GENERAL_QUESTION"),
    );
    expect(JSON.stringify(listed)).not.toContain(J_ONLY_COMPANY_NAME);
    expect(ownRelationshipCalls).toEqual([ORG_I]);
    // No parameter can name someone else's organisation.
    const forged = await call(
      investorI,
      unnamedPlan(investorI, "GENERAL_QUESTION"),
      "list_my_relationships",
      { investorOrganisationId: INVESTOR_J },
    );
    expect(forged.status).not.toBe("SUCCEEDED");
  });

  it("is refused outside the person's own conversation", async () => {
    // A plan whose own-conversation scope belongs to somebody else.
    const plan = unnamedPlan(investorJ, "GENERAL_QUESTION");
    const outcome = await call(investorI, plan, "list_my_relationships", {});
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("the founder side: their incoming interest and relationships are always theirs to know", async () => {
    const listed = await listMine(
      founderKestrel,
      unnamedPlan(founderKestrel, "GENERAL_QUESTION"),
    );
    expect(listed.yourSide).toBe("COMPANY");
    expect(
      listed.relationships.map((r) => [r.counterpart.name, r.state]),
    ).toEqual([["Ivy Capital", "CONNECTED"]]);
    expect(listed.saved).toEqual([]);
    // Their own raise, as the owner.
    const own = await raiseOf(
      founderKestrel,
      unnamedPlan(founderKestrel, "GENERAL_QUESTION"),
      KESTREL,
    );
    expect(own.result).toMatchObject({
      ok: true,
      data: { availability: "CURRENT" },
    });
  });

  it("a company the firewall named but refused stays refused", async () => {
    const plan = PermittedContextPlanSchema.parse({
      ...unnamedPlan(investorI, "COUNTERPARTY_COMPANY_QUESTION"),
      subjects: [{ kind: "COMPANY", companyId: SAVED_CO }],
    });
    const outcome = await raiseOf(investorI, plan, SAVED_CO);
    expect(outcome.status).toBe("DENIED");
    expect(JSON.stringify(outcome)).not.toContain(PRIVATE_AMOUNT);
  });
});

/**
 * R35 (Discover live report): the founder paused a pitch and asked "what
 * is this about?"; Q said it could not see it. The web now reports the
 * card on screen (company, pitch, position) on every turn; the Q API binds
 * it as the run's subject and keeps the authorised moment on the plan.
 * Here: with that plan, the pitch, the company and the person's own
 * Save / Pass / Express Interest are offered and act on that company --
 * and never on one that is neither on screen nor asked about.
 */
describe("R35: the company on screen in Discover", () => {
  const PITCH = "66666666-0000-4000-8000-000000000001";
  const decided: { type: string; companyId: string }[] = [];
  const expressed: string[] = [];
  const screenPorts = fakePorts({
    companies,
    capital,
    disclosure,
    authorization: fakeAuthorization(),
    relationships: {
      ...relationships,
      mayExpressInterest: () => Promise.resolve(true),
      prepareForApproval: (entry) => {
        expressed.push(entry.payload.companyId ?? "");
        return "PREPARED";
      },
    },
    investorFeed,
    discoveryDecisions: {
      decide: (_actor, decision) => {
        decided.push({ type: decision.type, companyId: decision.companyId });
        return Promise.resolve({
          status: "RECORDED",
          deduplicated: false,
          saved: decision.type === "SAVE",
          passed: decision.type === "PASS",
        });
      },
    },
    pitchMoments: {
      momentAround: () =>
        Promise.resolve({
          status: "AVAILABLE",
          cues: [
            { startMs: 60_000, endMs: 64_000, text: "We store grid power." },
          ],
        }),
    } as never,
  });
  const screenExecutor = createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(screenPorts)),
  });

  /** What the firewall builds for a turn asked with Northwind's card on screen, paused at 1:02. */
  function onScreen(actor: ActorContext): PermittedContextPlan {
    const base = unnamedPlan(actor, "COUNTERPARTY_COMPANY_QUESTION");
    const withCompany = planFor(actor, "COUNTERPARTY_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        sensitivity: "NETWORK_VISIBLE",
        companyId: NORTHWIND,
      },
    ]);
    return PermittedContextPlanSchema.parse({
      ...base,
      subjects: withCompany.subjects,
      scopes: [...base.scopes, ...withCompany.scopes],
      viewing: {
        kind: "PITCH_PLAYBACK",
        companyId: NORTHWIND,
        mediaAssetId: PITCH,
        positionSeconds: 62,
      },
    });
  }

  const run = (name: string, args: Record<string, unknown>) =>
    screenExecutor.execute(
      { callId: randomUUID(), name, arguments: args },
      contextFor(investorI, onScreen(investorI)),
    );

  it("offers the pitch, the company, its raise and their own actions on it", async () => {
    const offered = (
      await screenExecutor.offer(contextFor(investorI, onScreen(investorI)))
    ).map((tool) => tool.definition.name);
    for (const name of [
      "get_pitch_moment",
      "get_company",
      "get_capital_objective",
      "save_company",
      "pass_company",
      "propose_express_interest",
      "list_my_relationships",
    ]) {
      expect(offered).toContain(name);
    }
  });

  it("'save this' / 'pass' / 'I'm interested' act on the company on screen", async () => {
    decided.length = 0;
    expressed.length = 0;
    expect(
      (await run("save_company", { companyId: NORTHWIND })).result,
    ).toMatchObject({ ok: true, data: { status: "DONE", saved: true } });
    expect(
      (await run("pass_company", { companyId: NORTHWIND })).result,
    ).toMatchObject({ ok: true, data: { status: "DONE", passed: true } });
    expect(
      (await run("propose_express_interest", { companyId: NORTHWIND })).result,
    ).toMatchObject({ ok: true, data: { status: "PREPARED" } });
    expect(decided).toEqual([
      { type: "SAVE", companyId: NORTHWIND },
      { type: "PASS", companyId: NORTHWIND },
    ]);
    // Express Interest is only prepared: the person approves it.
    expect(expressed).toEqual([NORTHWIND]);
  });

  it("never acts on a company that is neither on screen nor asked about", async () => {
    decided.length = 0;
    expressed.length = 0;
    for (const name of [
      "save_company",
      "pass_company",
      "propose_express_interest",
    ]) {
      const outcome = await run(name, { companyId: KESTREL });
      expect(outcome.status).not.toBe("SUCCEEDED");
    }
    expect(decided).toEqual([]);
    expect(expressed).toEqual([]);
  });
});
