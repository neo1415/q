import {
  PREMIERE_CERTIFICATION_LEDGER,
  ATLAS_SCRIPT,
  PREMIERE_SCRIPT,
  SHORT_SCRIPT,
  STORY_BEATS,
  certifyTour,
  type TourScript,
} from "@capital-q/q-pitch";

/**
 * The tour entry's model (owner request 15 Oct): the three ways in and the
 * Feature Atlas chapters, each with its honest certification standing.
 * Pure: the page renders it, tests assert it. A chapter is CERTIFIED when
 * the default gate (PRODUCTION_LIVE_VERIFIED only) admits it; otherwise it
 * runs only as an internal rehearsal of code-verified behaviour.
 */
export type AtlasChapter = {
  readonly chapterId: string;
  readonly title: string;
  readonly standing: "CERTIFIED" | "INTERNAL_ONLY";
  readonly href: string;
};

export type TourOption = {
  readonly key: "story" | "premiere" | "short";
  readonly title: string;
  readonly length: string;
  readonly href: string;
  readonly certifiedScenes: number;
  readonly scenes: number;
};

function admitted(script: TourScript, now: string): ReadonlySet<string> {
  const gate = certifyTour(script, PREMIERE_CERTIFICATION_LEDGER, {
    now,
    staleFeatureIds: [],
    audience: "INTERNAL_REHEARSAL",
  });
  return new Set(gate.scenes.map((s) => s.sceneId));
}

export function tourOptions(now: string): readonly TourOption[] {
  const option = (
    key: TourOption["key"],
    title: string,
    length: string,
    script: TourScript,
  ): TourOption => ({
    key,
    title,
    length,
    href: `/home?qpitch=${key}`,
    certifiedScenes: admitted(script, now).size,
    scenes: script.scenes.length,
  });
  return [
    {
      // v7: the owner's story, told by Q over the real app.
      key: "story",
      title: "Q tells the Capital Q story",
      length: "About 7 minutes",
      href: "/home?qpitch=story&new=1",
      certifiedScenes: 0,
      scenes: STORY_BEATS.length,
    },
    option(
      "premiere",
      "Investor premiere",
      "About 5 to 7 minutes",
      PREMIERE_SCRIPT,
    ),
    option("short", "Two-minute version", "About 2 minutes", SHORT_SCRIPT),
  ];
}

export function atlasChapters(now: string): readonly AtlasChapter[] {
  // The Atlas lists every chapter, the deeper ones included, and opens each
  // in the Atlas tour (the premiere itself is the main cut).
  const ok = admitted(ATLAS_SCRIPT, now);
  return ATLAS_SCRIPT.chapters.map((chapter) => ({
    chapterId: chapter.chapterId,
    title: chapter.title,
    standing: chapter.sceneIds.every((id) => ok.has(id))
      ? "CERTIFIED"
      : "INTERNAL_ONLY",
    href: `/home?qpitch=atlas&chapter=${encodeURIComponent(chapter.chapterId)}`,
  }));
}
