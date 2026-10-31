import type { OnboardingCoverageProfile } from "@capital-q/onboarding";

import { FOUNDER_STEPS } from "./founder-v1.js";
import { FOUNDER_PROFILE_SECTIONS } from "./profile-sections.js";
import { FOUNDER_FINANCIAL_STEPS } from "./founder-v4.js";

/**
 * Founder coverage profile (lane ob1, 2026-10-16): the journey's own
 * annotation of its definition's steps for the coverage model. It adds no
 * question and changes no step; required/optional and branching stay the
 * definition's. Confirmation checkpoints (review, raise confirm, snapshot)
 * and the intent step are not fields: they are the journey's own moves.
 *
 * ESSENTIAL: what a useful first company profile and Discover need.
 * IMPORTANT: materially better matching; asked once essentials are in.
 * OPTIONAL: offered, never pressed. Founder-private financials stay
 * OPTIONAL: never demanded to start, and their visibility is the Context
 * Firewall's, not this profile's.
 */
const FINANCIAL_EVIDENCE = [
  "MANAGEMENT_ACCOUNTS",
  "FINANCIAL",
  "FINANCIAL_MODEL",
] as const;

/**
 * The company profile sections a step of their own holds (owner template,
 * profile-sections.ts): asked after the essentials, in the order investors
 * need them, only when the deck and the pitch did not answer them. The
 * first five investors need are IMPORTANT; the rest OPTIONAL; Closing is
 * never asked.
 */
const PROFILE_SECTION_FIELDS: OnboardingCoverageProfile["fields"] =
  Object.fromEntries(
    FOUNDER_PROFILE_SECTIONS.flatMap((section) =>
      section.stepKeys
        .filter((key) => key.startsWith("F9."))
        .map((key) => [
          key,
          {
            concept: `company.profile.${section.key}`,
            priority: section.investorRank <= 5 ? "IMPORTANT" : "OPTIONAL",
            label: section.title,
            rank: 20 + section.investorRank,
            seconds: 30,
            ...(section.askable ? {} : { askable: false }),
          },
        ]),
    ),
  );

export const FOUNDER_COVERAGE_PROFILE: OnboardingCoverageProfile = {
  journeyType: "founder",
  version: "founder-coverage-2026-10-16.2",
  registrationSeeds: { organisationName: FOUNDER_STEPS.companyName },
  fields: {
    [FOUNDER_STEPS.companyName]: {
      rank: 0,
      concept: "company.name",
      priority: "ESSENTIAL",
      label: "Company name",
      seconds: 10,
    },
    [FOUNDER_STEPS.website]: {
      concept: "company.website",
      priority: "IMPORTANT",
      label: "Website",
      seconds: 10,
    },
    [FOUNDER_STEPS.country]: {
      rank: 3,
      concept: "company.country",
      priority: "ESSENTIAL",
      label: "Country",
      seconds: 10,
    },
    [FOUNDER_STEPS.stage]: {
      rank: 2,
      concept: "company.stage",
      priority: "ESSENTIAL",
      label: "Stage",
      seconds: 15,
    },
    [FOUNDER_STEPS.description]: {
      rank: 1,
      concept: "company.description",
      priority: "ESSENTIAL",
      label: "What the company does",
      seconds: 45,
    },
    [FOUNDER_STEPS.categories]: {
      concept: "company.categories",
      priority: "ESSENTIAL",
      label: "Sector",
      seconds: 20,
    },
    [FOUNDER_STEPS.materials]: {
      satisfiedByDocuments: [
        "PITCH_DECK",
        "COMPANY_PROFILE",
        "PRODUCT",
        "FINANCIAL_MODEL",
        "MANAGEMENT_ACCOUNTS",
      ],
      concept: "company.materials",
      priority: "IMPORTANT",
      label: "Deck or materials",
      seconds: 20,
    },
    [FOUNDER_STEPS.founderRole]: {
      rank: 4,
      concept: "person.role",
      priority: "ESSENTIAL",
      label: "Your role",
      seconds: 10,
    },
    [FOUNDER_STEPS.founderCount]: {
      rank: 6,
      concept: "team.founder_count",
      priority: "ESSENTIAL",
      label: "Founders",
      seconds: 10,
    },
    [FOUNDER_STEPS.fullTime]: {
      rank: 7,
      concept: "team.full_time",
      priority: "ESSENTIAL",
      label: "Full-time",
      seconds: 10,
    },
    [FOUNDER_STEPS.teamSize]: {
      rank: 5,
      concept: "team.size",
      priority: "ESSENTIAL",
      label: "Team size",
      seconds: 10,
    },
    [FOUNDER_STEPS.functions]: {
      concept: "team.functions",
      priority: "OPTIONAL",
      label: "Team coverage",
      seconds: 20,
    },
    [FOUNDER_STEPS.signal]: {
      rank: 8,
      concept: "traction.signal",
      priority: "ESSENTIAL",
      label: "Early signal",
      seconds: 20,
    },
    [FOUNDER_STEPS.pilots]: {
      concept: "traction.pilots",
      priority: "OPTIONAL",
      label: "Pilots",
      seconds: 10,
    },
    [FOUNDER_STEPS.revenueStatus]: {
      rank: 8,
      concept: "traction.revenue_status",
      priority: "ESSENTIAL",
      label: "Revenue",
      seconds: 20,
    },
    [FOUNDER_STEPS.customers]: {
      concept: "traction.customers",
      priority: "IMPORTANT",
      label: "Paying customers",
      evidenceWanted: ["CUSTOMER", ...FINANCIAL_EVIDENCE],
      seconds: 10,
    },
    [FOUNDER_STEPS.growth]: {
      concept: "traction.growth",
      priority: "IMPORTANT",
      label: "Growth",
      seconds: 15,
    },
    [FOUNDER_FINANCIAL_STEPS.currency]: {
      concept: "financials.currency",
      priority: "OPTIONAL",
      label: "Reporting currency",
      seconds: 10,
    },
    [FOUNDER_FINANCIAL_STEPS.monthlyRevenue]: {
      concept: "financials.monthly_revenue",
      priority: "OPTIONAL",
      label: "Monthly revenue",
      evidenceWanted: FINANCIAL_EVIDENCE,
      seconds: 15,
    },
    [FOUNDER_FINANCIAL_STEPS.revenueTrend]: {
      concept: "financials.revenue_trend",
      priority: "OPTIONAL",
      label: "Revenue trend",
      seconds: 10,
    },
    [FOUNDER_FINANCIAL_STEPS.grossMargin]: {
      concept: "financials.gross_margin",
      priority: "OPTIONAL",
      label: "Gross margin",
      seconds: 15,
    },
    [FOUNDER_FINANCIAL_STEPS.monthlyBurn]: {
      concept: "financials.monthly_burn",
      priority: "OPTIONAL",
      label: "Monthly burn",
      seconds: 15,
    },
    [FOUNDER_FINANCIAL_STEPS.cash]: {
      concept: "financials.cash",
      priority: "OPTIONAL",
      label: "Cash",
      seconds: 15,
    },
    [FOUNDER_FINANCIAL_STEPS.runway]: {
      concept: "financials.runway_months",
      priority: "OPTIONAL",
      label: "Runway",
      seconds: 10,
    },
    [FOUNDER_STEPS.raising]: {
      rank: 9,
      concept: "capital.raising",
      priority: "ESSENTIAL",
      label: "Raising now",
      // A judgement about their current state: asked, never read in.
      askOnly: true,
      seconds: 10,
    },
    [FOUNDER_STEPS.currency]: {
      rank: 11,
      concept: "capital.currency",
      priority: "ESSENTIAL",
      label: "Raise currency",
      seconds: 5,
    },
    [FOUNDER_STEPS.targetAmount]: {
      rank: 10,
      concept: "capital.target_amount",
      priority: "ESSENTIAL",
      label: "Raise target",
      seconds: 15,
    },
    [FOUNDER_STEPS.instrument]: {
      concept: "capital.instrument",
      priority: "IMPORTANT",
      label: "Instrument",
      seconds: 10,
    },
    [FOUNDER_STEPS.timeframe]: {
      concept: "capital.timeframe",
      priority: "IMPORTANT",
      label: "Close timing",
      seconds: 10,
    },
    [FOUNDER_STEPS.useOfFunds]: {
      concept: "capital.use_of_funds",
      priority: "IMPORTANT",
      label: "Use of funds",
      seconds: 20,
    },
    [FOUNDER_FINANCIAL_STEPS.minCheque]: {
      concept: "capital.min_cheque",
      priority: "OPTIONAL",
      label: "Smallest cheque",
      seconds: 10,
    },
    [FOUNDER_STEPS.followUp]: {
      concept: "company.follow_up",
      priority: "OPTIONAL",
      label: "Anything else",
      seconds: 30,
    },
    ...PROFILE_SECTION_FIELDS,
  },
};
