import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_READINESS_REQUIREMENTS,
  MarketplaceReadinessAssessmentSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import type { ActorContext, AuthorizationService } from "@capital-q/security";

import type { CompanyServiceDependencies } from "../src/application/dependencies.js";
import {
  createAssessMarketplaceReadiness,
  createGetMarketplaceReadiness,
} from "../src/application/marketplace-readiness.js";
import type {
  CompanyRepository,
  VerificationClaimsPort,
} from "../src/application/ports.js";
import { createSetCompanyVisibility } from "../src/application/set-company-visibility.js";
import type { Company } from "../src/contracts/index.js";
import { CompanyNotFoundError } from "../src/domain/errors.js";
import { marketplaceParticipationOf } from "../src/domain/marketplace-participation.js";
import {
  describeRequirement,
  evaluateMarketplaceReadiness,
  MARKETPLACE_READINESS_POLICY_VERSION,
  type MarketplaceReadinessSnapshot,
} from "../src/domain/marketplace-readiness.js";
import {
  createSyntheticVerificationClaimsPort,
  SyntheticVerificationRefusedError,
} from "../src/dev/synthetic-verification.js";
import { createUnavailableVerificationClaimsPort } from "../src/infrastructure/unavailable-verification-claims.js";

/**
 * Marketplace readiness (CQ-MKT-001). The policy over snapshots, the two
 * use cases over fakes, and the synthetic seam's guard. The fake world
 * carries the things the packet says must not matter — a completed
 * onboarding, a READY pitch, Q memory, public-web findings, uploaded
 * documents — and the policy input has no field for any of them.
 */

const TENANT = "11111111-0000-4000-8000-000000000011";
const ORG = "11111111-0000-4000-8000-000000000012";
const COMPANY = "22222222-0000-4000-8000-000000000023";
const OTHER_TENANT = "99999999-0000-4000-8000-000000000099";
const PRIVATE_MARKER = "MKT_PRIVATE_FOUNDER_MEMORY_MUST_NOT_SATISFY_READINESS";
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const FOUNDER = {
  userId: "11111111-0000-4000-8000-000000000014",
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "11111111-0000-4000-8000-000000000015",
  actorType: "HUMAN",
} as unknown as ActorContext;

function snapshot(
  overrides: Partial<MarketplaceReadinessSnapshot> = {},
): MarketplaceReadinessSnapshot {
  return {
    companyId: COMPANY,
    companyStatus: "active",
    canonicalName: "Alpha Rails",
    shortDescription: "Rails for payments.",
    primaryDescription: null,
    currentStageCode: "seed",
    headquartersCountry: "NG",
    marketplaceVisibility: "network_visible",
    verification: {
      available: true,
      founderIdentity: "VERIFIED",
      organisationIdentity: "VERIFIED",
    },
    ...overrides,
  };
}

const outcome = (
  evaluation: ReturnType<typeof evaluateMarketplaceReadiness>,
  requirement: (typeof MARKETPLACE_READINESS_REQUIREMENTS)[number],
) =>
  evaluation.requirements.find((r) => r.requirement === requirement)?.outcome;

describe("marketplace readiness policy v1", () => {
  it("every requirement met (documentation not applicable) → marketplace_ready, version recorded", () => {
    const e = evaluateMarketplaceReadiness(snapshot());
    expect(e.state).toBe("marketplace_ready");
    expect(e.policyVersion).toBe(MARKETPLACE_READINESS_POLICY_VERSION);
    expect(e.requirements.map((r) => r.requirement)).toEqual([
      ...MARKETPLACE_READINESS_REQUIREMENTS,
    ]);
    expect(outcome(e, "REQUIRED_DOCUMENTATION")).toBe("NOT_APPLICABLE");
    expect(marketplaceParticipationOf(e.state)).toBe("ELIGIBLE");
  });

  it("network visibility alone does not make a company ready", () => {
    const e = evaluateMarketplaceReadiness(
      snapshot({
        verification: {
          available: true,
          founderIdentity: "NOT_VERIFIED",
          organisationIdentity: "NOT_VERIFIED",
        },
      }),
    );
    expect(e.state).toBe("requirements_outstanding");
    expect(outcome(e, "DISCOVERY_VISIBILITY_CONFIRMED")).toBe("SATISFIED");
    expect(outcome(e, "FOUNDER_IDENTITY_VERIFIED")).toBe("OUTSTANDING");
    expect(marketplaceParticipationOf(e.state)).toBe("NOT_ELIGIBLE");
  });

  it("verification alone does not make a company ready: the founder's visibility choice is required and never made here", () => {
    const e = evaluateMarketplaceReadiness(
      snapshot({ marketplaceVisibility: "organisation_private" }),
    );
    expect(e.state).toBe("requirements_outstanding");
    expect(outcome(e, "DISCOVERY_VISIBILITY_CONFIRMED")).toBe("OUTSTANDING");
  });

  it("a thin profile is outstanding: no description, no stage or no country", () => {
    expect(
      evaluateMarketplaceReadiness(
        snapshot({ shortDescription: null, primaryDescription: null }),
      ).state,
    ).toBe("requirements_outstanding");
    expect(
      evaluateMarketplaceReadiness(snapshot({ currentStageCode: null })).state,
    ).toBe("requirements_outstanding");
    expect(
      evaluateMarketplaceReadiness(snapshot({ headquartersCountry: "  " }))
        .state,
    ).toBe("requirements_outstanding");
    expect(
      evaluateMarketplaceReadiness(
        snapshot({ shortDescription: null, primaryDescription: "Long form." }),
      ).state,
    ).toBe("marketplace_ready");
  });

  it("a closed company is outstanding", () => {
    expect(
      evaluateMarketplaceReadiness(snapshot({ companyStatus: "closed" })).state,
    ).toBe("requirements_outstanding");
  });

  it("revoked or expired verification removes readiness", () => {
    for (const standing of ["REVOKED", "EXPIRED", "NOT_VERIFIED"] as const) {
      const e = evaluateMarketplaceReadiness(
        snapshot({
          verification: {
            available: true,
            founderIdentity: "VERIFIED",
            organisationIdentity: standing,
          },
        }),
      );
      expect(e.state, standing).toBe("requirements_outstanding");
      expect(outcome(e, "ORGANISATION_VERIFIED")).toBe("OUTSTANDING");
    }
  });

  it("when verification is unavailable the two verification requirements are outstanding and the wording says so", () => {
    const e = evaluateMarketplaceReadiness(
      snapshot({
        verification: {
          available: false,
          founderIdentity: "NOT_VERIFIED",
          organisationIdentity: "NOT_VERIFIED",
        },
      }),
    );
    expect(e.state).toBe("requirements_outstanding");
    expect(e.verificationAvailable).toBe(false);
    const founder = e.requirements.find(
      (r) => r.requirement === "FOUNDER_IDENTITY_VERIFIED",
    );
    expect(founder?.description).toContain("not yet available on Capital Q");
    expect(founder?.description).not.toMatch(/verified\b\.?$/i);
  });

  it("same snapshot, same assessment; descriptions never name a code or private content", () => {
    const first = evaluateMarketplaceReadiness(snapshot());
    for (let i = 0; i < 10; i += 1) {
      expect(evaluateMarketplaceReadiness(snapshot())).toEqual(first);
    }
    for (const requirement of MARKETPLACE_READINESS_REQUIREMENTS) {
      for (const o of ["SATISFIED", "OUTSTANDING"] as const) {
        for (const available of [true, false]) {
          const text = describeRequirement(requirement, o, available);
          expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
          expect(text).not.toContain(PRIVATE_MARKER);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Use cases over fakes
// ---------------------------------------------------------------------------

type World = {
  company: Company;
  verification: VerificationClaimsPort;
  denyCapabilities: boolean;
  audits: unknown[];
  events: unknown[];
  // Never read by the policy; present to prove it.
  onboardingCompleted: boolean;
  pitchStatus: "READY" | "NONE";
  founderMemory: string[];
  publicWebFindings: string[];
  uploadedDocuments: string[];
  qInference: string | null;
};

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: COMPANY as Company["id"],
    tenantId: TENANT as Company["tenantId"],
    organisationId: ORG as Company["organisationId"],
    canonicalName: "Alpha Rails",
    legalName: null,
    slug: "alpha-rails",
    websiteUrl: null,
    foundedDate: null,
    headquartersCountry: "NG",
    headquartersCity: null,
    currentStageCode: "seed",
    primaryDescription: null,
    shortDescription: "Rails for payments.",
    companyStatus: "active",
    marketplaceVisibility: "network_visible",
    marketplaceReadinessState: "not_assessed",
    logoStorageKey: null,
    version: 1,
    createdAt: "2026-09-18T09:00:00.000Z",
    updatedAt: "2026-09-18T09:00:00.000Z",
    ...overrides,
  };
}

function world(overrides: Partial<World> = {}): World {
  return {
    company: company(),
    verification: createUnavailableVerificationClaimsPort(),
    denyCapabilities: false,
    audits: [],
    events: [],
    onboardingCompleted: true,
    pitchStatus: "READY",
    founderMemory: [],
    publicWebFindings: [],
    uploadedDocuments: [],
    qInference: null,
    ...overrides,
  };
}

function dependencies(w: World): CompanyServiceDependencies {
  const owned = (tenantId: string, organisationId: string, id: string) =>
    w.company.tenantId === tenantId &&
    w.company.organisationId === organisationId &&
    w.company.id === id
      ? w.company
      : null;
  const tx = { sql: {} } as unknown as Parameters<
    CompanyServiceDependencies["transactions"]["run"]
  >[0] extends (tx: infer T) => unknown
    ? T
    : never;
  const companies: Pick<
    CompanyRepository,
    "findById" | "lockById" | "updateReadiness" | "updateVisibility"
  > = {
    findById: (_e, t, o, id) => Promise.resolve(owned(t, o, id)),
    lockById: (_tx, t, o, id) => Promise.resolve(owned(t, o, id)),
    updateReadiness: (_tx, input) => {
      if (w.company.version !== input.expectedVersion) {
        return Promise.resolve(null);
      }
      w.company = {
        ...w.company,
        marketplaceReadinessState: input.readinessState,
        version: w.company.version + 1,
      };
      return Promise.resolve(w.company);
    },
    updateVisibility: (_tx, input) => {
      w.company = {
        ...w.company,
        marketplaceVisibility: input.visibility,
        version: w.company.version + 1,
      };
      return Promise.resolve(w.company);
    },
  };
  return {
    sql: {} as CompanyServiceDependencies["sql"],
    transactions: { run: (work) => work(tx) },
    authorization: {
      requireCapability: () =>
        w.denyCapabilities
          ? Promise.reject(new Error("FORBIDDEN"))
          : Promise.resolve(),
    } as unknown as AuthorizationService,
    organisations: {} as CompanyServiceDependencies["organisations"],
    outbox: {
      enqueue: (_tx: unknown, event: unknown) => {
        w.events.push(event);
        return Promise.resolve();
      },
    } as unknown as CompanyServiceDependencies["outbox"],
    audit: {
      record: (_tx: unknown, entry: unknown) => {
        w.audits.push(entry);
        return Promise.resolve();
      },
    } as unknown as CompanyServiceDependencies["audit"],
    verification: w.verification,
    repositories: {
      companies:
        companies as unknown as CompanyServiceDependencies["repositories"]["companies"],
      creationRequests:
        {} as CompanyServiceDependencies["repositories"]["creationRequests"],
      members: {} as CompanyServiceDependencies["repositories"]["members"],
      founderProfiles:
        {} as CompanyServiceDependencies["repositories"]["founderProfiles"],
      teamFacts: {} as CompanyServiceDependencies["repositories"]["teamFacts"],
    },
  };
}

const CORRELATION = "cor_11111111-1111-4111-8111-111111111111" as CorrelationId;

function synthetic(verified: readonly string[] = [COMPANY]) {
  return createSyntheticVerificationClaimsPort({
    environment: "test",
    databaseUrl: LOCAL_DB,
    verifiedCompanyIds: verified,
  });
}

describe("marketplace readiness use cases", () => {
  it("a new company starts not_assessed and a read never writes", async () => {
    const w = world();
    const get = createGetMarketplaceReadiness(dependencies(w));
    const assessment = await get({ actor: FOUNDER, companyId: w.company.id });
    expect(assessment.state).toBe("requirements_outstanding");
    expect(w.company.marketplaceReadinessState).toBe("not_assessed");
    expect(w.audits).toHaveLength(0);
    expect(w.events).toHaveLength(0);
    expect(MarketplaceReadinessAssessmentSchema.parse(assessment)).toEqual(
      assessment,
    );
  });

  it("in production no verification exists, so assessment moves not_assessed → requirements_outstanding, audited and published", async () => {
    const w = world();
    const assess = createAssessMarketplaceReadiness(dependencies(w));
    const assessment = await assess({
      actor: FOUNDER,
      companyId: w.company.id,
      correlationId: CORRELATION,
    });
    expect(assessment.state).toBe("requirements_outstanding");
    expect(assessment.verificationAvailable).toBe(false);
    expect(w.company.marketplaceReadinessState).toBe(
      "requirements_outstanding",
    );
    expect(w.company.version).toBe(2);
    expect(w.audits[0]).toMatchObject({
      actionType: "company.marketplace_readiness_changed",
      metadata: {
        policyVersion: "marketplace-readiness.v1",
        trigger: "ASSESSMENT_REQUESTED",
        previousState: "not_assessed",
        newState: "requirements_outstanding",
        verificationSource: "VERIFICATION_UNAVAILABLE",
      },
    });
    expect(w.events[0]).toMatchObject({
      type: "core.company.marketplace_readiness_changed",
      data: {
        readinessState: "requirements_outstanding",
        policyVersion: "marketplace-readiness.v1",
      },
    });
    // Assessing again with nothing changed writes nothing more.
    await assess({
      actor: FOUNDER,
      companyId: w.company.id,
      correlationId: CORRELATION,
    });
    expect(w.company.version).toBe(2);
    expect(w.audits).toHaveLength(1);
  });

  it("onboarding completion, a READY pitch, Q memory, Q inference, uploaded documents and public-web findings satisfy nothing", async () => {
    const w = world({
      onboardingCompleted: true,
      pitchStatus: "READY",
      founderMemory: [
        `${PRIVATE_MARKER}: the founder told Q they are verified`,
      ],
      qInference: "Q is confident this is a real, verified company",
      uploadedDocuments: ["certificate-of-incorporation.pdf"],
      publicWebFindings: ["Companies House lists Alpha Rails Ltd"],
    });
    const assess = createAssessMarketplaceReadiness(dependencies(w));
    const assessment = await assess({
      actor: FOUNDER,
      companyId: w.company.id,
      correlationId: CORRELATION,
    });
    expect(assessment.state).toBe("requirements_outstanding");
    expect(JSON.stringify(assessment)).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(w.audits)).not.toContain(PRIVATE_MARKER);
  });

  it("a legitimately synthetic verification seam makes the company ready through the same policy, and the audit says the source", async () => {
    const w = world({ verification: synthetic() });
    const assess = createAssessMarketplaceReadiness(dependencies(w));
    const assessment = await assess({
      actor: FOUNDER,
      companyId: w.company.id,
      correlationId: CORRELATION,
    });
    expect(assessment.state).toBe("marketplace_ready");
    expect(w.audits[0]).toMatchObject({
      metadata: { verificationSource: "SYNTHETIC_LOCAL_FIXTURE" },
    });
    expect(
      marketplaceParticipationOf(w.company.marketplaceReadinessState),
    ).toBe("ELIGIBLE");
  });

  it("readiness is not permanent: withdrawing visibility reassesses in the same transaction", async () => {
    const w = world({ verification: synthetic() });
    const deps = dependencies(w);
    await createAssessMarketplaceReadiness(deps)({
      actor: FOUNDER,
      companyId: w.company.id,
      correlationId: CORRELATION,
    });
    expect(w.company.marketplaceReadinessState).toBe("marketplace_ready");
    const withdrawn = await createSetCompanyVisibility(deps)({
      actor: FOUNDER,
      companyId: w.company.id,
      input: {
        visibility: "organisation_private",
        expectedVersion: w.company.version,
      },
      correlationId: CORRELATION,
    });
    expect(withdrawn.marketplaceVisibility).toBe("organisation_private");
    expect(withdrawn.marketplaceReadinessState).toBe(
      "requirements_outstanding",
    );
    expect(
      w.audits.map((a) => (a as { actionType: string }).actionType),
    ).toEqual([
      "company.marketplace_readiness_changed",
      "company.visibility_changed",
      "company.marketplace_readiness_changed",
    ]);
    expect(w.audits[2]).toMatchObject({
      metadata: {
        trigger: "VISIBILITY_WITHDRAWN",
        newState: "requirements_outstanding",
      },
    });
  });

  it("publishing never makes a company ready by itself", async () => {
    const w = world({
      verification: synthetic(),
      company: company({ marketplaceVisibility: "organisation_private" }),
    });
    await createSetCompanyVisibility(dependencies(w))({
      actor: FOUNDER,
      companyId: w.company.id,
      input: { visibility: "network_visible", expectedVersion: 1 },
      correlationId: CORRELATION,
    });
    expect(w.company.marketplaceVisibility).toBe("network_visible");
    expect(w.company.marketplaceReadinessState).toBe("not_assessed");
  });

  it("revoked verification is picked up on the next assessment and removes readiness", async () => {
    const port = {
      standing: "VERIFIED" as "VERIFIED" | "REVOKED",
    };
    const w = world({
      verification: {
        sourceLabel: "VERIFICATION_TEST",
        currentStandings: () =>
          Promise.resolve({
            available: true,
            founderIdentity: port.standing,
            organisationIdentity: "VERIFIED",
          }),
      },
    });
    const assess = createAssessMarketplaceReadiness(dependencies(w));
    await assess({
      actor: FOUNDER,
      companyId: w.company.id,
      correlationId: CORRELATION,
    });
    expect(w.company.marketplaceReadinessState).toBe("marketplace_ready");
    port.standing = "REVOKED";
    const after = await assess({
      actor: FOUNDER,
      companyId: w.company.id,
      correlationId: CORRELATION,
    });
    expect(after.state).toBe("requirements_outstanding");
    expect(w.company.marketplaceReadinessState).toBe(
      "requirements_outstanding",
    );
  });

  it("a founder without company.edit cannot assess; nobody can pass a desired state", async () => {
    const w = world({ verification: synthetic(), denyCapabilities: true });
    await expect(
      createAssessMarketplaceReadiness(dependencies(w))({
        actor: FOUNDER,
        companyId: w.company.id,
        correlationId: CORRELATION,
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(w.company.marketplaceReadinessState).toBe("not_assessed");
    // The command type has no state field; this is a compile-time fact,
    // restated at runtime for the record.
    const command = {
      actor: FOUNDER,
      companyId: w.company.id,
      correlationId: CORRELATION,
    };
    expect(Object.keys(command)).toEqual([
      "actor",
      "companyId",
      "correlationId",
    ]);
  });

  it("an investor in another tenant, or anyone naming a foreign company, gets the same 404 as a missing one", async () => {
    const w = world({ verification: synthetic() });
    const investor = { ...FOUNDER, tenantId: OTHER_TENANT } as ActorContext;
    await expect(
      createAssessMarketplaceReadiness(dependencies(w))({
        actor: investor,
        companyId: w.company.id,
        correlationId: CORRELATION,
      }),
    ).rejects.toBeInstanceOf(CompanyNotFoundError);
    await expect(
      createGetMarketplaceReadiness(dependencies(w))({
        actor: investor,
        companyId: w.company.id,
      }),
    ).rejects.toBeInstanceOf(CompanyNotFoundError);
    expect(w.company.marketplaceReadinessState).toBe("not_assessed");
  });
});

describe("synthetic verification seam guard", () => {
  it("refuses any environment but local/test and any non-loopback database", () => {
    expect(() =>
      createSyntheticVerificationClaimsPort({
        environment: "production",
        databaseUrl: LOCAL_DB,
        verifiedCompanyIds: [COMPANY],
      }),
    ).toThrow(SyntheticVerificationRefusedError);
    expect(() =>
      createSyntheticVerificationClaimsPort({
        environment: "local",
        databaseUrl:
          "postgresql://postgres@db.vcohxiqsmnkzxnvawgri.supabase.co:5432/postgres",
        verifiedCompanyIds: [COMPANY],
      }),
    ).toThrow(SyntheticVerificationRefusedError);
    expect(() =>
      createSyntheticVerificationClaimsPort({
        environment: undefined,
        databaseUrl: LOCAL_DB,
        verifiedCompanyIds: [COMPANY],
      }),
    ).toThrow(SyntheticVerificationRefusedError);
  });

  it("answers VERIFIED only for the companies it was told about", async () => {
    const port = synthetic([COMPANY]);
    const subject = {
      tenantId: TENANT as never,
      organisationId: ORG as never,
      companyId: COMPANY as never,
    };
    expect((await port.currentStandings(subject)).founderIdentity).toBe(
      "VERIFIED",
    );
    expect(
      (
        await port.currentStandings({
          ...subject,
          companyId: "33333333-0000-4000-8000-000000000033" as never,
        })
      ).founderIdentity,
    ).toBe("NOT_VERIFIED");
    expect(port.sourceLabel).toBe("SYNTHETIC_LOCAL_FIXTURE");
  });

  it("the production seam is unavailable and cannot be talked into VERIFIED", async () => {
    const port = createUnavailableVerificationClaimsPort();
    const facts = await port.currentStandings({
      tenantId: TENANT as never,
      organisationId: ORG as never,
      companyId: COMPANY as never,
    });
    expect(facts).toEqual({
      available: false,
      founderIdentity: "NOT_VERIFIED",
      organisationIdentity: "NOT_VERIFIED",
    });
    expect(port.sourceLabel).toBe("VERIFICATION_UNAVAILABLE");
  });
});
