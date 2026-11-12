import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CapitalObjectiveIdSchema,
  type CapitalObjectiveQueryPort,
} from "@capital-q/capital";
import {
  CompanyIdSchema,
  type CompanyIdentity,
  type CompanyQueryPort,
} from "@capital-q/companies";
import type { QSubjectRef } from "@capital-q/contracts";
import { DocumentIdSchema, type DocumentQueryPort } from "@capital-q/evidence";
import {
  InvestorOrganisationIdSchema,
  type InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import type { OrganisationQueryPort } from "@capital-q/organisations";
import {
  ActorContextSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createCapitalObjectiveQSubjectResolver,
  createCompanyQSubjectResolver,
  createDocumentQSubjectResolver,
  createInvestorOrganisationQSubjectResolver,
  createOrganisationQSubjectResolver,
  createQSubjectResolverRegistry,
  createSelfUserQSubjectResolver,
  type QSubjectViewPort,
} from "../src/index.js";

/**
 * Tenant isolation at the subject boundary, with a repository that forgot
 * its tenant predicate.
 *
 * Production server SQL runs as a role that bypasses RLS (ADR 0065), so a
 * repository read that drops `where tenant_id = $1` returns another
 * tenant's row and nothing in the database stops it. Every fake port here
 * is deliberately "leaky": it ignores the tenant argument and answers by id
 * alone. Each resolver must still refuse the foreign row, and refuse it as
 * null, the same answer as an id that does not exist. The disclosure path
 * (QSubjectViewPort) is the one sanctioned way across tenants.
 */

const TENANT_A = TenantIdSchema.parse(randomUUID());
const TENANT_B = TenantIdSchema.parse(randomUUID());
const ORG_A = OrganisationIdSchema.parse(randomUUID());
const ORG_B = OrganisationIdSchema.parse(randomUUID());

const actorA: ActorContext = ActorContextSchema.parse({
  userId: UserIdSchema.parse(randomUUID()),
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId: MembershipIdSchema.parse(randomUUID()),
  actorType: "HUMAN",
});

const COMPANY_A: CompanyIdentity = {
  id: CompanyIdSchema.parse(randomUUID()),
  tenantId: TENANT_A,
  organisationId: ORG_A,
  canonicalName: "Alpha (synthetic)",
  companyStatus: "active",
};
const COMPANY_B: CompanyIdentity = {
  id: CompanyIdSchema.parse(randomUUID()),
  tenantId: TENANT_B,
  organisationId: ORG_B,
  canonicalName: "Beta (synthetic)",
  companyStatus: "active",
};

/** Answers by id alone, whatever tenant it is asked for. */
function leakyCompanies(): CompanyQueryPort {
  const byId = new Map([COMPANY_A, COMPANY_B].map((c) => [c.id as string, c]));
  const find = (id: string) => Promise.resolve(byId.get(id) ?? null);
  return {
    getCanonicalCompany: (_tenantId, id) => find(id),
    findCanonicalCompany: (id) => find(id),
    findCanonicalCompanyVisibility: () => Promise.resolve(null),
    findCanonicalCompanyVisibilities: () => Promise.resolve([]),
    findCanonicalFounderProfile: () => Promise.resolve(null),
    findCanonicalCompanyProfile: () => Promise.resolve(null),
    searchCompanies: () => Promise.resolve({ items: [], nextCursor: null }),
  };
}

function recordingView(answer: boolean): QSubjectViewPort & {
  readonly asked: { actor: ActorContext; id: string }[];
} {
  const asked: { actor: ActorContext; id: string }[] = [];
  return {
    asked,
    canView: (actor, resource) => {
      asked.push({ actor, id: resource.id });
      return Promise.resolve(answer);
    },
  };
}

const companyRef = (id: string): QSubjectRef => ({
  kind: "COMPANY",
  companyId: id,
});

describe("COMPANY subject, leaky repository", () => {
  it("resolves the actor's own company (positive control)", async () => {
    const resolver = createCompanyQSubjectResolver(leakyCompanies());
    expect(await resolver.resolve(actorA, companyRef(COMPANY_A.id))).toEqual({
      ref: companyRef(COMPANY_A.id),
      tenantId: TENANT_A,
      organisationId: ORG_A,
    });
  });

  it("refuses tenant B's company even when the tenant-scoped read returns it", async () => {
    const resolver = createCompanyQSubjectResolver(leakyCompanies());
    expect(await resolver.resolve(actorA, companyRef(COMPANY_B.id))).toBeNull();
  });

  it("answers a foreign id and an unknown id identically", async () => {
    const resolver = createCompanyQSubjectResolver(leakyCompanies());
    const foreign = await resolver.resolve(actorA, companyRef(COMPANY_B.id));
    const unknown = await resolver.resolve(actorA, companyRef(randomUUID()));
    expect(foreign).toStrictEqual(unknown);
  });

  it("does not let a leaked row skip the disclosure decision", async () => {
    const view = recordingView(false);
    const resolver = createCompanyQSubjectResolver(leakyCompanies(), view);
    expect(await resolver.resolve(actorA, companyRef(COMPANY_B.id))).toBeNull();
  });

  it("crosses tenants only when disclosure says this actor may view it", async () => {
    const companies = leakyCompanies();
    const honest: CompanyQueryPort = {
      ...companies,
      getCanonicalCompany: (tenantId, id) =>
        companies
          .getCanonicalCompany(tenantId, id)
          .then((c) => (c !== null && c.tenantId === tenantId ? c : null)),
    };
    const view = recordingView(true);
    const resolved = await createCompanyQSubjectResolver(honest, view).resolve(
      actorA,
      companyRef(COMPANY_B.id),
    );
    expect(resolved?.tenantId).toBe(TENANT_B);
    expect(view.asked).toEqual([{ actor: actorA, id: COMPANY_B.id }]);
  });
});

describe("INVESTOR_ORGANISATION subject, leaky repository", () => {
  const INVESTOR_B = {
    id: InvestorOrganisationIdSchema.parse(randomUUID()),
    tenantId: TENANT_B,
    organisationId: ORG_B,
    investorType: "VC" as const,
    displayName: "Investor B (synthetic)",
    deploymentState: null,
  };
  const investors: InvestorOrganisationQueryPort = {
    getCanonicalInvestorOrganisation: (_tenantId, id) =>
      Promise.resolve(id === INVESTOR_B.id ? INVESTOR_B : null),
    findCanonicalInvestorOrganisation: (id) =>
      Promise.resolve(id === INVESTOR_B.id ? INVESTOR_B : null),
  };
  const ref: QSubjectRef = {
    kind: "INVESTOR_ORGANISATION",
    investorOrganisationId: INVESTOR_B.id,
  };

  it("refuses tenant B's investor without a disclosure port", async () => {
    expect(
      await createInvestorOrganisationQSubjectResolver(investors).resolve(
        actorA,
        ref,
      ),
    ).toBeNull();
  });

  it("refuses tenant B's investor when disclosure says no", async () => {
    expect(
      await createInvestorOrganisationQSubjectResolver(
        investors,
        recordingView(false),
      ).resolve(actorA, ref),
    ).toBeNull();
  });
});

describe("ORGANISATION subject, leaky repository", () => {
  const organisations: OrganisationQueryPort = {
    getActiveOrganisationIdentity: (_tenantId, id) =>
      Promise.resolve(
        id === ORG_B
          ? {
              id: ORG_B,
              tenantId: TENANT_B,
              organisationType: "investment_firm",
              displayName: "Org B (synthetic)",
              websiteUrl: null,
              countryCode: null,
              status: "active",
            }
          : null,
      ),
  };

  it("refuses an organisation that lives in tenant B", async () => {
    expect(
      await createOrganisationQSubjectResolver(organisations).resolve(actorA, {
        kind: "ORGANISATION",
        organisationId: ORG_B,
      }),
    ).toBeNull();
  });
});

describe("CAPITAL_OBJECTIVE subject (tenant-agnostic lookup by design)", () => {
  const OBJECTIVE_B = CapitalObjectiveIdSchema.parse(randomUUID());
  const capital: CapitalObjectiveQueryPort = {
    findCanonicalCapitalObjective: (id) =>
      Promise.resolve(
        id === OBJECTIVE_B
          ? {
              id: OBJECTIVE_B,
              tenantId: TENANT_B,
              companyId: COMPANY_B.id,
              status: "ACTIVE",
            }
          : null,
      ),
    getCurrentForCompany: () => Promise.resolve(null),
    getById: () => Promise.resolve(null),
  };

  it("refuses tenant B's objective although the lookup takes no tenant", async () => {
    expect(
      await createCapitalObjectiveQSubjectResolver(capital).resolve(actorA, {
        kind: "CAPITAL_OBJECTIVE",
        capitalObjectiveId: OBJECTIVE_B,
      }),
    ).toBeNull();
  });
});

describe("DOCUMENT subject, leaky repository", () => {
  const DOCUMENT_B = DocumentIdSchema.parse(randomUUID());
  const documents: DocumentQueryPort = {
    findCanonicalDocument: (_tenantId, id) =>
      Promise.resolve(
        id === DOCUMENT_B
          ? {
              id: DOCUMENT_B,
              tenantId: TENANT_B,
              ownerOrganisationId: ORG_B,
              companyId: COMPANY_B.id,
              visibilityScope: "founder_private",
              sensitivityClass: "INTERNAL",
              currentVersionId: null,
              status: "ACTIVE",
            }
          : null,
      ),
  };

  it("refuses tenant B's document, founder_private or not", async () => {
    expect(
      await createDocumentQSubjectResolver(documents).resolve(actorA, {
        kind: "DOCUMENT",
        documentId: DOCUMENT_B,
      }),
    ).toBeNull();
  });
});

describe("USER subject and the registry", () => {
  it("resolves only the actor themself", async () => {
    const resolver = createSelfUserQSubjectResolver();
    expect(
      await resolver.resolve(actorA, { kind: "USER", userId: randomUUID() }),
    ).toBeNull();
    expect(
      (await resolver.resolve(actorA, { kind: "USER", userId: actorA.userId }))
        ?.tenantId,
    ).toBe(TENANT_A);
  });

  it("returns null for a foreign subject through the composed registry", async () => {
    const registry = createQSubjectResolverRegistry([
      createCompanyQSubjectResolver(leakyCompanies()),
      createSelfUserQSubjectResolver(),
    ]);
    expect(await registry.resolve(actorA, companyRef(COMPANY_B.id))).toBeNull();
    expect(
      await registry.resolve(actorA, companyRef(COMPANY_A.id)),
    ).not.toBeNull();
  });
});
