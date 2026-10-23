import {
  STORY_CLAIMS,
  STORY_EDITIONS,
  STORY_LEDGER,
  certifyStory,
  editionBeats,
  storyOwnerApproved,
  type StoryEditionId,
} from "@capital-q/q-pitch";

/**
 * The tour entry's model: what the Q Pitch page offers, with its honest
 * certification standing. Pure: the page renders it, tests assert it.
 *
 * The v7 story is the one presentation (owner, 21 Oct), in three cuts
 * (owner, 22 Oct): everyone, investors, founders. The v5 premiere,
 * two-minute cut and Feature Atlas are retired; their receipts live on as
 * ledger data the story's claims rest on.
 */
export type TourOption = {
  readonly key: "story" | "story-investor" | "story-founder";
  /** The audience the cut is for: Everyone, Investors, Founders. */
  readonly title: string;
  readonly length: string;
  readonly href: string;
  /** Product beats whose every claim is certified, of all product beats. */
  readonly certifiedScenes: number;
  readonly scenes: number;
};

function storyStanding(
  now: string,
  edition: StoryEditionId,
): {
  readonly certifiedScenes: number;
  readonly scenes: number;
} {
  const actor = STORY_LEDGER[0]?.actorContext;
  if (actor === undefined) return { certifiedScenes: 0, scenes: 0 };
  const cut = STORY_EDITIONS[edition];
  const gate = certifyStory(
    {
      now,
      actor,
      staleFeatureIds: [],
      ownerApproved: storyOwnerApproved(cut.version),
    },
    STORY_CLAIMS,
    STORY_LEDGER,
    editionBeats(cut),
  );
  return {
    certifiedScenes: gate.certifiedProductBeats,
    scenes: gate.productBeats,
  };
}

/**
 * Running times of the recorded masters (Lily): the cut's audio plus the
 * story's own pauses between beats. The investor cut is under 4:00, a
 * hard limit.
 */
export const STORY_LENGTHS: Readonly<Record<StoryEditionId, string>> = {
  FULL: "About 7 minutes",
  INVESTOR: "Under 4 minutes",
  FOUNDER: "About 4½ minutes",
};

export function tourOptions(now: string): readonly TourOption[] {
  return (["FULL", "INVESTOR", "FOUNDER"] as const).map((edition) => ({
    key:
      edition === "FULL"
        ? "story"
        : edition === "INVESTOR"
          ? "story-investor"
          : "story-founder",
    title: STORY_EDITIONS[edition].label,
    length: STORY_LENGTHS[edition],
    href:
      edition === "FULL"
        ? "/home?qpitch=story&new=1"
        : `/home?qpitch=story&new=1&edition=${edition.toLowerCase()}`,
    ...storyStanding(now, edition),
  }));
}
