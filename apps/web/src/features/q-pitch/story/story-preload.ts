import {
  BeatAlignmentSchema,
  FIXTURE_ALIGNMENTS,
  STORY_BEATS,
  STORY_PICTURES,
  STORY_ROUTES,
  STORY_SCREENS,
  STORY_STILL_ROUTES,
  alignmentFits,
  STORY_ASSET_ROOT,
  screenPath,
  stillPath,
  voiceIndexPath,
  type BeatAlignment,
} from "@capital-q/q-pitch";
import { z } from "zod";

import { AUDIO_AHEAD, StoryAudioBank } from "./story-audio-bank";
import { storyPath, type StoryPathFor } from "./story-pages";

/**
 * Preload on entry (plan §1, "game the system"): every beat's timings, the
 * first beats' audio (decoded), every picture and screenshot (decoded
 * Image objects, held so the browser keeps them), and every story route
 * (router.prefetch). The rest of the audio follows a few beats ahead
 * through the budgeted controller (story-audio-bank.ts). Nothing is
 * fetched from the database and no model is called while the story plays.
 *
 * Static files only, same origin. A missing render is not an error: the
 * story then plays on fixture timings with the live or silent narrator.
 */

/**
 * The story's narrator ("Lily", the owner's pick from the voice A/B on
 * 2026-10-22), the render's folder (scripts/q-pitch/render-story.mjs).
 */
export const STORY_VOICE = "pFZP5JQG7iQjIQuC4Bku";

/**
 * The render's index: which beats exist (and the live story's closing
 * question), by their content-hashed names.
 */
const MEDIA_FILE = /^(?:beat-\d{2}|closing)\.[0-9a-f]{10}\.(?:mp3|json)$/u;
const IndexSchema = z.object({
  version: z.string(),
  voice: z.string(),
  complete: z.boolean(),
  files: z
    .record(
      z.string(),
      z.object({
        audio: z.string().regex(MEDIA_FILE),
        alignment: z.string().regex(MEDIA_FILE),
      }),
    )
    .default({}),
});

export type StoryAssets = {
  /** By beat number; every beat has one (rendered, else fixture). */
  readonly alignments: ReadonlyMap<number, BeatAlignment>;
  /** The budgeted audio controller; null without a complete render. */
  readonly bank: StoryAudioBank | null;
  readonly context: AudioContext | null;
  /** Picture and screenshot files that decoded (the rest fall back). */
  readonly images: ReadonlyMap<string, HTMLImageElement>;
  readonly rendered: boolean;
  /** "Do you have any questions?" in the narrator's voice, if rendered. */
  readonly closing: string | null;
  readonly ms: number;
};

export type PreloadProgress = { readonly done: number; readonly total: number };

async function decodeImage(src: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

/** Runs `tasks` with at most `limit` in flight. */
async function pool<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index];
      if (task !== undefined) results[index] = await task();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
}

export async function preloadStory(input: {
  readonly prefetch: (path: string) => void;
  readonly onProgress?: (progress: PreloadProgress) => void;
  readonly signal?: AbortSignal;
  readonly voice?: string;
  readonly pathFor?: StoryPathFor;
  /** The beats in play order (an edition's); default: all 56. */
  readonly order?: readonly number[];
  /** The product pages play as stills (not live): decode them too. */
  readonly stills?: boolean;
}): Promise<StoryAssets> {
  const started = performance.now();
  const voice = input.voice ?? STORY_VOICE;
  // Routes first: the prefetch runs beside everything else.
  for (const route of STORY_ROUTES) {
    const path = (input.pathFor ?? storyPath)(route);
    if (path !== null) input.prefetch(path);
  }
  // The index is the one file fetched fresh: it names the hashed clips.
  const index = await fetch(voiceIndexPath(voice), { cache: "no-cache" })
    .then(async (r) => (r.ok ? IndexSchema.parse(await r.json()) : null))
    .catch(() => null);
  const files = index?.complete === true ? index.files : {};
  const mediaUrl = (file: string) => `${STORY_ASSET_ROOT}/${voice}/${file}`;
  const context =
    typeof AudioContext === "undefined"
      ? null
      : new AudioContext({ latencyHint: "playback" });

  const images = new Map<string, HTMLImageElement>();
  const alignments = new Map<number, BeatAlignment>();
  const pictures = [
    ...STORY_PICTURES.map((p) => p.file),
    ...STORY_SCREENS.map(screenPath),
    ...(input.stills === true ? STORY_STILL_ROUTES.map(stillPath) : []),
  ];
  // What the start waits for: the first beats' audio and every beat's
  // timings (small JSON, immutable). Pictures are not among them: the
  // first word comes within about 2 s of the ask (coordinator, 23 Oct),
  // and the pictures decode while the opening plays.
  const tasks: (() => Promise<void>)[] = [];
  // Audio only for the first beats, the rest through the budgeted
  // controller.
  const bank =
    context === null
      ? null
      : new StoryAudioBank(context, (n) => {
          const id = STORY_BEATS[n - 1]?.id;
          const audio = id === undefined ? undefined : files[id]?.audio;
          return audio === undefined ? null : mediaUrl(audio);
        });
  const order = input.order ?? STORY_BEATS.map((beat) => beat.n);
  bank?.follow(order);
  const firstBeats = new Map<number, AudioBuffer | null>();
  if (bank !== null && Object.keys(files).length > 0) {
    // The opening's audio first: it is the longest wait.
    for (const n of order.slice(0, AUDIO_AHEAD)) {
      tasks.push(async () => {
        firstBeats.set(n, await bank.load(n));
      });
    }
    for (const beat of STORY_BEATS) {
      const file = files[beat.id]?.alignment;
      if (file === undefined) continue;
      tasks.push(async () => {
        const alignment = await fetch(mediaUrl(file), { cache: "force-cache" })
          .then(async (r) => BeatAlignmentSchema.parse(await r.json()))
          .catch(() => null);
        if (alignment !== null && alignmentFits(beat, alignment)) {
          alignments.set(beat.n, alignment);
        }
      });
    }
  }
  let done = 0;
  const total = tasks.length;
  input.onProgress?.({ done, total });
  await pool(
    tasks.map((task) => async () => {
      if (input.signal?.aborted === true) return;
      await task();
      done += 1;
      input.onProgress?.({ done, total });
    }),
    6,
  );
  // After the start's own files, so they never compete with the opening's
  // audio; the map fills while the story plays (a picture not yet decoded
  // simply loads on its own).
  if (input.signal?.aborted !== true) {
    void pool(
      pictures.map((file) => async () => {
        if (input.signal?.aborted === true) return;
        const image = await decodeImage(file);
        if (image !== null) images.set(file, image);
      }),
      3,
    );
  }
  // A partial render never mixes voices mid-story: every beat's timings
  // and the first beats' audio, or the fallback narrators for all of it.
  const complete =
    bank !== null &&
    alignments.size === STORY_BEATS.length &&
    [...firstBeats.values()].every((buffer) => buffer !== null) &&
    firstBeats.size === AUDIO_AHEAD;
  if (!complete) alignments.clear();
  for (const fixture of FIXTURE_ALIGNMENTS) {
    if (!alignments.has(fixture.beat)) alignments.set(fixture.beat, fixture);
  }
  return {
    alignments,
    bank: complete ? bank : null,
    context: complete
      ? context
      : (void context?.close().catch(() => undefined), null),
    images,
    rendered: complete,
    closing:
      complete && files["closing"] !== undefined
        ? mediaUrl(files["closing"].audio)
        : null,
    ms: Math.round(performance.now() - started),
  };
}
