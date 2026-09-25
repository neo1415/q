import { describe, expect, it } from "vitest";

import type { CompanyQueryPort } from "@capital-q/companies";
import type { PermittedContextPlan } from "@capital-q/contracts";
import type { EvidenceService } from "@capital-q/evidence";
import type { InvestorOrganisationQueryPort } from "@capital-q/investors";
import type {
  AuthorisedKnowledge,
  KnowledgeQueryScope,
  KnowledgeQueryService,
} from "@capital-q/q-knowledge";
import type {
  ContextFirewallPort,
  ContextFirewallRequest,
} from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createProfileFindingsReader } from "../src/composition/profile-findings.js";

/**
 * The profile page's "Q found" read (BIZ-002): own subjects only, the
 * firewall before any knowledge row, the own-public-presence envelope and
 * nothing wider, profile findings only (never observed signals), the axes
 * exactly as recorded, and cited pages the evidence context lets through.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const FOREIGN_COMPANY = "a0000000-0000-4000-8000-000000000002";
const SOURCE = "e0000000-0000-4000-8000-000000000001";
const HIDDEN_SOURCE = "e0000000-0000-4000-8000-000000000002";

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

function knowledgeItem(
  key: string,
  overrides: Partial<AuthorisedKnowledge["object"]> = {},
  extra: Partial<AuthorisedKnowledge> = {},
): AuthorisedKnowledge {
  return {
    object: {
      id: `f0000000-0000-4000-8000-00000000000${key.length % 10}`,
      knowledgeKey: key,
      statement: `Statement for ${key}`,
      truthClass: "Q_INFERENCE",
      evidenceStatus: "SELF_REPORTED",
      status: "ACTIVE",
      recordedAt: "2026-09-20T10:00:00.000Z",
      ...overrides,
    } as AuthorisedKnowledge["object"],
    evidence: [],
    sourceIds: [SOURCE, HIDDEN_SOURCE],
    freshness: {
      stale: false,
      reason: "WITHIN_USEFUL_LIFE",
      policyVersion: "v1",
      ageDays: 5,
    },
    disputed: false,
    ...extra,
  };
}

function harness(
  options: { readonly firewall?: "AUTHORISED" | "DENIED" } = {},
) {
  const calls = {
    plans: [] as ContextFirewallRequest[],
    scopes: [] as KnowledgeQueryScope[],
  };
  const companies = {
    findCanonicalCompanyProfile: (id: string) =>
      Promise.resolve(
        id === COMPANY
          ? { id: COMPANY, tenantId: TENANT, organisationId: ORG }
          : id === FOREIGN_COMPANY
            ? {
                id: FOREIGN_COMPANY,
                tenantId: TENANT,
                organisationId: "d0000000-0000-4000-8000-000000000002",
              }
            : null,
      ),
  } as unknown as CompanyQueryPort;
  const investors = {
    findCanonicalInvestorOrganisation: () => Promise.resolve(null),
  } as unknown as InvestorOrganisationQueryPort;
  const firewall: ContextFirewallPort = {
    plan: (request) => {
      calls.plans.push(request);
      return Promise.resolve(
        options.firewall === "DENIED"
          ? { outcome: "DENIED", reason: "NOT_AVAILABLE", denied: [] }
          : {
              outcome: "AUTHORISED",
              plan: {
                tenantId: TENANT,
                maxSensitivity: "HIGHLY_CONFIDENTIAL",
                scopes: [
                  {
                    kind: "OWN_PUBLIC_PRESENCE",
                    subject: request.subjects[0],
                    contextLabel: "organisation_private",
                    sensitivity: "INTERNAL",
                    projection: "FULL",
                    rights: {
                      canUseForReasoning: true,
                      canDiscloseExistence: true,
                      canQuote: true,
                      canProvideLink: true,
                    },
                    filter: { tenantId: TENANT, companyId: COMPANY },
                  },
                  {
                    kind: "COMPANY_PROFILE",
                    subject: request.subjects[0],
                    contextLabel: "organisation_private",
                    sensitivity: "CONFIDENTIAL",
                    projection: "FULL",
                    rights: {
                      canUseForReasoning: true,
                      canDiscloseExistence: true,
                      canQuote: true,
                      canProvideLink: true,
                    },
                    filter: { tenantId: TENANT, companyId: COMPANY },
                  },
                ],
              } as unknown as PermittedContextPlan,
            },
      );
    },
  };
  const knowledge = {
    currentForSubject: (scope: KnowledgeQueryScope) => {
      calls.scopes.push(scope);
      return Promise.resolve([
        knowledgeItem("presence.what_they_do"),
        knowledgeItem("presence.signal.public_voice"),
        knowledgeItem(
          "presence.location",
          { status: "DISPUTED" },
          { disputed: true },
        ),
        knowledgeItem(
          "presence.milestone",
          {},
          {
            freshness: {
              stale: true,
              reason: "EXCEEDED_USEFUL_LIFE",
              policyVersion: "v1",
              ageDays: 400,
            },
          },
        ),
      ]);
    },
  } as unknown as KnowledgeQueryService;
  const evidence = {
    getEvidenceSource: ({ sourceId }: { readonly sourceId: string }) =>
      sourceId === SOURCE
        ? Promise.resolve({
            sourceUrl: "https://kivu-freight.example/about",
            title: "About Kivu Freight",
            retrievedAt: "2026-09-20T09:59:00.000Z",
          })
        : Promise.reject(new Error("not visible")),
  } as unknown as Pick<EvidenceService, "getEvidenceSource">;
  return {
    calls,
    reader: createProfileFindingsReader({
      companies,
      investors,
      firewall,
      knowledge,
      evidence,
    }),
  };
}

describe("profile findings", () => {
  it("reads the actor's own company through the firewall and the presence envelope only", async () => {
    const { reader, calls } = harness();
    const result = await reader.read(ACTOR, {
      subjectType: "COMPANY",
      subjectId: COMPANY,
    });
    expect(calls.plans[0]).toMatchObject({
      capability: "ANSWER",
      subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    });
    // Only the own-public-presence scope reached the knowledge read.
    expect(calls.scopes[0]?.constraints.map((c) => c.scopeKind)).toEqual([
      "OWN_PUBLIC_PRESENCE",
    ]);
    expect(result?.findings.map((finding) => finding.key)).toEqual([
      "presence.what_they_do",
      "presence.location",
      "presence.milestone",
    ]);
    const [doing, place, milestone] = result?.findings ?? [];
    // The axes exactly as recorded: Q's reading, not a verified fact.
    expect(doing).toMatchObject({
      truthClass: "Q_INFERENCE",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      sources: [
        {
          url: "https://kivu-freight.example/about",
          title: "About Kivu Freight",
          retrievedAt: "2026-09-20T09:59:00.000Z",
        },
      ],
    });
    expect(place?.lifecycleStatus).toBe("DISPUTED");
    expect(milestone?.lifecycleStatus).toBe("STALE");
    expect(JSON.stringify(result)).not.toMatch(/confidence|percent/i);
  });

  it("answers null for another organisation's company, before asking the firewall", async () => {
    const { reader, calls } = harness();
    expect(
      await reader.read(ACTOR, {
        subjectType: "COMPANY",
        subjectId: FOREIGN_COMPANY,
      }),
    ).toBeNull();
    expect(calls.plans).toHaveLength(0);
    expect(calls.scopes).toHaveLength(0);
  });

  it("answers null for another person, and for a subject that does not exist", async () => {
    const { reader, calls } = harness();
    expect(
      await reader.read(ACTOR, {
        subjectType: "PERSON",
        subjectId: "b0000000-0000-4000-8000-000000000009",
      }),
    ).toBeNull();
    expect(
      await reader.read(ACTOR, {
        subjectType: "INVESTOR_ORGANISATION",
        subjectId: "a1000000-0000-4000-8000-000000000001",
      }),
    ).toBeNull();
    expect(calls.plans).toHaveLength(0);
  });

  it("reads nothing when the firewall denies the plan", async () => {
    const { reader, calls } = harness({ firewall: "DENIED" });
    expect(
      await reader.read(ACTOR, { subjectType: "PERSON", subjectId: USER }),
    ).toBeNull();
    expect(calls.scopes).toHaveLength(0);
  });
});
