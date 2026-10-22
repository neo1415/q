import type { BeatAlignment } from "./alignment.js";
import { STORY_BEATS, STORY_VERSION, type StoryBeat } from "./beats.js";

/**
 * The story's editions (owner, 22 Oct): one script, three cuts. Each is a
 * VERBATIM subset of the 56 beats and their rendered clips: no rewording,
 * no new speech. A part is a whole beat or whole lines of one beat (cut at
 * word boundaries in the clip's forced-alignment timings), so a cut never
 * changes a word or splits a caption line.
 *
 * Each edition is its own storyVersion: the owner approves each cut.
 */
export const STORY_EDITION_IDS = ["FULL", "INVESTOR", "FOUNDER"] as const;
export type StoryEditionId = (typeof STORY_EDITION_IDS)[number];

export type StoryEditionPart = {
  readonly beat: number;
  /** Whole lines of the beat, by index (inclusive); absent: all of it. */
  readonly lines?: { readonly from: number; readonly to: number };
};

export type StoryEdition = {
  readonly id: StoryEditionId;
  /** For the Q Pitch choice: "Everyone", "Investors", "Founders". */
  readonly label: string;
  readonly version: string;
  readonly parts: readonly StoryEditionPart[];
};

const span = (from: number, to: number): StoryEditionPart[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ beat: from + i }));

export const STORY_EDITIONS: Readonly<Record<StoryEditionId, StoryEdition>> = {
  FULL: {
    id: "FULL",
    label: "Everyone",
    version: STORY_VERSION,
    parts: span(1, 56),
  },
  // Under 4:00, a hard limit: the investor's story, then only "There has
  // to be a better way." of #32, then the product for investors (#46,
  // Investability IQ, kept) and the close.
  INVESTOR: {
    id: "INVESTOR",
    label: "Investors",
    version: `${STORY_VERSION}-investor`,
    parts: [
      ...span(1, 14),
      { beat: 32, lines: { from: 2, to: 2 } },
      ...span(33, 44),
      { beat: 46 },
      ...span(48, 56),
    ],
  },
  // The business's story (#16 opens it; #15, "the other side of the
  // table", needs the investor part before it), then the product for
  // businesses and the close.
  FOUNDER: {
    id: "FOUNDER",
    label: "Founders",
    version: `${STORY_VERSION}-founder`,
    parts: [...span(1, 2), ...span(16, 35), ...span(45, 56)],
  },
};

/** A clip window: where the part sits in its beat's rendered audio. */
export type StoryAudioWindow = {
  readonly offsetMs: number;
  readonly durationMs: number;
};

/** A beat as an edition plays it: its own number, perhaps a part of it. */
export type StoryEditionBeat = StoryBeat & {
  /** Whole-beat parts: null. Cut parts: the words kept, [from, to). */
  readonly cut: { readonly from: number; readonly to: number } | null;
};

function wordRange(
  beat: StoryBeat,
  lines: { readonly from: number; readonly to: number },
): { from: number; to: number } {
  let at = 0;
  let from = -1;
  let to = -1;
  for (const [index, line] of beat.lines.entries()) {
    const count = line.split(/\s+/u).filter(Boolean).length;
    if (index === lines.from) from = at;
    at += count;
    if (index === lines.to) to = at;
  }
  if (from < 0 || to <= from) {
    throw new Error(`Q Story: beat ${String(beat.n)} has no such lines`);
  }
  return { from, to };
}

/** The edition's beats, in play order. Cut parts keep only their words. */
export function editionBeats(edition: StoryEdition): StoryEditionBeat[] {
  return edition.parts.map((part) => {
    const beat = STORY_BEATS[part.beat - 1];
    if (beat === undefined) {
      throw new Error(`Q Story: no beat ${String(part.beat)}`);
    }
    if (part.lines === undefined) return { ...beat, cut: null };
    const { from, to } = wordRange(beat, part.lines);
    const inside = (at: number) => at >= from && at < to;
    return {
      ...beat,
      lines: beat.lines.slice(part.lines.from, part.lines.to + 1),
      words: beat.words.slice(from, to),
      // A tag at the cut's first word ("[sighs]" before "There") is still
      // the delivery of those words; tags elsewhere go with their words.
      tags: beat.tags
        .filter((tag) => inside(tag.at))
        .map((tag) => ({ ...tag, at: tag.at - from })),
      cues: beat.cues
        .filter((cue) => inside(cue.at))
        .map((cue) => ({ ...cue, at: cue.at - from })),
      silenceAfterMs: 0,
      cut: { from, to },
    };
  });
}

/** The breath kept after a cut's last word. */
export const CUT_BREATH_MS = 250;
/** The longest lead-in kept before a cut's first word. */
export const CUT_LEAD_IN_MAX_MS = 1_200;
/** Clear of the previous word's tail. */
const AFTER_PREVIOUS_MS = 120;

/**
 * A cut part's timings and where it sits in the clip: its words from the
 * full beat's alignment, shifted so the part's clock starts at zero. The
 * pause before the line is the line's own (a breath, or a "[sighs]" the
 * voice gave it), so the cut opens just after the previous word ends, at
 * most CUT_LEAD_IN_MAX_MS early; it closes a breath after its last word.
 * Never past the clip's ends.
 */
export function cutAlignment(
  full: BeatAlignment,
  cut: { readonly from: number; readonly to: number },
): { readonly alignment: BeatAlignment; readonly window: StoryAudioWindow } {
  const words = full.words.slice(cut.from, cut.to);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error(`Q Story: beat ${String(full.beat)}'s cut has no words`);
  }
  const previous = full.words[cut.from - 1];
  const offsetMs = Math.max(
    0,
    first.startMs - CUT_LEAD_IN_MAX_MS,
    previous === undefined ? 0 : previous.endMs + AFTER_PREVIOUS_MS,
  );
  const endMs = Math.min(full.durationMs, last.endMs + CUT_BREATH_MS);
  const durationMs = endMs - offsetMs;
  return {
    alignment: {
      ...full,
      durationMs,
      words: words.map((word) => ({
        ...word,
        startMs: word.startMs - offsetMs,
        endMs: word.endMs - offsetMs,
      })),
    },
    window: { offsetMs, durationMs },
  };
}

/** The 1-based step of the product part (#33) in this edition, if any. */
export function editionProductStep(
  beats: readonly StoryBeat[],
  productBeat: number,
): number | null {
  const at = beats.findIndex((beat) => beat.n === productBeat);
  return at < 0 ? null : at + 1;
}
