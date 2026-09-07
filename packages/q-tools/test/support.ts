import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type {
  CompanyProfileFacts,
  CompanyQueryPort,
  CompanySearchCandidate,
} from "@capital-q/companies";
import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
  type QAuthorisedKnowledgeScope,
  type QSensitivityClass,
  type QSubjectRef,
  type QTaskClass,
} from "@capital-q/contracts";
import type {
  InvestorMandateQueryPort,
  InvestorMandateSnapshot,
  InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import type {
  DisclosureAccessService,
  DisclosureDecision,
} from "@capital-q/permissions";
import type { QToolExecutionContext } from "@capital-q/q-runtime";
import {
  ActorContextSchema,
  type ActorContext,
  type AuthorizationDecision,
  type AuthorizationService,
} from "@capital-q/security";

import { defineQTool, type QToolPorts } from "../src/index.js";

/**
 * Deterministic fakes for the q-tools unit suite: in-memory query ports,
 * a scripted authorization service and a scripted disclosure service.
 * No SQL, no model. Markers that must never leak sit in the fake data.
 */

export const MARKERS = {
  founder: "FOUNDER-PRIVATE-GET-COMPANY-DO-NOT-LEAK",
  investor: "INVESTOR-PRIVATE-MANDATE-DO-NOT-LEAK",
  crossTenant: "TOOL-CROSS-TENANT-DO-NOT-LEAK",
  internal: "TOOL-INTERNAL-ERROR-DO-NOT-LEAK",
} as const;

export const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ORG_A = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
export const USER_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
export const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ORG_B = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
export const USER_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
export const COMPANY_A = "c0000000-0000-4000-8000-000000000001";
export const COMPANY_B_PRIVATE = "c0000000-0000-4000-8000-000000000002";
export const COMPANY_B_NETWORK = "c0000000-0000-4000-8000-000000000003";
export const INVESTOR_B = "d0000000-0000-4000-8000-000000000001";
export const OBJECTIVE_A = "e0000000-0000-4000-8000-000000000001";
export const MANDATE_B = "f0000000-0000-4000-8000-000000000001";
export const RUN = "90000000-0000-4000-8000-000000000001";

export const actorA: ActorContext = ActorContextSchema.parse({
  userId: USER_A,
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId: randomUUID(),
  actorType: "HUMAN",
});

export const actorB: ActorContext = ActorContextSchema.parse({
  userId: USER_B,
  tenantId: TENANT_B,
  organisationId: ORG_B,
  membershipId: randomUUID(),
  actorType: "HUMAN",
});

function profile(
  overrides: Partial<CompanyProfileFacts> &
    Pick<CompanyProfileFacts, "id" | "tenantId" | "organisationId">,
): CompanyProfileFacts {
  return {
    canonicalName: "Company",
    legalName: null,
    websiteUrl: null,
    foundedDate: null,
    headquartersCountry: "GB",
    headquartersCity: null,
    currentStageCode: "seed",
    primaryDescription: null,
    shortDescription: null,
    companyStatus: "active",
    marketplaceVisibility: "organisation_private",
    ...overrides,
  };
}

export const PROFILES: readonly CompanyProfileFacts[] = [
  profile({
    id: COMPANY_A as CompanyProfileFacts["id"],
    tenantId: TENANT_A as CompanyProfileFacts["tenantId"],
    organisationId: ORG_A as CompanyProfileFacts["organisationId"],
    canonicalName: "Alpha Robotics",
    primaryDescription: `Alpha builds robots. ${MARKERS.founder}`,
  }),
  profile({
    id: COMPANY_B_PRIVATE as CompanyProfileFacts["id"],
    tenantId: TENANT_B as CompanyProfileFacts["tenantId"],
    organisationId: ORG_B as CompanyProfileFacts["organisationId"],
    canonicalName: "Hidden Ltd",
    primaryDescription: `Private. ${MARKERS.crossTenant}`,
  }),
  profile({
    id: COMPANY_B_NETWORK as CompanyProfileFacts["id"],
    tenantId: TENANT_B as CompanyProfileFacts["tenantId"],
    organisationId: ORG_B as CompanyProfileFacts["organisationId"],
    canonicalName: "Beacon Analytics",
    marketplaceVisibility: "network_visible",
    shortDescription: "Network-visible analytics company (synthetic).",
  }),
];

export function fakeCompanies(
  options: { readonly searchThrows?: Error | undefined } = {},
): CompanyQueryPort {
  const byId = new Map(PROFILES.map((p) => [p.id as string, p]));
  return {
    getCanonicalCompany: (tenantId, id) => {
      const p = byId.get(id);
      return Promise.resolve(
        p === undefined || p.tenantId !== tenantId ? null : identity(p),
      );
    },
    findCanonicalCompany: (id) => {
      const p = byId.get(id);
      return Promise.resolve(p === undefined ? null : identity(p));
    },
    findCanonicalCompanyVisibility: (id) => {
      const p = byId.get(id);
      return Promise.resolve(
        p === undefined
          ? null
          : {
              id: p.id,
              tenantId: p.tenantId,
              organisationId: p.organisationId,
              marketplaceVisibility: p.marketplaceVisibility,
            },
      );
    },
    findCanonicalFounderProfile: () => Promise.resolve(null),
    findCanonicalCompanyProfile: (id) => Promise.resolve(byId.get(id) ?? null),
    searchCompanies: (query) => {
      if (options.searchThrows !== undefined) {
        throw options.searchThrows;
      }
      const items: CompanySearchCandidate[] = PROFILES.filter(
        (p) =>
          (p.marketplaceVisibility === "network_visible" ||
            p.marketplaceVisibility === "public_external" ||
            (query.viewer.organisationId !== undefined &&
              p.organisationId === query.viewer.organisationId)) &&
          (query.text === undefined ||
            p.canonicalName.toLowerCase().includes(query.text.toLowerCase())),
      ).map((p) => ({
        id: p.id,
        tenantId: p.tenantId,
        organisationId: p.organisationId,
        canonicalName: p.canonicalName,
        currentStageCode: p.currentStageCode,
        headquartersCountry: p.headquartersCountry,
        shortDescription: p.shortDescription,
        marketplaceVisibility: p.marketplaceVisibility,
        ownedByViewer: p.organisationId === query.viewer.organisationId,
      }));
      return Promise.resolve({ items, nextCursor: null });
    },
  };
}

function identity(p: CompanyProfileFacts) {
  return {
    id: p.id,
    tenantId: p.tenantId,
    organisationId: p.organisationId,
    canonicalName: p.canonicalName,
    companyStatus: p.companyStatus,
  };
}

export function fakeCapital(): CapitalObjectiveQueryPort {
  const snapshot = {
    id: OBJECTIVE_A,
    tenantId: TENANT_A,
    companyId: COMPANY_A,
    objectiveType: "RAISE",
    status: "ACTIVE",
    target: { amount: "2000000", currency: "GBP" },
    targetStage: "seed",
    instrumentCode: "safe",
    targetCloseDate: null,
    startedAt: "2026-09-01T00:00:00.000Z",
    closedAt: null,
    version: 1,
  } as unknown as Awaited<
    ReturnType<CapitalObjectiveQueryPort["getCurrentForCompany"]>
  >;
  return {
    findCanonicalCapitalObjective: () => Promise.resolve(null),
    getCurrentForCompany: (tenantId, companyId) =>
      Promise.resolve(
        tenantId === TENANT_A && companyId === COMPANY_A ? snapshot : null,
      ),
    getById: () => Promise.resolve(null),
  };
}

export function fakeInvestors(): InvestorOrganisationQueryPort {
  const apex = {
    id: INVESTOR_B,
    tenantId: TENANT_B,
    organisationId: ORG_B,
    investorType: "VC",
    displayName: "Beacon Ventures",
    deploymentState: null,
  } as unknown as NonNullable<
    Awaited<
      ReturnType<
        InvestorOrganisationQueryPort["findCanonicalInvestorOrganisation"]
      >
    >
  >;
  return {
    getCanonicalInvestorOrganisation: (tenantId, id) =>
      Promise.resolve(tenantId === TENANT_B && id === INVESTOR_B ? apex : null),
    findCanonicalInvestorOrganisation: (id) =>
      Promise.resolve(id === INVESTOR_B ? apex : null),
  };
}

export function fakeMandates(): InvestorMandateQueryPort {
  const snapshot = {
    mandateId: MANDATE_B,
    tenantId: TENANT_B,
    investorOrganisationId: INVESTOR_B,
    version: 1,
    status: "ACTIVE",
    discoveryMode: "BALANCED",
    cheque: { currency: "USD", min: "250000", max: "2000000" },
    stage: { minStageCode: "pre_seed", maxStageCode: "seed" },
    constraints: [
      {
        id: randomUUID(),
        tenantId: TENANT_B,
        mandateId: MANDATE_B,
        dimension: "geography.country",
        operator: "IN",
        value: { kind: "codes", values: ["GB", "DE"] },
        importance: "MUST",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
    ],
    taxonomyPreferences: [],
  } as unknown as InvestorMandateSnapshot;
  return {
    findCanonicalInvestorMandate: () => Promise.resolve(null),
    getMandate: (tenantId, investorOrganisationId, mandateId) =>
      Promise.resolve(
        tenantId === TENANT_B &&
          investorOrganisationId === INVESTOR_B &&
          mandateId === MANDATE_B
          ? snapshot
          : null,
      ),
    listActiveMandates: (tenantId, investorOrganisationId) =>
      Promise.resolve(
        tenantId === TENANT_B && investorOrganisationId === INVESTOR_B
          ? [
              {
                id: MANDATE_B,
                tenantId: TENANT_B,
                investorOrganisationId: INVESTOR_B,
                name: `Seed thesis ${MARKERS.investor}`,
                status: "ACTIVE",
                discoveryMode: "BALANCED",
                effectiveFrom: null,
                effectiveTo: null,
                version: 1,
                createdAt: "2026-09-01T00:00:00.000Z",
              } as unknown as Awaited<
                ReturnType<InvestorMandateQueryPort["listActiveMandates"]>
              >[number],
            ]
          : [],
      ),
  };
}

/** Grants every capability to the actor's own organisation; denies elsewhere. */
export function fakeAuthorization(
  options: { readonly denyAll?: boolean | undefined } = {},
): AuthorizationService & { readonly calls: string[] } {
  const calls: string[] = [];
  const authorize = (
    request: Parameters<AuthorizationService["authorize"]>[0],
  ) => {
    calls.push(String(request.capability));
    const resource = request.resource;
    const own =
      resource.kind === "RESOURCE" &&
      resource.tenantId === request.actor.tenantId &&
      resource.organisationId === request.actor.organisationId;
    const decision = {
      outcome: options.denyAll === true || !own ? "DENY" : "ALLOW",
      authority: undefined,
    } as unknown as AuthorizationDecision;
    return Promise.resolve(decision);
  };
  return {
    calls,
    authorize,
    requireCapability: async (request) => {
      const decision = await authorize(request);
      if (decision.outcome !== "ALLOW") {
        throw new Error("denied");
      }
    },
  };
}

/** Intrinsic classification only: network_visible companies to any actor; own organisation to its members. */
export function fakeDisclosure(): DisclosureAccessService {
  const byId = new Map(PROFILES.map((p) => [p.id as string, p]));
  const decide = (
    request: Parameters<DisclosureAccessService["canDisclose"]>[0],
  ): DisclosureDecision => {
    const p =
      request.resource.type === "company"
        ? byId.get(request.resource.id)
        : undefined;
    const actor =
      request.principal.kind === "ACTOR" ? request.principal.actor : null;
    if (p !== undefined && actor !== null) {
      if (
        p.tenantId === actor.tenantId &&
        p.organisationId === actor.organisationId
      ) {
        return {
          outcome: "ALLOW",
          resource: request.resource,
          requestedAccess: request.requestedAccess,
          grantedAccess: "view_download",
          reasonCode: "SAME_ORGANISATION",
          via: { kind: "INTRINSIC" },
        };
      }
      if (p.marketplaceVisibility === "network_visible") {
        return {
          outcome: "ALLOW",
          resource: request.resource,
          requestedAccess: request.requestedAccess,
          grantedAccess: "view",
          reasonCode: "NETWORK_VISIBLE",
          via: { kind: "INTRINSIC" },
        };
      }
    }
    return {
      outcome: "DENY",
      resource: request.resource,
      requestedAccess: request.requestedAccess,
      reasonCode: "NO_MATCHING_SCOPE",
    };
  };
  return {
    canDisclose: (request) => Promise.resolve(decide(request)),
    evaluateMany: (requests) => Promise.resolve(requests.map(decide)),
  };
}

export type QToolPortsOverrides = Partial<QToolPorts>;

export function fakePorts(overrides: QToolPortsOverrides = {}): QToolPorts {
  return {
    companies: fakeCompanies(),
    capital: fakeCapital(),
    mandates: fakeMandates(),
    investors: fakeInvestors(),
    authorization: fakeAuthorization(),
    disclosure: fakeDisclosure(),
    ...overrides,
  };
}

type ScopeSpec = {
  readonly kind: QAuthorisedKnowledgeScope["kind"];
  readonly sensitivity: QSensitivityClass;
  readonly companyId?: string;
  readonly investorOrganisationId?: string;
};

export function planFor(
  actor: ActorContext,
  taskClass: QTaskClass,
  scopes: readonly ScopeSpec[],
  maxSensitivity: QSensitivityClass = "HIGHLY_CONFIDENTIAL",
): PermittedContextPlan {
  const subjects: QSubjectRef[] = scopes.flatMap((s): QSubjectRef[] =>
    s.companyId !== undefined
      ? [{ kind: "COMPANY" as const, companyId: s.companyId }]
      : s.investorOrganisationId !== undefined
        ? [
            {
              kind: "INVESTOR_ORGANISATION" as const,
              investorOrganisationId: s.investorOrganisationId,
            },
          ]
        : [],
  );
  const unique = subjects.filter(
    (s, i) =>
      subjects.findIndex((o) => JSON.stringify(o) === JSON.stringify(s)) === i,
  );
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: actor.tenantId,
    actor: {
      userId: actor.userId,
      ...(actor.organisationId === undefined
        ? {}
        : { organisationId: actor.organisationId }),
    },
    purpose: { capability: "ANSWER", taskClass },
    subjects: unique,
    scopes: scopes.map((s) => ({
      kind: s.kind,
      ...(s.companyId !== undefined
        ? { subject: { kind: "COMPANY", companyId: s.companyId } }
        : s.investorOrganisationId !== undefined
          ? {
              subject: {
                kind: "INVESTOR_ORGANISATION",
                investorOrganisationId: s.investorOrganisationId,
              },
            }
          : {}),
      contextLabel: "organisation_private",
      sensitivity: s.sensitivity,
      layer: "STRUCTURED_STATE",
      factCategories: [],
      projection: "FULL",
      rights: {
        canUseForReasoning: true,
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: true,
      },
      filter: {
        tenantId: actor.tenantId,
        ...(s.companyId === undefined ? {} : { companyId: s.companyId }),
        ...(s.investorOrganisationId === undefined
          ? {}
          : { investorOrganisationId: s.investorOrganisationId }),
      },
      isEvidence: true,
    })),
    denied: [],
    maxSensitivity,
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

export function contextFor(
  actor: ActorContext,
  plan: PermittedContextPlan,
  signal?: AbortSignal,
): QToolExecutionContext {
  return {
    actor,
    runId: RUN as QToolExecutionContext["runId"],
    correlationId: "cor_test",
    capability: "ANSWER",
    plan,
    signal,
  };
}

/** A tool whose execute throws a message that must never reach the model. */
export function explodingTool() {
  return defineQTool<{ readonly x: number }, { readonly y: number }, null>({
    id: "test.explode",
    version: 1,
    status: "ACTIVE",
    providerName: "explode",
    description: "Throws.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: ["GENERAL_QUESTION", "OWN_COMPANY_QUESTION"],
    requiredScopeKinds: [],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "test",
    visibleStage: null,
    input: z.object({ x: z.number() }).strict(),
    output: z.object({ y: z.number() }).strict(),
    authorize: () =>
      Promise.resolve({ outcome: "ALLOW", sensitivity: "PUBLIC", grant: null }),
    execute: () => Promise.reject(new Error(`boom ${MARKERS.internal}`)),
  });
}

/** A tool whose output violates its own schema. */
export function malformedOutputTool() {
  return defineQTool<{ readonly x: number }, { readonly y: number }, null>({
    id: "test.malformed",
    version: 1,
    status: "ACTIVE",
    providerName: "malformed",
    description: "Returns the wrong shape.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: ["GENERAL_QUESTION", "OWN_COMPANY_QUESTION"],
    requiredScopeKinds: [],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "test",
    visibleStage: null,
    input: z.object({ x: z.number() }).strict(),
    output: z.object({ y: z.number() }).strict(),
    authorize: () =>
      Promise.resolve({ outcome: "ALLOW", sensitivity: "PUBLIC", grant: null }),
    execute: () =>
      Promise.resolve({ y: "not a number" } as unknown as { y: number }),
  });
}

/** A tool declaring CONFIDENTIAL data, to test the plan ceiling. */
export function confidentialTool() {
  return defineQTool<Record<string, never>, { readonly secret: string }, null>({
    id: "test.confidential",
    version: 1,
    status: "ACTIVE",
    providerName: "confidential",
    description: "Returns confidential data.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: ["GENERAL_QUESTION", "OWN_COMPANY_QUESTION"],
    requiredScopeKinds: [],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "test",
    visibleStage: null,
    input: z.object({}).strict(),
    output: z.object({ secret: z.string() }).strict(),
    authorize: () =>
      Promise.resolve({
        outcome: "ALLOW",
        sensitivity: "CONFIDENTIAL",
        grant: null,
      }),
    execute: () => Promise.resolve({ secret: MARKERS.founder }),
  });
}
