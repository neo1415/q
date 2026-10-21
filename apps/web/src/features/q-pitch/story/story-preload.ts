import {
  BeatAlignmentSchema,
  FIXTURE_ALIGNMENTS,
  STORY_BEATS,
  STORY_PICTURES,
  STORY_ROUTES,
  STORY_SCREENS,
  alignmentFits,
  beatAlignmentPath,
  beatAudioPath,
  screenPath,
  voiceIndexPath,
  type BeatAlignment,
} from "@capital-q/q-pitch";
import { z } from "zod";

import { storyPath, type StoryPathFor } from "./story-pages";

/**
 * Preload everything on entry (plan §1, "game the system"): the render's
 * audio and alignment (decoded), every picture and screenshot (decoded
 * Image objects, held so the browser keeps them), and every story route
 * (router.prefetch). The story starts only once this resolves, so nothing
 * is fetched from the database and no model is called while it plays.
 *
 * Static files only, same origin. A missing render is not an error: the
 * story then plays on fixture timings with the live or silent narrator.
 */

/** Q's own voice ("Sarah"), the render's folder (scripts/q-pitch/render-story.mjs). */
export const STORY_VOICE = "EXAVITQu4vr4xnSDxMaL";

const IndexSchema = z.object({
  version: z.string(),
  voice: z.string(),
  complete: z.boolean(),
});

export type StoryAssets = {
  /** By beat number; every beat has one (rendered, else fixture). */
  readonly alignments: ReadonlyMap<number, BeatAlignment>;
  /** Decoded audio by beat number; empty without a complete render. */
  readonly buffers: ReadonlyMap<number, AudioBuffer>;
  readonly context: AudioContext | null;
  /** Picture and screenshot files that decoded (the rest fall back). */
  readonly images: ReadonlyMap<string, HTMLImageElement>;
  readonly rendered: boolean;
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
}): Promise<StoryAssets> {
  const started = performance.now();
  const voice = input.voice ?? STORY_VOICE;
  // Routes first: the prefetch runs beside everything else.
  for (const route of STORY_ROUTES) {
    const path = (input.pathFor ?? storyPath)(route);
    if (path !== null) input.prefetch(path);
  }
  const index = await fetch(voiceIndexPath(voice), { cache: "force-cache" })
    .then(async (r) => (r.ok ? IndexSchema.parse(await r.json()) : null))
    .catch(() => null);
  const rendered = index?.complete === true;
  const context =
    typeof AudioContext === "undefined"
      ? null
      : new AudioContext({ latencyHint: "playback" });

  const images = new Map<string, HTMLImageElement>();
  const alignments = new Map<number, BeatAlignment>();
  const buffers = new Map<number, AudioBuffer>();
  const files = [
    ...STORY_PICTURES.map((p) => p.file),
    ...STORY_SCREENS.map(screenPath),
  ];
  const tasks: (() => Promise<void>)[] = [
    ...files.map((file) => async () => {
      const image = await decodeImage(file);
      if (image !== null) images.set(file, image);
    }),
  ];
  if (rendered && context !== null) {
    for (const beat of STORY_BEATS) {
      tasks.push(async () => {
        const [alignment, audio] = await Promise.all([
          fetch(beatAlignmentPath(voice, beat), { cache: "force-cache" })
            .then(async (r) => BeatAlignmentSchema.parse(await r.json()))
            .catch(() => null),
          fetch(beatAudioPath(voice, beat), { cache: "force-cache" })
            .then((r) => (r.ok ? r.arrayBuffer() : null))
            .then((bytes) =>
              bytes === null ? null : context.decodeAudioData(bytes),
            )
            .catch(() => null),
        ]);
        if (
          alignment !== null &&
          audio !== null &&
          alignmentFits(beat, alignment)
        ) {
          alignments.set(beat.n, alignment);
          buffers.set(beat.n, audio);
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
  // A partial render never mixes voices mid-story: all beats or none.
  const complete = rendered && buffers.size === STORY_BEATS.length;
  if (!complete) {
    buffers.clear();
    alignments.clear();
  }
  for (const fixture of FIXTURE_ALIGNMENTS) {
    if (!alignments.has(fixture.beat)) alignments.set(fixture.beat, fixture);
  }
  return {
    alignments,
    buffers,
    context: complete
      ? context
      : (void context?.close().catch(() => undefined), null),
    images,
    rendered: complete,
    ms: Math.round(performance.now() - started),
  };
}
