import {
  STORY_LEDGER,
  certifyStory,
  storyOwnerApproved,
} from "@capital-q/q-pitch";

/**
 * The tour entry's model: what the Q Pitch page offers, with its honest
 * certification standing. Pure: the page renders it, tests assert it.
 *
 * The v7 story is the one presentation (owner, 21 Oct). The v5 premiere,
 * two-minute cut and Feature Atlas are retired; their receipts live on as
 * ledger data the story's claims rest on.
 */
export type TourOption = {
  readonly key: "story";
  readonly title: string;
  readonly length: string;
  readonly href: string;
  /** Product beats whose every claim is certified, of all product beats. */
  readonly certifiedScenes: number;
  readonly scenes: number;
};

function storyStanding(now: string): {
  readonly certifiedScenes: number;
  readonly scenes: number;
} {
  const actor = STORY_LEDGER[0]?.actorContext;
  if (actor === undefined) return { certifiedScenes: 0, scenes: 0 };
  const gate = certifyStory({
    now,
    actor,
    staleFeatureIds: [],
    ownerApproved: storyOwnerApproved(),
  });
  return {
    certifiedScenes: gate.certifiedProductBeats,
    scenes: gate.productBeats,
  };
}

export function tourOptions(now: string): readonly TourOption[] {
  return [
    {
      // v7: the owner's story, told by Q over the real app.
      key: "story",
      title: "Q tells the Capital Q story",
      length: "About 7 minutes",
      href: "/home?qpitch=story&new=1",
      ...storyStanding(now),
    },
  ];
}
