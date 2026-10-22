"use client";

import {
  INVESTABILITY_BAND_LABELS,
  PublicCardDtoSchema,
  type PublicCardDto,
} from "@capital-q/contracts";

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
function capitalQ() {
  const found = demo.companies.find((entry) => entry.key === "capital-q");
  if (found === undefined) throw new Error("Q Story: no Capital Q fixture");
  const { raise, qCard } = found;
  if (raise === null || qCard === null) {
    throw new Error("Q Story: the Capital Q fixture has no raise or card");
  }
  return { ...found, raise, qCard };
}
const company = capitalQ();
const { raise, qCard, handle } = company;

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

// The seed's claims are the company's own (USER_CLAIM, SELF_REPORTED).
const OWN = { truthClass: "USER_CLAIM", evidenceStatus: "SELF_REPORTED" };

/** A claim's value as the card's METRICS row (money, count or percent). */
function metric(key: string, label: string, period: string | null) {
  const value = claim(key);
  const money = "amount" in value && "currency" in value;
  return {
    label,
    amount: money
      ? value.amount
      : "value" in value
        ? String(value.value)
        : null,
    currency: money ? value.currency : null,
    unit: !money && value.kind === "PERCENT" ? "%" : null,
    period,
    ...OWN,
  };
}

/** The founder's headshot, served with the story's own media. */
const DAVID_PHOTO = "/story-media/team/david-founder.jpg";

/** The card, for this page's origin (a card's photos are absolute URLs). */
export function storyQCard(origin: string): PublicCardDto {
  return PublicCardDtoSchema.parse({
    kind: "CARD",
    handle,
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
          "Annual recurring revenue, Monthly revenue, Growth, Paying customers, Active users, Gross margin, Net revenue retention, Team size",
        scope: qCard.tractionMetrics,
        detail: {
          kind: "METRICS",
          // S6's order: what the seeded card shows (at most 8).
          metrics: [
            metric("financial.arr", "Annual recurring revenue", "Run-rate"),
            metric("financial.monthly_revenue", "Monthly revenue", null),
            metric("traction.growth", "Growth", "June to September 2026"),
            metric("customers.paying_accounts", "Paying customers", null),
            metric("traction.active_users", "Active users", null),
            metric("financial.gross_margin", "Gross margin", null),
            metric("financial.nrr", "Net revenue retention", null),
            metric("team.employee_count", "Team size", null),
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
        // Q's reading of the seeded company with its data room (S6 #324,
        // #325; deck confirmed), as the deterministic scorer gives it on the
        // seeded data: STRONG, Low confidence, 4 of 8 areas. Words only, no
        // number, in the product's own band label.
        key: "investabilitySummary",
        value: INVESTABILITY_BAND_LABELS.STRONG,
        scope: qCard.investabilitySummary,
        detail: {
          kind: "INTELLIGENCE",
          status: "ASSESSED",
          band: INVESTABILITY_BAND_LABELS.STRONG,
          confidence: "Low confidence",
          strengths: [],
          areasScored: 4,
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
            // Owner-supplied, used with permission (capital-q-team/README);
            // anyone without one shows initials.
            ...(member.person === "david"
              ? { photoUrl: new URL(DAVID_PHOTO, origin).toString() }
              : {}),
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
}

export function StoryQCard() {
  return (
    <div className="cq-story-qcard-page" data-story-qcard>
      <PublicCardView
        card={storyQCard(window.location.origin)}
        displayUrl={`@${handle}`}
      />
    </div>
  );
}
