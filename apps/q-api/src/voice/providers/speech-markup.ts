import {
  sentenceKey,
  type SentencePerformance,
  type SpeechPace,
  type SpeechReaction,
} from "../speech-performance.js";

/**
 * What each voice can actually do with a delivery cue, and how it is asked
 * (CQ-VOICE-010).
 *
 * Every "yes" below was measured, not taken from a brochure
 * (design/voice-comparison/comparison.md). Each synthesised clip was
 * transcribed and checked for silence and for sound before the first word:
 *
 * - eleven_turbo_v2_5 renders `<break time/>` as silence and honours
 *   `voice_settings.speed`. It READS `[laughs]` ALOUD ("Halfs"), so a
 *   reaction is never sent to it.
 * - eleven_v3_conversational renders `[laughs]`, `[chuckles]`, `[sighs]`
 *   and `[short pause]` without speaking them. It ignores `speed` (0.85
 *   and 1.0 came out the same length) and refuses
 *   `optimize_streaming_latency` outright.
 * - Deepgram Aura-2 reads tags aloud and left no measurable gap for an
 *   ellipsis, so nothing is rendered on it.
 *
 * A cue a voice cannot render is dropped. It is never approximated with
 * words.
 */

export type SpeechCapabilities = {
  readonly reaction: boolean;
  readonly pause: boolean;
  readonly pace: boolean;
  readonly emphasis: boolean;
};

export type SpeechMarkup = {
  readonly capabilities: SpeechCapabilities;
  readonly reaction: (reaction: SpeechReaction) => string;
  readonly pause: string;
  /**
   * How the pause is written. "after" appends it after the sentence.
   * "trailing" puts it in place of the sentence's closing stop ("that...")
   * for a voice that reads trailing punctuation as hesitation.
   */
  readonly pauseStyle?: "after" | "trailing" | undefined;
  readonly emphasis: (phrase: string) => string;
  /** A speaking-rate multiplier for the vendor, or undefined for as-is. */
  readonly speed: (pace: SpeechPace) => number | undefined;
};

export const ELEVENLABS_SPEECH_MODELS = [
  "eleven_turbo_v2_5",
  "eleven_v3_conversational",
] as const;
export type ElevenLabsSpeechModel = (typeof ELEVENLABS_SPEECH_MODELS)[number];

const NONE = (): string => "";

/**
 * Gentle on purpose: a pace cue is a shade, not a different voice.
 * The vendor range is 0.7 to 1.2.
 */
const SPEEDS: Readonly<Record<SpeechPace, number | undefined>> = {
  NORMAL: undefined,
  SLOWER: 0.92,
  FASTER: 1.06,
};

const V3_TAGS: Readonly<Record<SpeechReaction, string>> = {
  LAUGH: "[laughs]",
  CHUCKLE: "[chuckles]",
  SIGH: "[sighs]",
};

export const SPEECH_MARKUP: Readonly<
  Record<ElevenLabsSpeechModel, SpeechMarkup>
> = {
  eleven_turbo_v2_5: {
    capabilities: { reaction: false, pause: true, pace: true, emphasis: false },
    reaction: NONE,
    pause: '<break time="0.6s" />',
    emphasis: (phrase) => phrase,
    speed: (pace) => SPEEDS[pace],
  },
  eleven_v3_conversational: {
    capabilities: { reaction: true, pause: true, pace: false, emphasis: true },
    reaction: (reaction) => V3_TAGS[reaction],
    pause: "[short pause]",
    // v3 reads capitals as stress (vendor guidance; the listening check on
    // design/voice-comparison 07-disagreement decides whether it stays).
    emphasis: (phrase) => phrase.toUpperCase(),
    speed: () => undefined,
  },
};

/**
 * Deepgram Aura-2, used only when ElevenLabs cannot speak at all. It
 * renders pauses and nothing else (the lead's decision, 2026-09-24). An
 * ellipsis was the only pause it took, and it took it unreliably: case 03
 * showed no measurable gap. It reads every tag aloud.
 */
export const AURA_MARKUP: SpeechMarkup = {
  capabilities: { reaction: false, pause: true, pace: false, emphasis: false },
  reaction: NONE,
  pause: "...",
  pauseStyle: "trailing",
  emphasis: (phrase) => phrase,
  speed: () => undefined,
};

/**
 * Stage directions a model may still have written into its text: `[laughs]`
 * or an SSML break. They are removed before rendering, so that the only
 * markup that ever reaches a voice is the markup this layer chose for it.
 * Only the shape of markup is matched (a bracketed lowercase word or two,
 * a break element), never the reply's words.
 */
const BRACKET_TAG = /\s*\[[a-z]+(?: [a-z]+){0,2}\]\s*/g;
const BREAK_TAG = /\s*<break\b[^>]*\/?>\s*/gi;

export function withoutMarkup(text: string): string {
  return text
    .replace(BRACKET_TAG, " ")
    .replace(BREAK_TAG, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type RenderedSpeech = {
  readonly text: string;
  readonly speed: number | undefined;
  /** Which cues made it into the audio, for the turn's trace. */
  readonly rendered: readonly ("reaction" | "pause" | "pace" | "emphasis")[];
};

type Insertion = {
  readonly at: number;
  readonly text: string;
  /** Characters replaced at `at`; none when only inserting. */
  readonly remove?: number;
};

/**
 * Render the cues that belong to this text in one voice's markup.
 *
 * `text` is what the provider asked to hear. Usually it is exactly one of
 * the sentences the cues were anchored to; it may also be several run
 * together, or a piece of one.
 */
export function renderSpeech(
  text: string,
  performances: readonly SentencePerformance[],
  markup: SpeechMarkup,
): RenderedSpeech {
  const clean = withoutMarkup(text);
  const can = markup.capabilities;
  const rendered = new Set<RenderedSpeech["rendered"][number]>();
  const insertions: Insertion[] = [];
  let body = clean;
  let speed: number | undefined;

  for (const p of performances) {
    const at = body.indexOf(p.sentence);
    const whole = at !== -1;
    // A piece of a sentence: the reaction belongs to its start and the
    // pause to its end, so each goes only where this piece is that part.
    const pieceKey = sentenceKey(body);
    const sentence = sentenceKey(p.sentence);
    const start = whole ? at : 0;
    const end = whole ? at + p.sentence.length : body.length;
    const isStart = whole || sentence.startsWith(pieceKey);
    const isEnd = whole || sentence.endsWith(pieceKey);

    if (can.emphasis) {
      for (const phrase of p.emphasis) {
        const within = body.slice(start, end).indexOf(phrase);
        const marked = markup.emphasis(phrase);
        // Same length or not at all: the reaction and pause positions
        // below were measured on this text.
        if (within === -1 || marked.length !== phrase.length) continue;
        const from = start + within;
        body = body.slice(0, from) + marked + body.slice(from + phrase.length);
        rendered.add("emphasis");
      }
    }
    if (can.reaction && p.reaction !== null && isStart) {
      insertions.push({ at: start, text: `${markup.reaction(p.reaction)} ` });
      rendered.add("reaction");
    }
    if (can.pause && p.pauseAfter && isEnd) {
      const stop = /[.!?]/.test(body.charAt(end - 1));
      insertions.push(
        markup.pauseStyle === "trailing"
          ? stop
            ? { at: end - 1, text: markup.pause, remove: 1 }
            : { at: end, text: markup.pause }
          : { at: end, text: ` ${markup.pause}` },
      );
      rendered.add("pause");
    }
    if (can.pace && speed === undefined) {
      speed = markup.speed(p.pace);
      if (speed !== undefined) rendered.add("pace");
    }
  }

  // Right to left, so an insertion never moves the place of the next.
  for (const insertion of [...insertions].sort((a, b) => b.at - a.at)) {
    body =
      body.slice(0, insertion.at) +
      insertion.text +
      body.slice(insertion.at + (insertion.remove ?? 0));
  }
  return { text: body.trim(), speed, rendered: [...rendered] };
}
