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
  fields: [
    {
      key: "shortDescription",
      value:
        "Fictional demonstration company: freight booking for small exporters.",
      scope: "public_external",
    },
    { key: "currentStageCode", value: "seed", scope: "public_external" },
    { key: "headquartersCity", value: "Mombasa", scope: "public_external" },
    { key: "headquartersCountry", value: "ke", scope: "public_external" },
    { key: "foundedDate", value: "2022-03-01", scope: "network_visible" },
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
