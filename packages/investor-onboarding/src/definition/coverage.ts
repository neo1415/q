import type { OnboardingCoverageProfile } from "@capital-q/onboarding";

import { INVESTOR_STEPS } from "./investor-v1.js";
import { INVESTOR_WEBSITE_STEP } from "./investor-v2.js";

/**
 * Investor coverage profile (lane ob1, 2026-10-16): the mandate interview's
 * annotation of its definition's steps. A mandate, not founder fundraising
 * questions: nothing here asks an investor about a raise. Declared mandate
 * only; observed behaviour never fills a field. Review and handoff are the
 * journey's confirmations, not fields.
 *
 * ESSENTIAL: what Discover needs to rank anything honestly (who they are,
 * whether they deploy, stages, cheque currency, where and what). IMPORTANT:
 * sharper fit. OPTIONAL: nuance, offered once and never pressed.
 */
/** Coverage keys an upload satisfies (no definition step holds them). */
export const INVESTOR_DOCUMENT_FIELDS = {
  materials: "I.materials",
} as const;

/** How the optional investor upload is filed, by what the person says it is. */
export const INVESTOR_UPLOAD_DOCUMENT_TYPES = {
  FUND_DECK: "FUND_DECK",
  THESIS: "INVESTMENT_THESIS",
  LP_LETTER: "LP_LETTER",
} as const;

export const INVESTOR_COVERAGE_PROFILE: OnboardingCoverageProfile = {
  journeyType: "investor",
  version: "investor-coverage-2026-10-16",
  registrationSeeds: { organisationName: INVESTOR_STEPS.organisationName },
  // The optional investor upload (ob2's form and the conversation alike).
  // A fund deck or investment thesis is readable material whose content
  // may only PROPOSE values for the mandate fields below; an LP letter is
  // private and is acknowledged by metadata only, never read.
  documentFields: {
    [INVESTOR_DOCUMENT_FIELDS.materials]: {
      concept: "investor.materials",
      label: "Fund deck, thesis or LP letter",
      priority: "OPTIONAL",
      // ob2's explicit investor types; the older filings still count.
      documentTypes: [
        "FUND_DECK",
        "INVESTMENT_THESIS",
        "LP_LETTER",
        "COMPANY_PROFILE",
        "PITCH_DECK",
        "OTHER",
      ],
      informs: [
        INVESTOR_STEPS.stages,
        INVESTOR_STEPS.currency,
        INVESTOR_STEPS.chequeMin,
        INVESTOR_STEPS.chequeTypical,
        INVESTOR_STEPS.chequeMax,
        INVESTOR_STEPS.geography,
        INVESTOR_STEPS.sectors,
        INVESTOR_STEPS.businessModels,
        INVESTOR_STEPS.customerTypes,
        INVESTOR_STEPS.customCriteria,
        INVESTOR_STEPS.portfolio,
      ],
    },
  },
  // I1.mandate_context is not a field: the journey resolves which mandate
  // is being defined itself, and its label is an implementation term no
  // person should be asked (live acceptance 2026-10-16: "main strategy or a
  // different one?" asked three times).
  fields: {
    [INVESTOR_STEPS.investorType]: {
      rank: 1,
      concept: "investor.type",
      priority: "ESSENTIAL",
      label: "How you invest",
      seconds: 10,
    },
    [INVESTOR_STEPS.organisationName]: {
      rank: 0,
      concept: "organisation.name",
      priority: "ESSENTIAL",
      label: "Firm",
      seconds: 10,
    },
    [INVESTOR_WEBSITE_STEP]: {
      // Saved when the investor gives it; never asked for ahead of the
      // mandate, which is what Discover needs.
      concept: "investor.website",
      priority: "OPTIONAL",
      label: "Firm website",
      seconds: 10,
    },
    [INVESTOR_STEPS.businessTitle]: {
      // Asked (or declined) early: the journey resolves the mandate step
      // only once the cursor passes this one (live acceptance 2026-10-16).
      concept: "person.title",
      priority: "IMPORTANT",
      rank: 7,
      label: "Your role",
      seconds: 10,
    },
    [INVESTOR_STEPS.deploymentStatus]: {
      rank: 6,
      concept: "investor.deployment_status",
      priority: "ESSENTIAL",
      label: "Deploying now",
      // A judgement about their current state: asked, never read in.
      askOnly: true,
      seconds: 10,
    },
    [INVESTOR_STEPS.stages]: {
      rank: 2,
      concept: "mandate.stages",
      priority: "ESSENTIAL",
      label: "Stages",
      seconds: 15,
    },
    [INVESTOR_STEPS.currency]: {
      rank: 5,
      concept: "mandate.currency",
      priority: "ESSENTIAL",
      label: "Cheque currency",
      seconds: 5,
    },
    [INVESTOR_STEPS.chequeMin]: {
      concept: "mandate.cheque_min",
      priority: "IMPORTANT",
      label: "Minimum cheque",
      seconds: 10,
    },
    [INVESTOR_STEPS.chequeTypical]: {
      concept: "mandate.cheque_typical",
      priority: "IMPORTANT",
      label: "Typical cheque",
      seconds: 10,
    },
    [INVESTOR_STEPS.chequeMax]: {
      concept: "mandate.cheque_max",
      priority: "IMPORTANT",
      label: "Maximum cheque",
      seconds: 10,
    },
    [INVESTOR_STEPS.investmentRole]: {
      concept: "mandate.investment_role",
      priority: "IMPORTANT",
      label: "Lead or follow",
      seconds: 10,
    },
    [INVESTOR_STEPS.geography]: {
      rank: 4,
      concept: "mandate.geography",
      priority: "ESSENTIAL",
      label: "Geography",
      seconds: 20,
    },
    [INVESTOR_STEPS.geographyStrength]: {
      concept: "mandate.geography_strength",
      priority: "OPTIONAL",
      label: "Geography firmness",
      seconds: 5,
    },
    [INVESTOR_STEPS.sectors]: {
      rank: 3,
      concept: "mandate.sectors",
      priority: "ESSENTIAL",
      label: "Sectors",
      seconds: 25,
    },
    [INVESTOR_STEPS.sectorStrength]: {
      concept: "mandate.sector_strength",
      priority: "OPTIONAL",
      label: "Sector firmness",
      seconds: 5,
    },
    [INVESTOR_STEPS.sectorsAvoid]: {
      concept: "mandate.sectors_avoid",
      priority: "IMPORTANT",
      label: "Sectors you'd rather not see",
      seconds: 15,
    },
    [INVESTOR_STEPS.businessModels]: {
      concept: "mandate.business_models",
      priority: "IMPORTANT",
      label: "Business models",
      seconds: 15,
    },
    [INVESTOR_STEPS.customerTypes]: {
      concept: "mandate.customer_types",
      priority: "IMPORTANT",
      label: "Customer types",
      seconds: 15,
    },
    [INVESTOR_STEPS.capitalIntensity]: {
      concept: "mandate.capital_intensity",
      priority: "OPTIONAL",
      label: "Capital intensity",
      seconds: 10,
    },
    [INVESTOR_STEPS.regulatoryAppetite]: {
      concept: "mandate.regulatory_appetite",
      priority: "OPTIONAL",
      label: "Regulated markets",
      seconds: 10,
    },
    [INVESTOR_STEPS.revenueState]: {
      concept: "mandate.revenue_state",
      priority: "IMPORTANT",
      label: "Revenue expectations",
      seconds: 10,
    },
    [INVESTOR_STEPS.founderPreferences]: {
      concept: "mandate.founder_preferences",
      priority: "OPTIONAL",
      label: "Founding team",
      seconds: 15,
    },
    [INVESTOR_STEPS.founderStrength]: {
      concept: "mandate.founder_strength",
      priority: "OPTIONAL",
      label: "Founding-team firmness",
      seconds: 5,
    },
    [INVESTOR_STEPS.greenFlags]: {
      concept: "mandate.green_flags",
      priority: "OPTIONAL",
      label: "Green flags",
      seconds: 15,
    },
    [INVESTOR_STEPS.greenFlagStrength]: {
      concept: "mandate.green_flag_strength",
      priority: "OPTIONAL",
      label: "Green-flag firmness",
      seconds: 5,
    },
    [INVESTOR_STEPS.customCriteria]: {
      concept: "mandate.custom_criteria",
      priority: "OPTIONAL",
      label: "Other criteria",
      seconds: 30,
    },
    [INVESTOR_STEPS.avoid]: {
      concept: "mandate.avoid",
      priority: "IMPORTANT",
      label: "Rather not see",
      seconds: 15,
    },
    [INVESTOR_STEPS.hardExclusions]: {
      concept: "mandate.hard_exclusions",
      priority: "IMPORTANT",
      label: "Never show",
      seconds: 15,
    },
    [INVESTOR_STEPS.sectorExclusions]: {
      concept: "mandate.sector_exclusions",
      priority: "OPTIONAL",
      label: "Excluded sectors",
      seconds: 10,
    },
    [INVESTOR_STEPS.portfolio]: {
      concept: "investor.portfolio",
      priority: "OPTIONAL",
      label: "Portfolio",
      seconds: 30,
    },
    [INVESTOR_STEPS.discoveryMode]: {
      rank: 8,
      concept: "discovery.mode",
      priority: "ESSENTIAL",
      label: "Discovery",
      seconds: 10,
    },
    [INVESTOR_STEPS.inboundPreference]: {
      rank: 9,
      concept: "discovery.inbound_preference",
      priority: "ESSENTIAL",
      label: "Inbound",
      // A judgement about their current state: asked, never read in.
      askOnly: true,
      seconds: 10,
    },
    [INVESTOR_STEPS.additionalContext]: {
      concept: "mandate.additional_context",
      priority: "OPTIONAL",
      label: "Anything we missed",
      seconds: 30,
    },
  },
};
