import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import { ELIGIBILITY_BATCH_MAX } from "../src/eligibility/contracts.js";
import type {
  CompanyClassification,
  CompanyEligibilityFacts,
  EligibilityPorts,
  MandateSnapshotForEligibility,
  RelationshipStanding,
} from "../src/eligibility/ports.js";
import {
  createEligibilityService,
  EligibilityBatchTooLargeError,
  InvestorSubjectNotResolvedError,
  RecommendationModeUnsupportedError,
} from "../src/eligibility/service.js";

/**
 * The service over a fake world. The world deliberately holds everything
 * the packet says must not matter — founder-private Q memory, a founder
 * conversation summary, raw document text, public-web research claims,
 * observed browsing — and the eligibility ports are written so they cannot
 * read any of it. The tests then toggle that material and prove the result
 * does not move, and change a canonical field and prove that it does.
 */

const TENANT_I = "11111111-0000-4000-8000-000000000011";
const ORG_I = "11111111-0000-4000-8000-000000000012";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const USER_I = "11111111-0000-4000-8000-000000000014";
const TENANT_C = "22222222-0000-4000-8000-000000000021";
const ORG_C = "22222222-0000-4000-8000-000000000022";
const COMPANY = "22222222-0000-4000-8000-000000000023";
const COMPANY_PRIVATE = "22222222-0000-4000-8000-000000000024";
const ACTIVE_MANDATE = "33333333-0000-4000-8000-000000000031";
const DRAFT_MANDATE = "33333333-0000-4000-8000-000000000032";
const FOREIGN_MANDATE = "33333333-0000-4000-8000-000000000033";
const GAMBLING = "44444444-0000-4000-8000-000000000041";
const PAYMENTS = "44444444-0000-4000-8000-000000000042";

const PRIVATE_MARKER = "REC_PRIVATE_FOUNDER_MEMORY_MUST_NOT_AFFECT_ELIGIBILITY";

const ACTOR = {
  userId: USER_I,
  tenantId: TENANT_I,
  organisationId: ORG_I,
  membershipId: "11111111-0000-4000-8000-000000000015",
  actorType: "HUMAN",
} as unknown as ActorContext;

type World = {
  companies: Map<string, CompanyEligibilityFacts>;
  classifications: Map<string, CompanyClassification[]>;
  mandates: Map<string, MandateSnapshotForEligibility>;
  /** Which of the investor's mandates are ACTIVE, by id. */
  activeMandateIds: string[];
  disclosure: Map<string, boolean>;
  relationships: Map<string, RelationshipStanding>;
  investorOrganisations: Map<string, string>; // orgId → investorOrganisationId
  // Material that must never matter. Present so its absence from the ports
  // is a design fact, not an accident of the fixture.
  founderPrivateMemory: string[];
  founderConversationSummary: string;
  privateDocumentText: string;
  publicWebClaims: string[];
  observedBrowsing: string[];
  taxonomyVersions: Record<string, number>;
};

function world(overrides: Partial<World> = {}): World {
  const active: MandateSnapshotForEligibility = {
    mandateId: ACTIVE_MANDATE,
    investorOrganisationId: INVESTOR,
    version: 2,
    status: "ACTIVE",
    constraints: [],
    taxonomyPreferences: [],
  };
  const draftWithExclusion: MandateSnapshotForEligibility = {
    mandateId: DRAFT_MANDATE,
    investorOrganisationId: INVESTOR,
    version: 1,
    status: "DRAFT",
    constraints: [],
    taxonomyPreferences: [
      {
        nodeId: PAYMENTS,
        vocabularyCode: "industry",
        preferenceStrength: "HARD_EXCLUSION",
        isExclusion: true,
        source: "user_selected",
      },
    ],
  };
  return {
    companies: new Map([
      [
        COMPANY,
        {
          companyId: COMPANY,
          tenantId: TENANT_C,
          organisationId: ORG_C,
          companyStatus: "active",
          marketplaceVisibility: "network_visible",
          marketplaceParticipation: "ELIGIBLE",
          currentStageCode: "seed",
          headquartersCountry: "NG",
        },
      ],
      [
        COMPANY_PRIVATE,
        {
          companyId: COMPANY_PRIVATE,
          tenantId: TENANT_C,
          organisationId: ORG_C,
          companyStatus: "active",
          marketplaceVisibility: "organisation_private",
          marketplaceParticipation: "ELIGIBLE",
          currentStageCode: "seed",
          headquartersCountry: "NG",
        },
      ],
    ]),
    classifications: new Map([
      [COMPANY, [{ nodeId: PAYMENTS, vocabularyCode: "industry" }]],
      [COMPANY_PRIVATE, [{ nodeId: PAYMENTS, vocabularyCode: "industry" }]],
    ]),
    mandates: new Map([
      [ACTIVE_MANDATE, active],
      [DRAFT_MANDATE, draftWithExclusion],
    ]),
    activeMandateIds: [ACTIVE_MANDATE],
    disclosure: new Map([
      [COMPANY, true],
      [COMPANY_PRIVATE, false],
    ]),
    relationships: new Map(),
    investorOrganisations: new Map([[ORG_I, INVESTOR]]),
    founderPrivateMemory: [],
    founderConversationSummary: "The founders are optimistic.",
    privateDocumentText: "Confidential deck: churn is fine.",
    publicWebClaims: [],
    observedBrowsing: [],
    taxonomyVersions: { industry: 1 },
    ...overrides,
  };
}

/** Ports over the world. Note what they cannot reach. */
function ports(w: World): EligibilityPorts {
  return {
    companies: {
      findMany: (ids) =>
        Promise.resolve(
          ids.flatMap((id) => {
            const f = w.companies.get(id);
            return f === undefined ? [] : [f];
          }),
        ),
    },
    classifications: {
      listActive: (subjects) =>
        Promise.resolve(
          new Map(
            subjects.map(({ companyId }) => [
              companyId,
              w.classifications.get(companyId) ?? [],
            ]),
          ),
        ),
    },
    mandates: {
      activeMandate: ({ investorOrganisationId, mandateId }) => {
        if (mandateId !== null) {
          const pinned = w.mandates.get(mandateId);
          return Promise.resolve(
            pinned === undefined ||
              pinned.investorOrganisationId !== investorOrganisationId
              ? { kind: "NONE" }
              : { kind: "FOUND", mandate: pinned },
          );
        }
        const active = w.activeMandateIds
          .map((id) => w.mandates.get(id))
          .filter(
            (m): m is MandateSnapshotForEligibility =>
              m !== undefined &&
              m.status === "ACTIVE" &&
              m.investorOrganisationId === investorOrganisationId,
          );
        if (active.length === 0) return Promise.resolve({ kind: "NONE" });
        if (active.length > 1) return Promise.resolve({ kind: "AMBIGUOUS" });
        const [only] = active;
        return Promise.resolve(
          only === undefined
            ? { kind: "NONE" }
            : { kind: "FOUND", mandate: only },
        );
      },
    },
    investorSubject: {
      investorOrganisationFor: (actor) => {
        const id =
          actor.organisationId === undefined
            ? undefined
            : w.investorOrganisations.get(actor.organisationId);
        return Promise.resolve(
          id === undefined ? null : { investorOrganisationId: id },
        );
      },
    },
    discoverability: {
      permittedToView: (_actor, ids) =>
        Promise.resolve(
          new Map(ids.map((id) => [id, w.disclosure.get(id) === true])),
        ),
    },
    relationships: {
      standings: (_investor, ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [id, w.relationships.get(id) ?? { kind: "NONE" }]),
          ),
        ),
    },
    taxonomyVersions: {
      currentVersions: () => Promise.resolve(w.taxonomyVersions),
    },
  };
}

const FIXED = () => new Date("2026-09-18T12:00:00.000Z");

function service(w: World, logs: unknown[] = []) {
  const logger = {
    debug: (payload: unknown) => {
      logs.push(payload);
    },
  } as unknown as NonNullable<
    Parameters<typeof createEligibilityService>[0]["logger"]
  >;
  return createEligibilityService({ ports: ports(w), clock: FIXED, logger });
}

async function decisionFor(w: World, companyId = COMPANY) {
  const { results } = await service(w).evaluate({
    actor: ACTOR,
    companyIds: [companyId],
  });
  const [only] = results;
  if (only === undefined) throw new Error("no result");
  return only;
}

describe("eligibility service", () => {
  it("resolves the investor from the actor, uses the one ACTIVE mandate and stamps the context", async () => {
    const w = world();
    const { context, results } = await service(w).evaluate({
      actor: ACTOR,
      companyIds: [COMPANY, COMPANY_PRIVATE],
    });
    expect(context).toEqual({
      tenantId: TENANT_I,
      investorOrganisationId: INVESTOR,
      mode: "INVESTOR_DISCOVER",
      mandateId: ACTIVE_MANDATE,
      taxonomyVersion: { industry: 1 },
      eligibilityPolicyVersion: "eligibility.v1",
    });
    expect(results.map((r) => [r.companyId, r.decision])).toEqual([
      [COMPANY, "ELIGIBLE"],
      [COMPANY_PRIVATE, "INELIGIBLE"],
    ]);
    expect(results.every((r) => r.taxonomyVersion?.["industry"] === 1)).toBe(
      true,
    );
  });

  it("H. the DRAFT mandate's exclusion is never read; the ACTIVE one decides", async () => {
    // The company carries PAYMENTS, which the DRAFT excludes and the ACTIVE
    // mandate does not.
    const r = await decisionFor(world());
    expect(r.decision).toBe("ELIGIBLE");
    expect(r.mandateId).toBe(ACTIVE_MANDATE);

    // Pinning the DRAFT explicitly still cannot apply its exclusion.
    const pinnedDraft = await service(world()).evaluate({
      actor: ACTOR,
      mandateId: DRAFT_MANDATE,
      companyIds: [COMPANY],
    });
    expect(pinnedDraft.results[0]?.decision).toBe("UNDETERMINED");
    expect(pinnedDraft.results[0]?.reasonCodes).toEqual(["MANDATE_NOT_ACTIVE"]);
  });

  it("a stale ACTIVE-then-CLOSED history does not decide; two ACTIVE mandates are ambiguous", async () => {
    const none = world({ activeMandateIds: [] });
    expect((await decisionFor(none)).reasonCodes).toEqual([
      "NO_ACTIVE_MANDATE",
    ]);

    const two = world();
    two.mandates.set("33333333-0000-4000-8000-000000000039", {
      mandateId: "33333333-0000-4000-8000-000000000039",
      investorOrganisationId: INVESTOR,
      version: 1,
      status: "ACTIVE",
      constraints: [],
      taxonomyPreferences: [],
    });
    two.activeMandateIds.push("33333333-0000-4000-8000-000000000039");
    expect((await decisionFor(two)).reasonCodes).toEqual([
      "ACTIVE_MANDATE_AMBIGUOUS",
    ]);
  });

  it("a pinned mandate belonging to another investor resolves as absent, never applied", async () => {
    const w = world();
    w.mandates.set(FOREIGN_MANDATE, {
      mandateId: FOREIGN_MANDATE,
      investorOrganisationId: "99999999-0000-4000-8000-000000000099",
      version: 1,
      status: "ACTIVE",
      constraints: [],
      taxonomyPreferences: [
        {
          nodeId: PAYMENTS,
          vocabularyCode: "industry",
          preferenceStrength: "HARD_EXCLUSION",
          isExclusion: true,
          source: "user_selected",
        },
      ],
    });
    const { context, results } = await service(w).evaluate({
      actor: ACTOR,
      mandateId: FOREIGN_MANDATE,
      companyIds: [COMPANY],
    });
    expect(context.mandateId).toBeNull();
    expect(results[0]?.reasonCodes).toEqual(["NO_ACTIVE_MANDATE"]);
  });

  it("L. founder-private Q memory: add the marker, evaluate, remove it, evaluate — identical", async () => {
    const w = world();
    const before = await decisionFor(w);
    w.founderPrivateMemory.push(
      `${PRIVATE_MARKER}: the founder told Q the company is really a casino`,
    );
    const during = await decisionFor(w);
    w.founderPrivateMemory.length = 0;
    const after = await decisionFor(w);
    expect(during).toEqual(before);
    expect(after).toEqual(before);
    expect(JSON.stringify(during)).not.toContain(PRIVATE_MARKER);
  });

  it("founder-private conversation summary, raw document text and observed browsing: no effect", async () => {
    const w = world();
    const before = await decisionFor(w);
    w.founderConversationSummary =
      "The founder admitted the largest customer is leaving and revenue is fake.";
    w.privateDocumentText =
      "Board deck: we operate an unlicensed gambling app.";
    w.observedBrowsing.push("investor passed on this company five times");
    expect(await decisionFor(w)).toEqual(before);
  });

  it("N. a raw PUBLIC_WEB claim does not hard-exclude on its own; a canonical classification does", async () => {
    const w = world();
    const active = w.mandates.get(ACTIVE_MANDATE);
    if (active === undefined) throw new Error("fixture");
    w.mandates.set(ACTIVE_MANDATE, {
      ...active,
      taxonomyPreferences: [
        {
          nodeId: GAMBLING,
          vocabularyCode: "industry",
          preferenceStrength: "HARD_EXCLUSION",
          isExclusion: true,
          source: "user_selected",
        },
      ],
    });
    const before = await decisionFor(w);
    expect(before.decision).toBe("ELIGIBLE");

    w.publicWebClaims.push("Article: the company runs an online casino");
    expect(await decisionFor(w)).toEqual(before);

    // The legitimate path: the claim becomes a confirmed canonical
    // classification through the Taxonomy context's own workflow.
    w.classifications.set(COMPANY, [
      { nodeId: GAMBLING, vocabularyCode: "industry" },
    ]);
    const canonical = await decisionFor(w);
    expect(canonical.decision).toBe("INELIGIBLE");
    expect(canonical.reasonCodes).toEqual(["EXPLICIT_HARD_EXCLUSION"]);
  });

  it("changing an authorised canonical hard-eligibility field may legitimately change the answer", async () => {
    const w = world();
    expect((await decisionFor(w)).decision).toBe("ELIGIBLE");
    const facts = w.companies.get(COMPANY);
    if (facts === undefined) throw new Error("fixture");
    w.companies.set(COMPANY, {
      ...facts,
      marketplaceParticipation: "NOT_ELIGIBLE",
    });
    const r = await decisionFor(w);
    expect(r.decision).toBe("INELIGIBLE");
    expect(r.reasonCodes).toEqual(["COMPANY_NOT_MARKETPLACE_ELIGIBLE"]);
  });

  it("O. a company in another tenant is judged on canonical facts and disclosure; an unknown id is absent, not denied", async () => {
    const w = world();
    const { results } = await service(w).evaluate({
      actor: ACTOR,
      companyIds: [
        COMPANY_PRIVATE,
        "55555555-0000-4000-8000-000000000055",
        COMPANY_PRIVATE,
      ],
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe("INELIGIBLE");
    expect(results[0]?.reasonCodes).toEqual([
      "COMPANY_NOT_DISCOVERABLE_BY_INVESTOR",
    ]);
  });

  it("an actor whose organisation is not an investor cannot evaluate anything", async () => {
    await expect(
      service(world({ investorOrganisations: new Map() })).evaluate({
        actor: ACTOR,
        companyIds: [COMPANY],
      }),
    ).rejects.toBeInstanceOf(InvestorSubjectNotResolvedError);
  });

  it("only INVESTOR_DISCOVER is evaluated; GateQ and the other modes are refused, not approximated", async () => {
    for (const mode of [
      "GATEQ",
      "FOUNDER_DISCOVER",
      "SEARCH",
      "Q_RECOMMENDATION",
    ] as const) {
      await expect(
        service(world()).evaluate({
          actor: ACTOR,
          mode,
          companyIds: [COMPANY],
        }),
      ).rejects.toBeInstanceOf(RecommendationModeUnsupportedError);
    }
  });

  it("the batch is bounded and de-duplicated", async () => {
    const ids = Array.from(
      { length: ELIGIBILITY_BATCH_MAX + 1 },
      (_, i) => `66666666-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    await expect(
      service(world()).evaluate({ actor: ACTOR, companyIds: ids }),
    ).rejects.toBeInstanceOf(EligibilityBatchTooLargeError);
    const { results } = await service(world()).evaluate({
      actor: ACTOR,
      companyIds: [],
    });
    expect(results).toEqual([]);
  });

  it("P. repeat evaluation through the service is deterministic", async () => {
    const w = world();
    const first = await service(w).evaluate({
      actor: ACTOR,
      companyIds: [COMPANY, COMPANY_PRIVATE],
    });
    for (let i = 0; i < 10; i += 1) {
      expect(
        await service(w).evaluate({
          actor: ACTOR,
          companyIds: [COMPANY, COMPANY_PRIVATE],
        }),
      ).toEqual(first);
    }
  });

  it("diagnostics carry versions, counts and duration — never a company, a mandate value or a marker", async () => {
    const logs: unknown[] = [];
    const w = world();
    w.founderPrivateMemory.push(PRIVATE_MARKER);
    await service(w, logs).evaluate({
      actor: ACTOR,
      companyIds: [COMPANY, COMPANY_PRIVATE],
    });
    expect(logs).toHaveLength(1);
    const line = JSON.stringify(logs[0]);
    expect(logs[0]).toMatchObject({
      mode: "INVESTOR_DISCOVER",
      eligibilityPolicyVersion: "eligibility.v1",
      mandateVersion: 2,
      requested: 2,
      evaluated: 2,
      ELIGIBLE: 1,
      INELIGIBLE: 1,
      UNDETERMINED: 0,
    });
    expect(line).not.toContain(COMPANY);
    expect(line).not.toContain(PRIVATE_MARKER);
    expect(line).not.toContain("PAYMENTS");
  });
});
