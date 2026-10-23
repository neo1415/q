import { STORY_BEATS, type StoryBeat } from "./beats.js";
import { storyRoutes } from "./controls.js";
import { STORY_PICTURES } from "./pictures.js";
import type { StoryRoute } from "./acts.js";

/**
 * Everything the story needs, known before it starts (plan §1, Preload):
 * the beat table (in code), each beat's audio and alignment, every picture
 * and every route. The host loads all of it on entry and starts only when
 * it is in memory; nothing is fetched from the database and no model is
 * called while the story plays.
 */
/**
 * Static and public: marketing narration and credited stock pictures,
 * nothing private. Kept outside `/q-pitch/*`, which the session proxy
 * guards, so a signed-out page (a future landing) can play the story too
 * (coordinator, 21 Oct).
 */
export const STORY_ASSET_ROOT = "/story-media" as const;

/** Voice folders are ElevenLabs voice ids (or "fixture"), nothing else. */
export const STORY_VOICE_ID = /^[A-Za-z0-9]{8,40}$/u;

export type StoryManifest = {
  readonly voice: string;
  readonly audio: readonly string[];
  readonly alignment: readonly string[];
  readonly pictures: readonly string[];
  readonly screens: readonly string[];
  readonly routes: readonly StoryRoute[];
};

export function beatAudioPath(voice: string, beat: StoryBeat): string {
  return `${STORY_ASSET_ROOT}/${voice}/${beat.id}.mp3`;
}

export function beatAlignmentPath(voice: string, beat: StoryBeat): string {
  return `${STORY_ASSET_ROOT}/${voice}/${beat.id}.json`;
}

/** The index the render script writes beside the audio: which beats exist. */
export function voiceIndexPath(voice: string): string {
  return `${STORY_ASSET_ROOT}/${voice}/index.json`;
}

/** #51's talking-speed montage: one cached screenshot per word. */
export const STORY_SCREENS = [
  "discovery",
  "inbound",
  "intelligence",
  "readiness",
  "matching",
  "data",
  "relationships",
  "execution",
] as const;

export function screenPath(name: (typeof STORY_SCREENS)[number]): string {
  return `${STORY_ASSET_ROOT}/screens/${name}.jpg`;
}

/**
 * The story's product pages as stills, for a viewer the story is not
 * certified to run live for (any account but the ledger's demo actor):
 * pictures of the same fictional demo pages, so the story never opens the
 * viewer's own pages or reads their data. Home is the viewer's own page
 * already, so it has no still.
 */
export type StoryStillRoute = Exclude<StoryRoute, "home">;
export const STORY_STILL_ROUTES: readonly StoryStillRoute[] = [
  "discover",
  "capital-mandate",
  "company-diligence",
  "relationship-prep",
  "gateq-gate",
  "gateq-application",
  "gateq-inbox",
];

export function stillPath(route: StoryStillRoute): string {
  return `${STORY_ASSET_ROOT}/pages/${route}.jpg`;
}

export function storyManifest(
  voice: string,
  beats: readonly StoryBeat[] = STORY_BEATS,
): StoryManifest {
  if (voice !== "fixture" && !STORY_VOICE_ID.test(voice)) {
    throw new Error("Q Story: not a voice id");
  }
  return {
    voice,
    audio:
      voice === "fixture"
        ? []
        : beats.map((beat) => beatAudioPath(voice, beat)),
    alignment:
      voice === "fixture"
        ? []
        : beats.map((beat) => beatAlignmentPath(voice, beat)),
    pictures: STORY_PICTURES.map((picture) => picture.file),
    screens: STORY_SCREENS.map(screenPath),
    routes: storyRoutes(beats),
  };
}
