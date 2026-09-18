import {
  CompanyIdSchema,
  marketplaceParticipationOf,
  type CompanyMarketplaceQueryPort,
} from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  type InvestorMandateQueryPort,
  type InvestorOrganisationRepository,
} from "@capital-q/investors";
import type { RelationshipQueryPort } from "@capital-q/network";
import {
  actorPrincipal,
  DISCLOSURE_BATCH_MAX,
  type DisclosureAccessService,
} from "@capital-q/permissions";
import { TenantIdSchema } from "@capital-q/security";
import type {
  TaxonomyAssignmentRepository,
  TaxonomyQueryPort,
} from "@capital-q/taxonomy";

import type {
  ActiveMandateLookup,
  CompanyClassification,
  EligibilityPorts,
  MandateSnapshotForEligibility,
  RelationshipStanding,
} from "../eligibility/ports.js";

/**
 * Eligibility's reads, assembled from the owning contexts' public ports.
 *
 * There is no SQL in this file and no table name. Companies answers about
 * companies, Investors about mandates, Taxonomy about classifications,
 * Network about relationships and Permissions about disclosure. The
 * Recommendation context composes their answers and nothing else — which
 * is also why nothing here can read Q memory, a conversation, a document
 * or a public page: no port offers one.
 */

export type DomainEligibilityPortDependencies = {
  readonly sql: DatabaseExecutor;
  readonly companies: CompanyMarketplaceQueryPort;
  readonly assignments: TaxonomyAssignmentRepository;
  readonly mandates: InvestorMandateQueryPort;
  readonly investorOrganisations: InvestorOrganisationRepository;
  readonly relationships: RelationshipQueryPort;
  readonly disclosure: DisclosureAccessService;
  readonly taxonomy?: TaxonomyQueryPort | undefined;
};

export function createDomainEligibilityPorts(
  dependencies: DomainEligibilityPortDependencies,
): EligibilityPorts {
  const {
    sql,
    companies,
    assignments,
    mandates,
    investorOrganisations,
    relationships,
    disclosure,
    taxonomy,
  } = dependencies;

  const toSnapshot = (
    snapshot: NonNullable<
      Awaited<ReturnType<InvestorMandateQueryPort["getMandate"]>>
    >,
  ): MandateSnapshotForEligibility => ({
    mandateId: snapshot.mandateId,
    investorOrganisationId: snapshot.investorOrganisationId,
    version: snapshot.version,
    status: snapshot.status,
    constraints: snapshot.constraints.map((c) => ({
      dimension: c.dimension,
      operator: c.operator,
      value: c.value,
      importance: c.importance,
      isHardExclusion: c.isHardExclusion,
      automatedUse: c.automatedUse,
    })),
    taxonomyPreferences: snapshot.taxonomyPreferences.map((p) => ({
      nodeId: p.nodeId,
      vocabularyCode: p.vocabularyCode,
      preferenceStrength: p.preferenceStrength,
      isExclusion: p.isExclusion,
      source: p.source,
    })),
  });

  return {
    companies: {
      findMany: async (companyIds) => {
        const facts = await companies.findCanonicalMarketplaceFacts(
          companyIds.map((id) => CompanyIdSchema.parse(id)),
        );
        return facts.map((f) => ({
          companyId: f.id,
          tenantId: f.tenantId,
          organisationId: f.organisationId,
          companyStatus: f.companyStatus,
          marketplaceVisibility: f.marketplaceVisibility,
          marketplaceParticipation: marketplaceParticipationOf(
            f.marketplaceReadinessState,
          ),
          currentStageCode: f.currentStageCode,
          headquartersCountry: f.headquartersCountry,
        }));
      },
    },

    classifications: {
      listActive: async (subjects) => {
        const out = new Map<string, readonly CompanyClassification[]>();
        // Read under each company's own tenant, as the Taxonomy context
        // requires; a candidate set is bounded upstream (ELIGIBILITY_BATCH_MAX).
        await Promise.all(
          subjects.map(async ({ companyId, tenantId }) => {
            const rows = await assignments.listCurrent(
              sql,
              TenantIdSchema.parse(tenantId),
              { subjectType: "COMPANY", subjectId: companyId },
            );
            out.set(
              companyId,
              rows.map((r) => ({
                nodeId: r.nodeId,
                vocabularyCode: r.vocabularyCode,
                source: r.assignmentSource,
              })),
            );
          }),
        );
        return out;
      },
    },

    mandates: {
      activeMandate: async ({
        tenantId,
        investorOrganisationId,
        mandateId,
      }): Promise<ActiveMandateLookup> => {
        const tenant = TenantIdSchema.parse(tenantId);
        const investor = InvestorOrganisationIdSchema.parse(
          investorOrganisationId,
        );
        // Tenant- and organisation-scoped reads only: a mandate id that is
        // not this investor's resolves as absent, never as somebody else's.
        if (mandateId !== null) {
          const pinned = await mandates.getMandate(
            tenant,
            investor,
            InvestorMandateIdSchema.parse(mandateId),
          );
          return pinned === null
            ? { kind: "NONE" }
            : { kind: "FOUND", mandate: toSnapshot(pinned) };
        }
        const active = await mandates.listActiveMandates(tenant, investor);
        if (active.length === 0) return { kind: "NONE" };
        if (active.length > 1) return { kind: "AMBIGUOUS" };
        const [only] = active;
        if (only === undefined) return { kind: "NONE" };
        const snapshot = await mandates.getMandate(tenant, investor, only.id);
        return snapshot === null
          ? { kind: "NONE" }
          : { kind: "FOUND", mandate: toSnapshot(snapshot) };
      },
    },

    investorSubject: {
      investorOrganisationFor: async (actor) => {
        if (actor.organisationId === undefined) return null;
        const found = await investorOrganisations.findByOrganisation(
          sql,
          actor.tenantId,
          actor.organisationId,
        );
        return found === null ? null : { investorOrganisationId: found.id };
      },
    },

    discoverability: {
      permittedToView: async (actor, companyIds) => {
        const out = new Map<string, boolean>();
        const principal = actorPrincipal(actor);
        for (let i = 0; i < companyIds.length; i += DISCLOSURE_BATCH_MAX) {
          const slice = companyIds.slice(i, i + DISCLOSURE_BATCH_MAX);
          const decisions = await disclosure.evaluateMany(
            slice.map((id) => ({
              principal,
              resource: { type: "company", id },
              requestedAccess: "view",
            })),
          );
          slice.forEach((id, index) => {
            out.set(id, decisions[index]?.outcome === "ALLOW");
          });
        }
        return out;
      },
    },

    relationships: {
      standings: async (investorOrganisationId, companyIds) => {
        const investor = InvestorOrganisationIdSchema.parse(
          investorOrganisationId,
        );
        const out = new Map<string, RelationshipStanding>();
        await Promise.all(
          companyIds.map(async (companyId) => {
            const relationship = await relationships.findByParties(
              CompanyIdSchema.parse(companyId),
              investor,
            );
            out.set(
              companyId,
              relationship === null
                ? { kind: "NONE" }
                : { kind: "STATE", currentState: relationship.currentState },
            );
          }),
        );
        return out;
      },
    },

    ...(taxonomy === undefined
      ? {}
      : {
          taxonomyVersions: {
            currentVersions: () => taxonomy.getVersionSet(),
          },
        }),
  };
}
