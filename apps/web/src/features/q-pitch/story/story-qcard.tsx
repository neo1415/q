"use client";

import { PublicCardDtoSchema, type PublicCardDto } from "@capital-q/contracts";

import { PublicCardView } from "@/features/q-card/public-card-view";

import demo from "../../../../../../supabase/seed-assets/demo-companies/companies.json";

/**
 * #48-49: Capital Q's own Q Card (owner, 22 Oct), as its public page
 * renders it (the product's own `PublicCardView` and `QCard`). Shown on
 * the Q stage rather than by navigating to `/@handle`, which lives outside
 * the signed-in layout and would end the story.
 *
 * One source with the seed (S6, supabase/seed-assets/demo-companies): the
 * company, its numbers, raise and team are read from the same fixture the
 * seed writes, so the story and the seeded card cannot drift. Demonstration
 * data, and the card says so (`demonstration`). Nothing is fetched; the
 * card is parsed by the public contract.
 */
const company = demo.companies.find((entry) => entry.key === "capital-q");
if (company === undefined) throw new Error("Q Story: no Capital Q fixture");
const { raise, qCard, handle } = company;
if (raise === null || qCard === null) {
  throw new Error("Q Story: the Capital Q fixture has no raise or card");
}

const claim = (key: string) => {
  const found = company.claims.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`Q Story: no claim ${key}`);
  return found.value;
};

type Person = keyof typeof demo.people;
const personName = (key: string): string => {
  const person = demo.people[key as Person] as {
    readonly givenName?: string;
    readonly familyName?: string;
    readonly familyNameConfirmed?: boolean;
    readonly displayName?: string;
  };
  if (person.displayName !== undefined) return person.displayName;
  // A surname is printed only once the owner has confirmed it.
  return person.familyNameConfirmed === true
    ? `${person.givenName ?? ""} ${person.familyName ?? ""}`.trim()
    : (person.givenName ?? "");
};

const mrr = claim("financial.monthly_revenue");
const paying = claim("customers.paying_accounts");
const users = claim("traction.active_users");
const growth = claim("traction.growth");
// The seed's claims are the company's own (USER_CLAIM, SELF_REPORTED).
const OWN = { truthClass: "USER_CLAIM", evidenceStatus: "SELF_REPORTED" };

export const STORY_QCARD: PublicCardDto = PublicCardDtoSchema.parse({
  kind: "CARD",
  handle: company.handle,
  subjectType: "COMPANY",
  name: company.canonicalName,
  fields: [
    {
      key: "shortDescription",
      value: company.shortDescription,
      scope: "public_external",
    },
    {
      key: "currentStageCode",
      value: company.stageCode,
      scope: "public_external",
    },
    {
      key: "headquartersCity",
      value: company.headquartersCity,
      scope: "public_external",
    },
    {
      key: "headquartersCountry",
      value: company.headquartersCountry,
      scope: "public_external",
    },
    {
      key: "tractionMetrics",
      value:
        "Monthly recurring revenue, Paying customers, Active users, Growth",
      scope: qCard.tractionMetrics,
      detail: {
        kind: "METRICS",
        metrics: [
          {
            label: "Monthly recurring revenue",
            amount: "amount" in mrr ? mrr.amount : null,
            currency: "currency" in mrr ? mrr.currency : null,
            unit: null,
            period: "September 2026",
            ...OWN,
          },
          {
            label: "Paying customers",
            amount: "value" in paying ? String(paying.value) : null,
            currency: null,
            unit: "investor firms",
            period: null,
            ...OWN,
          },
          {
            label: "Active users",
            amount: "value" in users ? String(users.value) : null,
            currency: null,
            unit: "users",
            period: null,
            ...OWN,
          },
          {
            label: "Growth",
            amount: "value" in growth ? String(growth.value) : null,
            currency: null,
            unit: "%",
            period: "June to September 2026",
            ...OWN,
          },
        ],
      },
    },
    {
      key: "currentRaise",
      value: `${raise.target.amount} ${raise.target.currency}`,
      scope: qCard.currentRaise,
      detail: {
        kind: "RAISE",
        stageCode: raise.stageCode,
        instrumentCode: raise.instrumentCode,
        target: raise.target,
        useOfFunds: raise.useOfFunds,
        targetCloseDate: raise.targetCloseDate,
        ...OWN,
      },
    },
    {
      // Q's reading of the seeded company, as the deterministic scorer
      // gives it after seeding (S6): words only, no number.
      key: "investabilitySummary",
      value: "Investable",
      scope: qCard.investabilitySummary,
      detail: {
        kind: "INTELLIGENCE",
        status: "ASSESSED",
        band: "Investable",
        confidence: "Low confidence",
        strengths: [],
        areasScored: 1,
        areasTotal: 8,
        method: "FDN InvestIQ v1",
        assessedAt: null,
      },
    },
    {
      // Story only (owner, 22 Oct: "B, do 12"): no relationship is seeded
      // or written anywhere; the live card reads "Not shared yet" until
      // real investor conversations exist.
      key: "relationshipSummary",
      value: "Investor conversations: 12",
      scope: qCard.relationshipSummary,
      detail: {
        kind: "RELATIONSHIPS",
        stages: [{ label: "Investor conversations", count: 12 }],
      },
    },
    {
      key: "team",
      value: "Team",
      scope: qCard.team,
      detail: {
        kind: "TEAM",
        members: [...company.founders, ...company.team].map((member) => ({
          name: personName(member.person),
          role: member.title,
        })),
      },
    },
  ],
  verified: [],
  demoAttested: [],
  demonstration: true,
  audience: "PARTICIPANT",
  indexable: false,
});

export function StoryQCard() {
  return (
    <div className="cq-story-qcard-page" data-story-qcard>
      <PublicCardView card={STORY_QCARD} displayUrl={`@${handle}`} />
    </div>
  );
}
