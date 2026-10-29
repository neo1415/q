import type { CapitalService } from "@capital-q/capital";
import {
  CompanyIdSchema,
  CompanyTeamFactsNotFoundError,
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
  type InvestorMandate,
  type InvestorService,
} from "@capital-q/investors";
import type { VisibilityCentre } from "@capital-q/permissions";
import type {
  EvidenceDocumentsPort,
  OwnRecordsPort,
  RelationshipMailPort,
} from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";
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

/** Mandates whose criteria are read in full for one record. */
const MANDATE_DETAIL_MAX = 3;

/**
 * A mandate's declared criteria, as the investor declared them: cheque,
 * stage, constraints and taxonomy preferences (sector, geography,
 * exclusions). The raw narrative is left out (investor-private, never
 * emitted); an unset value stays null, never zero.
 */
function declaredCriteria(mandate: InvestorMandate) {
  return {
    declared: true,
    cheque: {
      min: mandate.minCheque,
      max: mandate.maxCheque,
      currency: mandate.currencyCode,
    },
    stage: { min: mandate.minStageCode, max: mandate.maxStageCode },
    constraints: mandate.constraints.map((constraint) => ({
      dimension: constraint.dimension,
      operator: constraint.operator,
      value: constraint.value,
      importance: constraint.importance,
      hardExclusion: constraint.isHardExclusion,
    })),
    preferences: mandate.taxonomyPreferences.map((preference) => ({
      vocabulary: preference.vocabularyCode,
      code: preference.canonicalCode,
      strength: preference.preferenceStrength,
      exclusion: preference.isExclusion,
    })),
  };
}

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
              .then((facts) => ({ status: "RECORDED" as const, facts }))
              .catch((error: unknown) =>
                error instanceof CompanyTeamFactsNotFoundError
                  ? { status: "NOT_RECORDED" as const }
                  : { status: "UNAVAILABLE" as const },
              ),
          ]);
          return companyTeamRecord(membership, founderProfile, teamFacts);
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
          const organisation = investorOrganisationId();
          const page = await deps.investorService.listInvestorMandates({
            actor,
            investorOrganisationId: organisation,
            limit: 10,
          });
          // Live 2026-10-29 (deep research, run A): the list holds only
          // each mandate's name and status, so a report written for an
          // investor with an ACTIVE $250k-1M seed NG/GH/KE mandate said
          // their cheque, stage, sector and geography "are not recorded".
          // The criteria of each mandate still in force are read through
          // the same service, as them (investor.mandate.view again).
          const inForce = page.items
            .filter((item) => item.status !== "CLOSED")
            .slice(0, MANDATE_DETAIL_MAX);
          const details = await Promise.all(
            inForce.map((item) =>
              deps.investorService
                .getInvestorMandate({
                  actor,
                  investorOrganisationId: organisation,
                  mandateId: item.id,
                })
                .then(declaredCriteria)
                .catch(() => null),
            ),
          );
          return {
            items: page.items.map((item) => {
              const at = inForce.indexOf(item);
              const criteria = at < 0 ? null : (details[at] ?? null);
              return criteria === null ? item : { ...item, ...criteria };
            }),
          };
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

type DocumentFigureState = {
  readonly pending: number;
  readonly confirmed: readonly string[];
};

/** Their organisation's uploaded documents: metadata, as document.view allows. */
export function createEvidenceDocumentsPort(
  evidence: Pick<EvidenceService, "listDocumentsWithVersions">,
  /**
   * Owner 2026-10-28: the key figures code read from their financial
   * documents (a pending count) and the ones they confirmed, set against
   * their deck. Absent: listed without them.
   */
  figures?: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<
    ReadonlyMap<
      string,
      { readonly pending: number; readonly confirmed: readonly string[] }
    >
  >,
): EvidenceDocumentsPort {
  return {
    list: async (actor, companyId) => {
      const documents = await evidence.listDocumentsWithVersions({
        actor,
        companyId,
      });
      // Only when a highly confidential document is listed: nothing else
      // has figures read locally.
      const byDocument =
        figures !== undefined &&
        documents.some(
          (entry) => entry.document.sensitivityClass === "HIGHLY_CONFIDENTIAL",
        )
          ? await figures(actor, companyId).catch(
              (): ReadonlyMap<string, DocumentFigureState> => new Map(),
            )
          : new Map<string, DocumentFigureState>();
      return documents.map((entry) => ({
        ...(byDocument.has(entry.document.id)
          ? { figures: byDocument.get(entry.document.id) }
          : {}),
        documentId: entry.document.id,
        title: entry.document.title,
        documentType: entry.document.documentType,
        status: entry.document.status,
        processing: entry.currentVersion?.processingStatus ?? null,
        updatedAt: entry.document.updatedAt,
        downloadAudience: entry.document.downloadAudience,
        sensitivityClass: entry.document.sensitivityClass,
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

/**
 * The team record as Q reads it (live acceptance 2026-10-16: Q said "1
 * founder, 1 person works here" for a company whose canonical team facts
 * were 2 founders and 14 people). The company's own counts come ONLY from
 * the canonical team facts, under names that say what they count; the
 * caller's own membership is labelled as theirs, never a team list to be
 * counted; and a missing or unreadable count says so, so nothing is
 * inferred in its place. Unknown stays unknown.
 */
export function companyTeamRecord(
  membership: {
    readonly businessTitle?: string | null;
    readonly isFounder?: boolean;
    readonly relationshipType?: string;
  } | null,
  founderProfile: unknown,
  teamFacts:
    | {
        readonly status: "RECORDED";
        readonly facts: {
          readonly founderCount: number | null;
          readonly fullTimeFounderCount: number | null;
          readonly teamSize: number | null;
          readonly updatedAt?: string;
        };
      }
    | { readonly status: "NOT_RECORDED" | "UNAVAILABLE" },
) {
  return {
    teamCounts:
      teamFacts.status === "RECORDED"
        ? {
            status: "RECORDED",
            numberOfFounders: teamFacts.facts.founderCount,
            numberOfFullTimeFounders: teamFacts.facts.fullTimeFounderCount,
            peopleWorkingOnTheCompany: teamFacts.facts.teamSize,
            ...(teamFacts.facts.updatedAt === undefined
              ? {}
              : { updatedAt: teamFacts.facts.updatedAt }),
            note: "The company's own declared counts. Null means not stated: unknown, never zero or one.",
          }
        : {
            status: teamFacts.status,
            note:
              teamFacts.status === "NOT_RECORDED"
                ? "No team counts are recorded yet. Say they are not recorded; never infer them."
                : "The team counts could not be read just now. Say so; never infer them.",
          },
    yourOwnRole:
      membership === null
        ? null
        : {
            title: membership.businessTitle ?? null,
            isFounder: membership.isFounder ?? null,
            note: "Only the person asking. Not a list of the team and never a count of it.",
          },
    yourFounderProfile: founderProfile,
  };
}
