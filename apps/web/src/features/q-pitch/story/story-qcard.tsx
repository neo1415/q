"use client";

import { PublicCardDtoSchema, type PublicCardDto } from "@capital-q/contracts";

import { PublicCardView } from "@/features/q-card/public-card-view";

/**
 * #48-49: the real Q Card, as its public page renders it (the product's
 * own `PublicCardView` and `QCard`), for the story's fictional demo
 * company. Shown on the Q stage rather than by navigating to `/@handle`,
 * which lives outside the signed-in layout and would end the story.
 *
 * Demonstration data, labelled so. The demo attestation is passed as
 * `demoAttested`, so the card itself says it is not Capital Q's check.
 * Nothing here is fetched: the fixture is parsed by the public contract.
 */
export const STORY_QCARD: PublicCardDto = PublicCardDtoSchema.parse({
  kind: "CARD",
  handle: "harbourline",
  subjectType: "COMPANY",
  name: "Harbourline Cargo",
  // Fictional figures in the card's own shapes (S6's harness fixtures),
  // each with how it is known and supported: never a real company's.
  fields: [
    {
      key: "shortDescription",
      value:
        "Fictional demonstration company: freight booking for small exporters.",
      scope: "public_external",
    },
    { key: "currentStageCode", value: "seed", scope: "public_external" },
    { key: "headquartersCity", value: "Mombasa", scope: "public_external" },
    { key: "headquartersCountry", value: "KE", scope: "public_external" },
    {
      key: "tractionMetrics",
      value: "Revenue, Shippers, Growth",
      scope: "public_external",
      detail: {
        kind: "METRICS",
        metrics: [
          {
            label: "Revenue",
            amount: "420000",
            currency: "USD",
            unit: null,
            period: "Trailing 12 months",
            truthClass: "USER_CLAIM",
            evidenceStatus: "DOCUMENT_SUPPORTED",
          },
          {
            label: "Shippers",
            amount: "140",
            currency: null,
            unit: "shippers",
            period: null,
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          },
          {
            label: "Growth",
            amount: "12",
            currency: null,
            unit: "%",
            period: "Month on month",
            truthClass: "ESTIMATE",
            evidenceStatus: "SELF_REPORTED",
          },
        ],
      },
    },
    {
      key: "currentRaise",
      value: "1500000 USD",
      scope: "public_external",
      detail: {
        kind: "RAISE",
        stageCode: "seed",
        instrumentCode: "safe",
        target: { amount: "1500000", currency: "USD" },
        useOfFunds: "Two new port corridors and a customs desk.",
        targetCloseDate: "2027-03-31",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
    },
    {
      key: "investabilitySummary",
      value: "Developing",
      scope: "network_visible",
      detail: {
        kind: "INTELLIGENCE",
        status: "ASSESSED",
        band: "Developing",
        confidence: "Low confidence",
        strengths: ["Traction", "Market"],
        areasScored: 7,
        areasTotal: 12,
        method: "Demonstration",
        assessedAt: "2026-10-18T09:00:00.000Z",
      },
    },
    {
      key: "relationshipSummary",
      value: "Connected: 3",
      scope: "network_visible",
      detail: {
        kind: "RELATIONSHIPS",
        stages: [
          { label: "Interest expressed", count: 5 },
          { label: "Connected", count: 3 },
          { label: "Met", count: 1 },
        ],
      },
    },
  ],
  verified: ["ORGANISATION_VERIFIED"],
  demoAttested: ["ORGANISATION_VERIFIED"],
  audience: "PARTICIPANT",
  indexable: false,
});

export function StoryQCard() {
  return (
    <div className="cq-story-qcard-page" data-story-qcard>
      <PublicCardView card={STORY_QCARD} displayUrl="@harbourline" />
    </div>
  );
}
