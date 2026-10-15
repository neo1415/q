import {
  CompanyIdSchema,
  marketplaceParticipationOf,
  type CompanyMarketplaceQueryPort,
} from "@capital-q/companies";
import { cachedInRun, type DatabaseExecutor } from "@capital-q/database";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  type InvestorMandateQueryPort,
  type InvestorOrganisationRepository,
} from "@capital-q/investors";
import {
  RelationshipIdSchema,
  type RelationshipQueryPort,
} from "@capital-q/network";
import {
  actorPrincipal,
  DISCLOSURE_BATCH_MAX,
  organisationPrincipal,
  type DisclosureAccessService,
} from "@capital-q/permissions";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";
import type {
  TaxonomyAssignmentRepository,
  TaxonomyQueryPort,
} from "@capital-q/taxonomy";

import type {
  ActiveMandateLookup,
  CompanyClassification,
  EligibilityPorts,
  MandateSnapshotForEligibility,
  MaterialChangePort,
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
  /**
   * The company's newest evidence of a material change, for re-approach
   * after a pass (doc 19 §67). Absent: a passed relationship stays closed.
   */
  readonly materialChanges?: MaterialChangePort | undefined;
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
    materialChanges,
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
    // The declared range. Dropped here until CQ-REC-STAGE-001, which is
    // why a mandate carrying only a min/max stage built an empty slate:
    // every consumer of the intent was written to read it, and nothing
    // ever handed it over.
    stage: {
      minStageCode: snapshot.stage.minStageCode,
      maxStageCode: snapshot.stage.maxStageCode,
    },
  });

  const readActiveMandate = async ({
    tenantId,
    investorOrganisationId,
    mandateId,
  }: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly mandateId: string | null;
  }): Promise<ActiveMandateLookup> => {
    const tenant = TenantIdSchema.parse(tenantId);
    const investor = InvestorOrganisationIdSchema.parse(investorOrganisationId);
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
  };

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
        // requires (the tenant and the id are matched as a pair); a
        // candidate set is bounded upstream (ELIGIBILITY_BATCH_MAX). One
        // statement for the set (S2), not one per company.
        for (const { companyId } of subjects) out.set(companyId, []);
        const rows = await assignments.listCurrentForSubjects(
          sql,
          "COMPANY",
          subjects.map(({ companyId, tenantId }) => ({
            tenantId: TenantIdSchema.parse(tenantId),
            subjectId: companyId,
          })),
        );
        const grouped = new Map<string, CompanyClassification[]>();
        for (const r of rows) {
          const list = grouped.get(r.subjectId) ?? [];
          list.push({
            nodeId: r.nodeId,
            vocabularyCode: r.vocabularyCode,
            source: r.assignmentSource,
          });
          grouped.set(r.subjectId, list);
        }
        for (const [companyId, list] of grouped) out.set(companyId, list);
        return out;
      },
    },

    mandates: {
      // S2: one turn resolves the same mandate through the feed, the fit and
      // the standing reads (up to four times, each a mandate, constraints and
      // preferences read). Once per run, keyed by tenant, investor and pinned
      // mandate; a write this run makes to a mandate table drops it.
      activeMandate: (query) =>
        cachedInRun(
          {
            aggregate: "eligibility-active-mandate",
            tables: [
              "core.investor_mandates",
              "core.investor_mandate_constraints",
              "taxonomy.mandate_preferences",
            ],
            actor: `${query.tenantId}/${query.investorOrganisationId}`,
            fingerprint: query.mandateId ?? "",
          },
          () => readActiveMandate(query),
        ),
    },

    investorSubject: {
      // S2: the actor's own investor organisation, once per run (the same
      // reason as `ownInvestorOrganisation` in the composition root).
      investorOrganisationFor: (actor) => {
        const organisationId = actor.organisationId;
        if (organisationId === undefined) return Promise.resolve(null);
        return cachedInRun(
          {
            aggregate: "eligibility-investor-organisation",
            tables: ["core.investor_organisations"],
            actor: `${actor.tenantId}/${organisationId}`,
            fingerprint: "",
          },
          async () => {
            const found = await investorOrganisations.findByOrganisation(
              sql,
              actor.tenantId,
              organisationId,
            );
            return found === null ? null : { investorOrganisationId: found.id };
          },
        );
      },
    },

    discoverability: {
      permittedToView: async (viewpoint, companyIds) => {
        const out = new Map<string, boolean>();
        if (
          viewpoint.kind === "INVESTOR_ORGANISATION" &&
          viewpoint.organisationId === undefined
        ) {
          // No organisation resolved, so the organisation may see nothing.
          for (const id of companyIds) out.set(id, false);
          return out;
        }
        const principal =
          viewpoint.kind === "ACTOR"
            ? actorPrincipal(viewpoint.actor)
            : organisationPrincipal({
                tenantId: TenantIdSchema.parse(viewpoint.tenantId),
                organisationId: OrganisationIdSchema.parse(
                  viewpoint.organisationId,
                ),
              });
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
        const passed: { companyId: string; relationshipId: string }[] = [];
        const parsedIds = companyIds.map((id) => CompanyIdSchema.parse(id));
        // One read for the set (S2) when the port offers it.
        const found =
          relationships.findManyByInvestor !== undefined
            ? new Map(
                (
                  await relationships.findManyByInvestor(investor, parsedIds)
                ).map((r) => [r.companyId as string, r] as const),
              )
            : new Map(
                (
                  await Promise.all(
                    parsedIds.map((id) =>
                      relationships.findByParties(id, investor),
                    ),
                  )
                ).flatMap((r) =>
                  r === null ? [] : [[r.companyId as string, r] as const],
                ),
              );
        for (const companyId of companyIds) {
          const relationship = found.get(companyId) ?? null;
          out.set(
            companyId,
            relationship === null
              ? { kind: "NONE" }
              : { kind: "STATE", currentState: relationship.currentState },
          );
          if (relationship?.currentState === "PASSED") {
            passed.push({ companyId, relationshipId: relationship.id });
          }
        }
        // Re-approach after a pass (doc 19 §67): only for the few passed
        // pairs, and only when both reads are composed.
        const passStanding = relationships.passStanding;
        if (
          passed.length > 0 &&
          passStanding !== undefined &&
          materialChanges !== undefined
        ) {
          const changes = await materialChanges.latest(
            passed.map((p) => p.companyId),
          );
          await Promise.all(
            passed.map(async ({ companyId, relationshipId }) => {
              const standing = await passStanding(
                RelationshipIdSchema.parse(relationshipId),
              );
              if (standing === null) return;
              const latest = changes.get(companyId);
              out.set(companyId, {
                kind: "STATE",
                currentState: "PASSED",
                pass: {
                  standing,
                  latestPitchReadyAt: latest?.latestPitchReadyAt ?? null,
                  latestCapitalObjectiveAt:
                    latest?.latestCapitalObjectiveAt ?? null,
                },
              });
            }),
          );
        }
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
