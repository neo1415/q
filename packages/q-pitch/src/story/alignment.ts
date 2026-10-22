import { z } from "zod";

import { PACE_WPM, STORY_BEATS, wordKey, type StoryBeat } from "./beats.js";

/**
 * Word timings for one rendered beat: when each verbatim word starts and
 * ends in that beat's audio. Produced once by the pre-render script from
 * ElevenLabs' "with timestamps" character alignment, stored as static JSON
 * beside the audio, and read by the cue engine and the captions. A fixture
 * alignment (no audio) is computed from the beat's pace for the silent
 * rehearsal and the tests.
 */
export const WordTimingSchema = z
  .object({
    startMs: z.number().min(0),
    endMs: z.number().min(0),
  })
  .strict()
  .refine((w) => w.endMs >= w.startMs, {
    message: "a word ends after it starts",
  });
export type WordTiming = z.infer<typeof WordTimingSchema>;

export const BeatAlignmentSchema = z
  .object({
    beat: z.number().int().min(1).max(56),
    /** "fixture" for computed timings; else the ElevenLabs voice id. */
    voice: z.string().min(1).max(64),
    durationMs: z.number().min(0),
    words: z.array(WordTimingSchema).min(1),
  })
  .strict();
export type BeatAlignment = z.infer<typeof BeatAlignmentSchema>;

/** ElevenLabs' character alignment (`/with-timestamps`), as returned. */
export const ElevenLabsAlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});
export type ElevenLabsAlignment = z.infer<typeof ElevenLabsAlignmentSchema>;

/**
 * Character alignment → one timing per verbatim word. The rendered text
 * carries audio tags and a few presentation changes (renderText), so words
 * are matched on their letters and digits only, in order, skipping every
 * `[tag]` the alignment includes. Throws when the audio's letters do not
 * spell the beat's words: a render that dropped or changed a word must
 * never ship.
 */
export function wordsFromCharacters(
  beat: StoryBeat,
  alignment: ElevenLabsAlignment,
): WordTiming[] {
  const letters: { key: string; start: number; end: number }[] = [];
  let inTag = false;
  alignment.characters.forEach((character, index) => {
    if (character === "[") inTag = true;
    if (!inTag) {
      const key = wordKey(character);
      if (key.length > 0) {
        letters.push({
          key,
          start: alignment.character_start_times_seconds[index] ?? 0,
          end: alignment.character_end_times_seconds[index] ?? 0,
        });
      }
    }
    if (character === "]") inTag = false;
  });
  const timings: WordTiming[] = [];
  let cursor = 0;
  for (const word of beat.words) {
    const key = wordKey(word);
    if (key.length === 0) {
      // A word of punctuation only (none today): it takes the next word's start.
      const at = (letters[cursor]?.start ?? 0) * 1000;
      timings.push({ startMs: at, endMs: at });
      continue;
    }
    let spelled = "";
    const first = letters[cursor];
    let last = first;
    while (spelled.length < key.length && cursor < letters.length) {
      last = letters[cursor];
      spelled += last?.key ?? "";
      cursor += 1;
    }
    if (spelled !== key || first === undefined || last === undefined) {
      throw new Error(
        `Q Story beat ${String(beat.n)}: audio spells "${spelled}" where the script says "${word}"`,
      );
    }
    timings.push({
      startMs: Math.round(first.start * 1000),
      endMs: Math.round(last.end * 1000),
    });
  }
  if (cursor !== letters.length) {
    throw new Error(
      `Q Story beat ${String(beat.n)}: the audio says more than the script`,
    );
  }
  return timings;
}

/** Extra time a word's trailing punctuation or a tag before it holds. */
function pauseAfter(word: string): number {
  if (/\.\.\.$|…$/u.test(word)) return 650;
  if (/[.?!:]["”)]?$/u.test(word)) return 320;
  if (/[,;]$/u.test(word)) return 140;
  return 0;
}
const TAG_PAUSE_MS: Readonly<Record<string, number>> = {
  "[short pause]": 250,
  "[pause]": 500,
  "[long pause]": 1_100,
};

/**
 * Timings computed from the beat's pace and punctuation: the silent
 * rehearsal's clock, and the shape the tests exercise. Labelled `fixture`
 * so nothing mistakes it for a measured render.
 */
export function fixtureAlignment(beat: StoryBeat): BeatAlignment {
  const msPerWord = 60_000 / PACE_WPM[beat.pace];
  const tagPause = new Map<number, number>();
  for (const { at, tag } of beat.tags) {
    tagPause.set(at, (tagPause.get(at) ?? 0) + (TAG_PAUSE_MS[tag] ?? 0));
  }
  let t = 0;
  const words: WordTiming[] = beat.words.map((word, index) => {
    t += tagPause.get(index) ?? 0;
    // Longer words take a little longer; the mean stays at the pace.
    const length = Math.min(1.6, Math.max(0.6, wordKey(word).length / 5));
    const startMs = Math.round(t);
    t += msPerWord * length;
    const endMs = Math.round(t);
    t += pauseAfter(word);
    return { startMs, endMs };
  });
  t += tagPause.get(beat.words.length) ?? 0;
  return {
    beat: beat.n,
    voice: "fixture",
    durationMs: Math.round(t + 200),
    words,
  };
}

export const FIXTURE_ALIGNMENTS: readonly BeatAlignment[] = Object.freeze(
  STORY_BEATS.map(fixtureAlignment),
);

/** The word being spoken at `ms` into the beat (-1 before the first). */
export function wordAt(alignment: BeatAlignment, ms: number): number {
  let low = 0;
  let high = alignment.words.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const word = alignment.words[mid];
    if (word !== undefined && word.startMs <= ms) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** Checks an alignment belongs to its beat (word count) before it is used. */
export function alignmentFits(
  beat: StoryBeat,
  alignment: BeatAlignment,
): boolean {
  return (
    alignment.beat === beat.n && alignment.words.length === beat.words.length
  );
}
