import {
  INVESTOR_MANDATE_CARD_FIELDS,
  type PublicCardDto,
} from "@capital-q/contracts";

import type { SubjectDirectory, SubjectFacts } from "../application/ports.js";
import {
  companySections,
  investorTeamSection,
  personFocus,
  type CompanySectionInputs,
} from "../domain/sections.js";

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
  /** Owner-approved demonstration figures; absent reads false. */
  readonly demonstrationData?: boolean | undefined;
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

/** A person's own declared profile and current affiliation. */
export type PersonProfileRead = {
  readonly displayName: string;
  readonly headline: string | null;
  readonly countryCode: string | null;
  /** Where they work now; null when no current membership. */
  readonly affiliation: {
    readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
    readonly subjectId: string;
    readonly tenantId: string;
    readonly organisationId: string;
    readonly name: string;
    readonly roleTitle: string | null;
  } | null;
};

export type SubjectDirectoryPorts = {
  /**
   * A person's card (owner 2026-10-22). Optional; absent, no person can be
   * found and so no person card can be made or shown.
   */
  readonly findPerson?:
    ((userId: string) => Promise<PersonProfileRead | null>) | undefined;
  /**
   * The affiliation's own live card for one audience, exactly as `/@handle`
   * shows it to that audience. A person's "what they're looking for" is
   * built only from this, so it can never show more than the organisation's
   * own card already does.
   */
  readonly affiliationCard?:
    | ((input: {
        readonly subject: {
          readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
          readonly subjectId: string;
        };
        readonly audience: "PUBLIC" | "PARTICIPANT";
      }) => Promise<PublicCardDto | null>)
    | undefined;
  /** Capital Q's own claims about this very person and their organisation. */
  readonly personVerification?:
    | ((subject: {
        readonly tenantId: string;
        readonly organisationId: string;
        readonly userId: string;
      }) => Promise<{
        readonly organisation: boolean;
        readonly founderIdentity: boolean;
        readonly demoAttested?:
          | {
              readonly organisation: boolean;
              readonly founderIdentity: boolean;
            }
          | undefined;
      }>)
    | undefined;
  /**
   * The card's richer sections (Q Story S6): each owning context's rows
   * for one company, read server-side. Optional; absent, no section shows.
   * Only rows that could ever reach a member may be read in (claims at
   * network_visible or wider, listed data room levels).
   */
  readonly findCompanySections?:
    | ((subject: {
        readonly tenantId: string;
        readonly organisationId: string;
        readonly companyId: string;
      }) => Promise<CompanySectionInputs>)
    | undefined;
  /** The firm's people and their titles, for an investor card's team. */
  readonly findInvestorTeam?:
    | ((subject: {
        readonly tenantId: string;
        readonly investorOrganisationId: string;
      }) => Promise<
        readonly { readonly name: string; readonly role: string | null }[]
      >)
    | undefined;
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
      if (subject.subjectType === "PERSON") {
        const person =
          (await ports.findPerson?.(subject.subjectId).catch(() => null)) ??
          null;
        if (person === null) return null;
        const at = person.affiliation;
        const notVerified = { organisation: false, founderIdentity: false };
        const [verified, publicCard, memberCard] =
          at === null
            ? [notVerified, null, null]
            : await Promise.all([
                ports
                  .personVerification?.({
                    tenantId: at.tenantId,
                    organisationId: at.organisationId,
                    userId: subject.subjectId,
                  })
                  .catch(() => notVerified) ?? notVerified,
                ports
                  .affiliationCard?.({ subject: at, audience: "PUBLIC" })
                  .catch(() => null) ?? null,
                ports
                  .affiliationCard?.({ subject: at, audience: "PARTICIPANT" })
                  .catch(() => null) ?? null,
              ]);
        const focus =
          at === null
            ? null
            : personFocus({
                side: at.subjectType === "COMPANY" ? "FOUNDER" : "INVESTOR",
                publicCard,
                memberCard,
              });
        return {
          tenantId: null,
          organisationId: null,
          name: person.displayName,
          // Their focus echoes the organisation's card: so does its label.
          demonstration:
            focus !== null &&
            (publicCard?.demonstration === true ||
              memberCard?.demonstration === true),
          facts: {
            displayName: person.displayName,
            headline: person.headline,
            roleTitle: at?.roleTitle ?? null,
            affiliation: at?.name ?? null,
            countryCode: person.countryCode,
            personFocus: focus?.value ?? null,
          },
          ...(focus === null
            ? {}
            : { details: { personFocus: focus.details } }),
          verified,
        };
      }
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
        // A failed section read shows no section; the card still works.
        const sectionInputs =
          (await ports
            .findCompanySections?.({
              tenantId: company.tenantId,
              organisationId: company.organisationId,
              companyId: subject.subjectId,
            })
            .catch(() => null)) ?? null;
        const sections =
          sectionInputs === null ? null : companySections(sectionInputs);
        return {
          tenantId: company.tenantId,
          organisationId: company.organisationId,
          name: company.canonicalName,
          demonstration: company.demonstrationData === true,
          facts: {
            canonicalName: company.canonicalName,
            shortDescription: company.shortDescription,
            currentStageCode: company.currentStageCode,
            headquartersCity: company.headquartersCity,
            headquartersCountry: company.headquartersCountry,
            websiteUrl: company.websiteUrl,
            foundedDate: company.foundedDate,
            ...sections?.facts,
          },
          ...(sections === null ? {} : { details: sections.details }),
          verified,
        };
      }
      const investor = await ports.findInvestor(subject.subjectId);
      if (investor === null) return null;
      const mandate: InvestorMandateCardFacts =
        (await ports
          .findInvestorMandateFacts?.(subject.subjectId)
          .catch(() => ({}))) ?? {};
      const people =
        (await ports
          .findInvestorTeam?.({
            tenantId: investor.tenantId,
            investorOrganisationId: subject.subjectId,
          })
          .catch(() => null)) ?? null;
      const team = people === null ? null : investorTeamSection(people);
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
          ...team?.facts,
        },
        ...(team === null ? {} : { details: team.details }),
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
