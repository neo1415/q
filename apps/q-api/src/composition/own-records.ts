import type { CapitalService } from "@capital-q/capital";
import {
  CompanyIdSchema,
  declaredFactsForNetwork,
  isNetworkVisible,
  projectCompanyForNetwork,
  type CompanyService,
} from "@capital-q/companies";
import type { AudiencePreviewDto } from "@capital-q/contracts";
import type { EvidenceService } from "@capital-q/evidence";
import {
  InvestorOrganisationIdSchema,
  isInvestorNetworkVisible,
  toNetworkVisibleInvestorProfile,
  type InvestorService,
} from "@capital-q/investors";
import type { VisibilityCentre } from "@capital-q/permissions";
import type {
  EvidenceDocumentsPort,
  OwnRecordsPort,
  RelationshipMailPort,
} from "@capital-q/q-tools";
import type { CompanyVerificationService } from "@capital-q/verification";

import type { ProfileFindingsReader } from "./profile-findings.js";

/**
 * R33: Q reads what the person's own screens show, through the services
 * those screens call, as the actor. Each service authorises the read
 * again (company.view, company.team.view, capital_objective.view,
 * verification.view, investor.view, investor.mandate.view,
 * disclosure.inspect, document.view); a refusal is `null`, one answer.
 * The tool already resolved the subject to the actor's own company or
 * investor organisation from the plan.
 */
export type OwnRecordsDependencies = {
  readonly companyService: CompanyService;
  readonly investorService: InvestorService;
  readonly capital: CapitalService;
  readonly verification: CompanyVerificationService;
  readonly visibility: VisibilityCentre;
  readonly profileFindings: ProfileFindingsReader;
};

export function createOwnRecordsPort(
  deps: OwnRecordsDependencies,
): OwnRecordsPort {
  return {
    read: async (actor, query) => {
      const companyId = () => CompanyIdSchema.parse(query.subjectId);
      const investorOrganisationId = () =>
        InvestorOrganisationIdSchema.parse(query.subjectId);
      switch (query.record) {
        case "VERIFICATION_STATUS":
          return deps.verification.getCompanyVerification({
            actor,
            companyId: companyId(),
          });
        case "MARKETPLACE_READINESS":
          return deps.companyService.getMarketplaceReadiness({
            actor,
            companyId: companyId(),
          });
        case "COMPANY_NETWORK_PREVIEW": {
          const company = await deps.companyService.getCompany({
            actor,
            companyId: companyId(),
          });
          const projection = projectCompanyForNetwork(company);
          return {
            ...projection,
            networkVisible: isNetworkVisible(company.marketplaceVisibility),
            facts: declaredFactsForNetwork(projection),
          };
        }
        case "COMPANY_AUDIENCE_PREVIEW": {
          if (query.audience === undefined) return null;
          const preview: AudiencePreviewDto = await deps.visibility.preview({
            actor,
            companyId: query.subjectId,
            audience: query.audience as AudiencePreviewDto["audience"],
            ...(query.relationshipId === undefined
              ? {}
              : { relationshipId: query.relationshipId }),
          });
          return preview;
        }
        case "COMPANY_TEAM": {
          const id = companyId();
          const [membership, founderProfile, teamFacts] = await Promise.all([
            deps.companyService
              .getMyCompanyMembership({ actor, companyId: id })
              .catch(() => null),
            deps.companyService
              .getMyFounderProfile({ actor, companyId: id })
              .catch(() => null),
            deps.companyService
              .getCompanyTeamFacts({ actor, companyId: id })
              .catch(() => null),
          ]);
          return { membership, founderProfile, teamFacts };
        }
        case "RAISE_HISTORY": {
          const page = await deps.capital.listCapitalObjectives({
            actor,
            companyId: companyId(),
            limit: 10,
          });
          return { items: page.items };
        }
        case "PROFILE_FINDINGS":
          return deps.profileFindings.read(actor, {
            subjectType: query.subjectType,
            subjectId: query.subjectId,
          });
        case "INVESTOR_ORGANISATION":
          return deps.investorService.getInvestorOrganisation({
            actor,
            investorOrganisationId: investorOrganisationId(),
          });
        case "INVESTOR_NETWORK_PREVIEW": {
          const investor = await deps.investorService.getInvestorOrganisation({
            actor,
            investorOrganisationId: investorOrganisationId(),
          });
          return {
            ...toNetworkVisibleInvestorProfile(investor),
            networkVisible: isInvestorNetworkVisible(investor.visibility),
          };
        }
        case "INVESTOR_REPRESENTATIVE":
          return deps.investorService.getMyInvestorRepresentative({
            actor,
            investorOrganisationId: investorOrganisationId(),
          });
        case "INVESTOR_MANDATES": {
          const page = await deps.investorService.listInvestorMandates({
            actor,
            investorOrganisationId: investorOrganisationId(),
            limit: 10,
          });
          return { items: page.items };
        }
      }
    },
    reassessReadiness: (actor, companyId, correlationId) =>
      deps.companyService.assessMarketplaceReadiness({
        actor,
        companyId: CompanyIdSchema.parse(companyId),
        correlationId,
      }),
  };
}

/** Their organisation's uploaded documents: metadata, as document.view allows. */
export function createEvidenceDocumentsPort(
  evidence: Pick<EvidenceService, "listDocumentsWithVersions">,
): EvidenceDocumentsPort {
  return {
    list: async (actor, companyId) => {
      const documents = await evidence.listDocumentsWithVersions({
        actor,
        companyId,
      });
      return documents.map((entry) => ({
        documentId: entry.document.id,
        title: entry.document.title,
        documentType: entry.document.documentType,
        status: entry.document.status,
        processing: entry.currentVersion?.processingStatus ?? null,
        updatedAt: entry.document.updatedAt,
        downloadAudience: entry.document.downloadAudience,
        ...(entry.currentVersion === null || entry.currentVersion === undefined
          ? {}
          : { malwareScanStatus: entry.currentVersion.malwareScanStatus }),
      }));
    },
  };
}

/** A relationship's email, from the actor's own mailbox only. */
export function createRelationshipMailPort(integrations: {
  readonly listRelationshipMail: (
    userId: string,
    relationshipId: string,
  ) => Promise<
    readonly {
      readonly direction: string;
      readonly status: string;
      readonly from: string;
      readonly to: string;
      readonly subject: string;
      readonly occurredAt: string;
    }[]
  >;
}): RelationshipMailPort {
  return {
    list: async (actor, relationshipId) => {
      const items = await integrations.listRelationshipMail(
        actor.userId,
        relationshipId,
      );
      return items.map((item) => ({
        direction: item.direction,
        status: item.status,
        from: item.from,
        to: item.to,
        subject: item.subject,
        at: item.occurredAt,
      }));
    },
  };
}
