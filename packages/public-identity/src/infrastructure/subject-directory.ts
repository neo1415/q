import { INVESTOR_MANDATE_CARD_FIELDS } from "@capital-q/contracts";

import type { SubjectDirectory, SubjectFacts } from "../application/ports.js";

/**
 * The directory the apps compose (BIZ-004): each owning context's public,
 * permission-neutral read, adapted to the card's needs. Only the declared
 * fields a card could ever show are copied into `facts`; everything else
 * the canonical row holds stays behind, so a later projection bug cannot
 * leak what it was never handed.
 */

export type CompanyProfileRead = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly canonicalName: string;
  readonly shortDescription: string | null;
  readonly currentStageCode: string | null;
  readonly headquartersCity: string | null;
  readonly headquartersCountry: string | null;
  readonly websiteUrl: string | null;
  readonly foundedDate: string | null;
};

export type InvestorProfileRead = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly displayName: string;
  readonly investorType: string;
  readonly publicDescription: string | null;
  readonly hqCountry: string | null;
  readonly websiteUrl: string | null;
  readonly deploymentState: string | null;
  readonly verificationState: string;
};

/** The active mandate's shareable facts by card field; absent reads as none. */
export type InvestorMandateCardFacts = Readonly<
  Partial<Record<(typeof INVESTOR_MANDATE_CARD_FIELDS)[number], string | null>>
>;

export type SubjectDirectoryPorts = {
  /**
   * Founder design 2026-09-28: the investor's active mandate as named
   * facts a card may show. Optional; absent, those fields are never set.
   */
  readonly findInvestorMandateFacts?:
    | ((investorOrganisationId: string) => Promise<InvestorMandateCardFacts>)
    | undefined;
  readonly findCompany: (
    companyId: string,
  ) => Promise<CompanyProfileRead | null>;
  readonly findInvestor: (
    investorOrganisationId: string,
  ) => Promise<InvestorProfileRead | null>;
  /** Capital Q's own claims for a company's organisation and founder. */
  readonly companyVerification: (subject: {
    readonly tenantId: string;
    readonly organisationId: string;
    readonly companyId: string;
  }) => Promise<{
    readonly organisation: boolean;
    readonly founderIdentity: boolean;
    /** Which of the above rest on the synthetic-demo attestation. */
    readonly demoAttested?:
      | {
          readonly organisation: boolean;
          readonly founderIdentity: boolean;
        }
      | undefined;
  }>;
};

export function createSubjectDirectory(
  ports: SubjectDirectoryPorts,
): SubjectDirectory {
  return {
    find: async (subject): Promise<SubjectFacts | null> => {
      if (subject.subjectType === "COMPANY") {
        const company = await ports.findCompany(subject.subjectId);
        if (company === null) return null;
        const verified = await ports
          .companyVerification({
            tenantId: company.tenantId,
            organisationId: company.organisationId,
            companyId: subject.subjectId,
          })
          .catch(() => ({ organisation: false, founderIdentity: false }));
        return {
          tenantId: company.tenantId,
          organisationId: company.organisationId,
          name: company.canonicalName,
          facts: {
            canonicalName: company.canonicalName,
            shortDescription: company.shortDescription,
            currentStageCode: company.currentStageCode,
            headquartersCity: company.headquartersCity,
            headquartersCountry: company.headquartersCountry,
            websiteUrl: company.websiteUrl,
            foundedDate: company.foundedDate,
          },
          verified,
        };
      }
      const investor = await ports.findInvestor(subject.subjectId);
      if (investor === null) return null;
      const mandate: InvestorMandateCardFacts =
        (await ports
          .findInvestorMandateFacts?.(subject.subjectId)
          .catch(() => ({}))) ?? {};
      return {
        tenantId: investor.tenantId,
        organisationId: investor.organisationId,
        name: investor.displayName,
        facts: {
          displayName: investor.displayName,
          investorType: investor.investorType,
          publicDescription: investor.publicDescription,
          hqCountry: investor.hqCountry,
          websiteUrl: investor.websiteUrl,
          deploymentState: investor.deploymentState,
          ...Object.fromEntries(
            INVESTOR_MANDATE_CARD_FIELDS.map((key) => [
              key,
              mandate[key] ?? null,
            ]),
          ),
        },
        // The investors context's own presentation state; anything other
        // than unverified is Capital Q's decision about the organisation.
        verified: {
          organisation: investor.verificationState !== "unverified",
          founderIdentity: false,
        },
      };
    },
  };
}
