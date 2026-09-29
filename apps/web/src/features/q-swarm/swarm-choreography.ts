import type { QApertureState } from "../q-aperture/aperture-state";
import type { SwarmActivity, SwarmMode } from "./swarm-engine";

/**
 * What the swarm is doing at any moment (founder direction 2026-09-29:
 * "it shouldn't hold one shape for more than 10 seconds... the swarm is
 * constantly moving and being creative... forming shapes based on what is
 * being said and in time").
 *
 * Each of Q's states has its own sequence of figures, none held longer
 * than MAX_HOLD_SECONDS, so the swarm is always on its way somewhere. What
 * Q says interrupts the sequence: a cue (a glyph from its sentence, a
 * laugh) takes the swarm for its moment and then hands it back. Pure, so
 * the rhythm is tested rather than eyeballed.
 */

export const MAX_HOLD_SECONDS = 9;

export type SwarmBeat = {
  readonly mode: SwarmMode;
  readonly activity: SwarmActivity;
  readonly seconds: number;
  readonly glyph?: string | undefined;
};

/** What Q's own words asked the swarm to show, for a moment. */
export type SwarmCue = {
  readonly glyph: string | null;
  readonly laugh: boolean;
  /** When the cue ends, in the same clock as `now`. */
  readonly until: number;
};

const beat = (
  mode: SwarmMode,
  activity: SwarmActivity,
  seconds: number,
  glyph?: string,
): SwarmBeat => ({ mode, activity, seconds, glyph });

/** The sequences for surfaces large enough to read a face. */
export const SEQUENCES: Readonly<Record<QApertureState, readonly SwarmBeat[]>> =
  {
    IDLE: [
      beat("Q", "IDLE", 7),
      beat("BLOOM", "IDLE", 5),
      beat("FACE", "IDLE", 7),
      beat("GALAXY", "IDLE", 6),
      beat("Q", "IDLE", 5),
      beat("GLYPH", "IDLE", 2.5, "👋"),
      beat("WAVE", "IDLE", 4),
    ],
    LISTENING: [
      beat("FACE", "LISTENING", 7),
      beat("WAVE", "LISTENING", 5),
      beat("FACE", "LISTENING", 6),
      beat("GLYPH", "LISTENING", 2.5, "👂"),
    ],
    THINKING: [
      beat("FACE", "THINKING", 5),
      beat("GALAXY", "THINKING", 4),
      beat("GLYPH", "THINKING", 2.5, "💡"),
      beat("BLOOM", "THINKING", 3.5),
      beat("RING", "THINKING", 3),
    ],
    SPEAKING: [
      beat("FACE", "SPEAKING", 6),
      beat("MOUTH", "SPEAKING", 5),
      beat("WAVE", "SPEAKING", 4),
      beat("Q", "SPEAKING", 4),
      beat("FACE", "SPEAKING", 5),
      beat("BLOOM", "SPEAKING", 3),
    ],
    NEEDS_INPUT: [
      beat("FACE", "ASKING", 6),
      beat("GLYPH", "ASKING", 2.5, "❓"),
      beat("Q", "ASKING", 4),
    ],
    NEEDS_APPROVAL: [
      beat("Q", "ASKING", 5),
      beat("GLYPH", "ASKING", 2.5, "✋"),
      beat("FACE", "ASKING", 5),
    ],
    WORKING: [
      beat("RING", "THINKING", 5),
      beat("GALAXY", "THINKING", 4),
      beat("BLOOM", "THINKING", 3),
    ],
    COMPLETE: [beat("GLYPH", "IDLE", 2.5, "👍"), beat("Q", "IDLE", 6)],
    ERROR: [beat("Q", "IDLE", 6)],
  };

/** Below 72 px a face cannot be read: the moving figures only. */
const SMALL_MODES: ReadonlySet<SwarmMode> = new Set([
  "Q",
  "RING",
  "GALAXY",
  "BLOOM",
]);

function sequenceFor(
  state: QApertureState,
  small: boolean,
): readonly SwarmBeat[] {
  const full = SEQUENCES[state];
  if (!small) return full;
  const kept = full.filter((b) => SMALL_MODES.has(b.mode));
  return kept.length > 0 ? kept : [beat("Q", "IDLE", 6)];
}

/**
 * The figure for this moment. `since` is when the state began, so a new
 * state starts at the top of its sequence rather than mid-way.
 */
export function choreograph(input: {
  readonly state: QApertureState;
  readonly small: boolean;
  /** Milliseconds. */
  readonly now: number;
  readonly since: number;
  readonly cue: SwarmCue | null;
}): {
  readonly mode: SwarmMode;
  readonly activity: SwarmActivity;
  readonly glyph: string | null;
  readonly dim: boolean;
} {
  const dim = input.state === "ERROR";
  const cue = input.cue;
  if (cue !== null && input.now < cue.until && !input.small) {
    if (cue.laugh) {
      // A laugh: the face laughing, then the laughing glyph, alternating.
      const phase = Math.floor((cue.until - input.now) / 1200) % 2;
      return phase === 0 || cue.glyph === null
        ? { mode: "FACE", activity: "LAUGHING", glyph: null, dim }
        : { mode: "GLYPH", activity: "LAUGHING", glyph: cue.glyph, dim };
    }
    if (cue.glyph !== null) {
      return { mode: "GLYPH", activity: "SPEAKING", glyph: cue.glyph, dim };
    }
  }
  const sequence = sequenceFor(input.state, input.small);
  const total = sequence.reduce((sum, b) => sum + b.seconds, 0);
  let at = ((input.now - input.since) / 1000) % total;
  for (const b of sequence) {
    if (at < b.seconds) {
      return {
        mode: b.mode,
        activity: b.activity,
        glyph: b.glyph ?? null,
        dim,
      };
    }
    at -= b.seconds;
  }
  const first = sequence[0] ?? beat("Q", "IDLE", 6);
  return {
    mode: first.mode,
    activity: first.activity,
    glyph: first.glyph ?? null,
    dim,
  };
}

/**
 * What a sentence of Q's own shows, if anything: an emoji Q wrote, or the
 * concept the sentence is about. Read from Q's output only, never from
 * what the person said (ADR 0011 governs their words).
 */
const CONCEPTS: readonly (readonly [RegExp, string])[] = [
  [/\b(revenue|money|cash|capital|cheque|check|funding|raise[sd]?)\b/i, "💰"],
  [/\b(grow(th|ing|s)?|traction|increase[sd]?|up\s+\d)/i, "📈"],
  [/\b(partner(s|ship)?|deal|agree(d|ment)?|connect(ed|ion)?)\b/i, "🤝"],
  [/\b(idea|insight|interesting|suggest(ion)?)\b/i, "💡"],
  [/\b(meeting|call|calendar|schedule[sd]?|tomorrow|week)\b/i, "📅"],
  [/\b(launch(ed|es)?|scal(e|ing)|rocket|fast)\b/i, "🚀"],
  [/\b(congratulations|well done|great news|brilliant)\b/i, "🎉"],
  [/\b(love|care|grateful|thank(s| you))\b/i, "❤️"],
  [/\b(look(ing)?|see|watch(ed)?|found)\b/i, "👀"],
  [/\b(document|deck|pdf|brief|report)\b/i, "📄"],
  [/\b(risk|warning|careful|flag(ged)?)\b/i, "⚠️"],
];

const LAUGHING = /[\u{1F600}-\u{1F606}\u{1F602}\u{1F923}\u{1F60A}]/u;
const EMOJI = /\p{Extended_Pictographic}/u;

export function cueForSentence(text: string, now: number): SwarmCue | null {
  if (LAUGHING.test(text)) {
    return { glyph: "😂", laugh: true, until: now + 4_800 };
  }
  const written = EMOJI.exec(text)?.[0];
  if (written !== undefined) {
    return { glyph: written, laugh: false, until: now + 2_800 };
  }
  for (const [pattern, glyph] of CONCEPTS) {
    if (pattern.test(text)) return { glyph, laugh: false, until: now + 2_400 };
  }
  return null;
}
