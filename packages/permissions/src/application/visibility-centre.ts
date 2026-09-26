import { randomUUID } from "node:crypto";

import {
  CapitalObjectiveNotFoundError,
  type CapitalObjectiveQueryPort,
} from "@capital-q/capital";
import {
  CompanyIdSchema,
  CompanyNotFoundError,
  projectCompanyForNetwork,
  type CompanyQueryPort,
} from "@capital-q/companies";
import type {
  AudienceCapitalObjectiveDto,
  AudiencePreviewDto,
  AudienceProfileDto,
  CorrelationId,
  MarketplaceVisibility,
  VisibilityAudience,
  VisibilityObject,
  VisibilityObjectStateDto,
  VisibilityRelationshipDto,
  VisibilityShareDto,
  VisibilityShareResultDto,
  VisibilityRevokeResultDto,
  VisibilityStateDto,
} from "@capital-q/contracts";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  ANONYMOUS_PRINCIPAL,
  DisclosurePolicyIdSchema,
  organisationPrincipal,
  type DisclosurePrincipal,
  type DisclosureResourceRef,
} from "../contracts/index.js";
import { DisclosurePolicyNotFoundError } from "../domain/errors.js";
import type { DisclosureAccessService } from "./access-service.js";
import type { InspectResourceDisclosure } from "./inspection.js";
import {
  DISCLOSURE_INSPECT,
  type DisclosurePolicyManager,
} from "./policy-manager.js";
import type { RelationshipPartyResolver } from "./ports.js";

/**
 * The visibility control centre (CQ-BIZ-003; business research §6.2).
 *
 * "Who can see what" for one company, answered by the disclosure layer
 * itself. A preview asks the same evaluator every real read asks, as the
 * audience would be asked -- anonymous for PUBLIC, an unrelated
 * organisation for NETWORK, the relationship's investor organisation for
 * INVESTOR, the company's own organisation for ONLY_US -- and returns only
 * the projections those reads return: the network projection of the
 * declared profile, and the structured capital objective without its
 * narrative. What the evaluator refuses is null, never a hint.
 *
 * Only the company's own organisation, holding disclosure.inspect, may
 * look; anyone else gets the same not-found as for a company that does
 * not exist. Sharing and revoking go through the policy manager, which
 * holds disclosure.manage and the relationship-coherence rules; nothing
 * here writes a policy row itself.
 */

/** Scopes a founder may choose for each object here (research §6.2 "limited to the valid scopes"). */
const COMPANY_PROFILE_CHOICES: readonly MarketplaceVisibility[] = [
  "organisation_private",
  "network_visible",
];

export type VisibilityCentrePorts = {
  readonly access: DisclosureAccessService;
  readonly inspect: InspectResourceDisclosure;
  readonly policies: DisclosurePolicyManager;
  readonly authorization: AuthorizationService;
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompanyProfile">;
  readonly capital: Pick<CapitalObjectiveQueryPort, "getCurrentForCompany">;
  readonly relationshipParties: RelationshipPartyResolver;
  /**
   * The company's relationships it can see anything of, with the investor
   * organisation's name: the Network context's own list for the company's
   * side (a private discovery is not in it).
   */
  readonly relationshipsOf: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<readonly VisibilityRelationshipDto[]>;
};

export type VisibilityCentre = {
  readonly state: (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }) => Promise<VisibilityStateDto>;
  readonly preview: (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly audience: VisibilityAudience;
    readonly relationshipId?: string | undefined;
  }) => Promise<AudiencePreviewDto>;
  readonly share: (command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly object: "CAPITAL_OBJECTIVE";
    readonly relationshipId: string;
    readonly correlationId: CorrelationId;
  }) => Promise<VisibilityShareResultDto>;
  readonly revoke: (command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly policyId: string;
    readonly correlationId: CorrelationId;
  }) => Promise<VisibilityRevokeResultDto>;
};

type OwnCompany = {
  readonly profile: NonNullable<
    Awaited<ReturnType<CompanyQueryPort["findCanonicalCompanyProfile"]>>
  >;
  readonly objective: Awaited<
    ReturnType<CapitalObjectiveQueryPort["getCurrentForCompany"]>
  >;
};

export function createVisibilityCentre(
  ports: VisibilityCentrePorts,
): VisibilityCentre {
  /**
   * The actor's own company, with disclosure.inspect on it. Absent,
   * another tenant's, another organisation's and not-permitted are all
   * one not-found, so nothing about a company's existence leaks.
   */
  const own = async (
    actor: ActorContext,
    rawCompanyId: string,
  ): Promise<OwnCompany> => {
    const companyId = CompanyIdSchema.safeParse(rawCompanyId);
    if (!companyId.success || actor.organisationId === undefined) {
      throw new CompanyNotFoundError();
    }
    const profile = await ports.companies.findCanonicalCompanyProfile(
      companyId.data,
    );
    if (
      profile === null ||
      profile.tenantId !== actor.tenantId ||
      profile.organisationId !== actor.organisationId
    ) {
      throw new CompanyNotFoundError();
    }
    const decision = await ports.authorization.authorize({
      actor,
      capability: DISCLOSURE_INSPECT,
      resource: {
        kind: "RESOURCE",
        tenantId: profile.tenantId,
        organisationId: profile.organisationId,
        resourceType: "company",
        resourceId: profile.id,
      },
    });
    if (decision.outcome !== "ALLOW") {
      throw new CompanyNotFoundError();
    }
    return {
      profile,
      objective: await ports.capital.getCurrentForCompany(
        profile.tenantId,
        profile.id,
      ),
    };
  };

  const principalFor = async (
    actor: ActorContext,
    company: OwnCompany,
    audience: VisibilityAudience,
    relationshipId: string | undefined,
  ): Promise<DisclosurePrincipal> => {
    switch (audience) {
      case "PUBLIC":
        return ANONYMOUS_PRINCIPAL;
      case "NETWORK":
        // An organisation on Capital Q with no relationship to this
        // company and no share addressed to it: fresh identifiers match
        // no owner, no party and no recipient, so only the scopes that
        // hold for any network organisation can answer.
        return organisationPrincipal({
          tenantId: TenantIdSchema.parse(randomUUID()),
          organisationId: OrganisationIdSchema.parse(randomUUID()),
        });
      case "ONLY_US":
        return organisationPrincipal({
          tenantId: company.profile.tenantId,
          organisationId: company.profile.organisationId,
        });
      case "INVESTOR": {
        // Only a relationship the company can see anything of. A party
        // lookup alone would also accept an investor's private discovery,
        // and answering for it would tell the company it exists.
        const known =
          relationshipId !== undefined &&
          (await ports.relationshipsOf(actor, company.profile.id)).some(
            (r) => r.relationshipId === relationshipId,
          );
        const parties =
          relationshipId === undefined || !known
            ? null
            : await ports.relationshipParties.resolve(relationshipId);
        if (
          parties === null ||
          parties.company.organisationId !== company.profile.organisationId ||
          parties.company.tenantId !== company.profile.tenantId
        ) {
          throw new CompanyNotFoundError();
        }
        return organisationPrincipal({
          tenantId: TenantIdSchema.parse(parties.investor.tenantId),
          organisationId: OrganisationIdSchema.parse(
            parties.investor.organisationId,
          ),
        });
      }
    }
  };

  const resources = (company: OwnCompany): DisclosureResourceRef[] => [
    { type: "company", id: company.profile.id },
    ...(company.objective === null
      ? []
      : [{ type: "capital_objective" as const, id: company.objective.id }]),
  ];

  const sharesOf = async (
    actor: ActorContext,
    company: OwnCompany,
    relationships: readonly VisibilityRelationshipDto[],
  ): Promise<VisibilityShareDto[]> => {
    const names = new Map(
      relationships.map((r) => [r.relationshipId, r.name] as const),
    );
    const shares: VisibilityShareDto[] = [];
    for (const resource of resources(company)) {
      const inspection = await ports.inspect({ actor, resource });
      const object: VisibilityObject =
        resource.type === "company" ? "COMPANY_PROFILE" : "CAPITAL_OBJECTIVE";
      for (const policy of inspection.policies) {
        if (
          policy.status !== "ACTIVE" ||
          policy.recipient === null ||
          policy.recipient.type !== "RELATIONSHIP"
        ) {
          continue;
        }
        shares.push({
          policyId: policy.id,
          object,
          relationshipId: policy.recipient.id,
          recipientName: names.get(policy.recipient.id) ?? null,
          accessLevel: policy.accessLevel,
          createdAt: policy.createdAt,
          expiresAt: policy.expiresAt,
        });
      }
    }
    return shares;
  };

  return {
    state: async ({ actor, companyId }) => {
      const company = await own(actor, companyId);
      const relationships = await ports.relationshipsOf(
        actor,
        company.profile.id,
      );
      const objects: VisibilityObjectStateDto[] = [
        {
          object: "COMPANY_PROFILE",
          resourceId: company.profile.id,
          scope: company.profile.marketplaceVisibility,
          choices: [...COMPANY_PROFILE_CHOICES],
          shareable: false,
        },
      ];
      if (company.objective !== null) {
        objects.push({
          object: "CAPITAL_OBJECTIVE",
          resourceId: company.objective.id,
          // The resolver's classification: a raise is never automatically
          // network-visible (permissions resolvers).
          scope: "founder_private",
          choices: [],
          shareable: true,
        });
      }
      return {
        companyId: company.profile.id,
        objects,
        shares: await sharesOf(actor, company, relationships),
        relationships: [...relationships],
      };
    },

    preview: async ({ actor, companyId, audience, relationshipId }) => {
      const company = await own(actor, companyId);
      const principal = await principalFor(
        actor,
        company,
        audience,
        relationshipId,
      );
      const refs = resources(company);
      const decisions = await ports.access.evaluateMany(
        refs.map((resource) => ({
          principal,
          resource,
          requestedAccess: "view" as const,
        })),
      );
      const allowed = (type: DisclosureResourceRef["type"]) =>
        decisions.some(
          (decision) =>
            decision.resource.type === type && decision.outcome === "ALLOW",
        );

      let profile: AudienceProfileDto | null = null;
      if (allowed("company")) {
        const { companyId: _id, ...fields } = projectCompanyForNetwork(
          company.profile,
        );
        profile = fields;
      }
      let capitalObjective: AudienceCapitalObjectiveDto | null = null;
      if (company.objective !== null && allowed("capital_objective")) {
        capitalObjective = {
          target: company.objective.target,
          targetStage: company.objective.targetStage,
          instrumentCode: company.objective.instrumentCode,
          targetCloseDate: company.objective.targetCloseDate,
        };
      }
      return {
        audience,
        relationshipId:
          audience === "INVESTOR" ? (relationshipId ?? null) : null,
        profile,
        capitalObjective,
      };
    },

    share: async ({ actor, companyId, relationshipId, correlationId }) => {
      const company = await own(actor, companyId);
      if (company.objective === null) {
        throw new CapitalObjectiveNotFoundError();
      }
      // Only a relationship the company can see: a private discovery is
      // not something the company knows of, so it cannot share into it.
      const relationships = await ports.relationshipsOf(
        actor,
        company.profile.id,
      );
      const relationship = relationships.find(
        (r) => r.relationshipId === relationshipId,
      );
      if (relationship === undefined) {
        throw new CompanyNotFoundError();
      }
      const result = await ports.policies.grant({
        actor,
        resource: { type: "capital_objective", id: company.objective.id },
        scopeType: "relationship_shared",
        recipient: { type: "RELATIONSHIP", id: relationshipId },
        accessLevel: "view",
        correlationId,
      });
      if (result.outcome === "REDUNDANT") {
        return { outcome: "REDUNDANT", share: null };
      }
      return {
        outcome: result.outcome,
        share: {
          policyId: result.policy.id,
          object: "CAPITAL_OBJECTIVE",
          relationshipId,
          recipientName: relationship.name,
          accessLevel: result.policy.accessLevel,
          createdAt: result.policy.createdAt,
          expiresAt: result.policy.expiresAt,
        },
      };
    },

    revoke: async ({ actor, companyId, policyId, correlationId }) => {
      const company = await own(actor, companyId);
      const id = DisclosurePolicyIdSchema.safeParse(policyId);
      if (!id.success) throw new DisclosurePolicyNotFoundError();
      // Only a share on this company's own objects is revocable here.
      let found = false;
      for (const resource of resources(company)) {
        const inspection = await ports.inspect({ actor, resource });
        if (inspection.policies.some((policy) => policy.id === id.data)) {
          found = true;
          break;
        }
      }
      if (!found) throw new DisclosurePolicyNotFoundError();
      const result = await ports.policies.revoke({
        actor,
        disclosurePolicyId: id.data,
        correlationId,
      });
      return { outcome: result.outcome };
    },
  };
}
