/**
 * The speech-performance layer (CQ-VOICE-010): how Q's words sound,
 * kept apart from what the words are.
 *
 * The model asks for delivery in a structured field beside its reply
 * (q-core `SpeechDelivery`). The reply goes out exactly as written: to the
 * speech provider as Q's text, to the transcript, to the interview thread
 * and to memory. The cues go only to this board, keyed by the voice session
 * and by the sentence they belong to. When the provider comes back to the
 * speak relay for a sentence's audio, the relay takes that sentence's cues
 * and renders them in whatever markup the chosen voice understands, and
 * only if the voice can render them at all.
 *
 * Why a side channel rather than markup in the text: the Deepgram agent
 * shows the think text to the person as Q's line and sends it back as
 * history on every later turn. Anything written into that text is in the
 * transcript. The relay is the one place that sees each sentence on its
 * way to becoming sound and nowhere else.
 *
 * Nothing here decides that Q should laugh. There is no list of funny
 * words and no pattern that triggers a sigh. This validates what the
 * model asked for against the reply it actually wrote, and hands on what
 * survives.
 */

export type SpeechReaction = "LAUGH" | "CHUCKLE" | "SIGH";
export type SpeechPace = "NORMAL" | "SLOWER" | "FASTER";

/**
 * What the model asked for. The same shape as q-core's `SpeechDelivery`,
 * restated here structurally so the speech boundary depends on nothing but
 * its input.
 */
export type SpeechCues = {
  readonly reaction: SpeechReaction | null;
  readonly reactionAt: number;
  readonly pauseAfter: readonly number[];
  readonly pace: SpeechPace;
  readonly emphasis: readonly string[];
};

/** One spoken sentence and how it should sound. */
export type SentencePerformance = {
  /** The sentence exactly as it is spoken (after `speakable`). */
  readonly sentence: string;
  readonly reaction: SpeechReaction | null;
  readonly pauseAfter: boolean;
  readonly pace: SpeechPace;
  /** Phrases that occur verbatim in `sentence`. */
  readonly emphasis: readonly string[];
};

function hasCue(p: SentencePerformance): boolean {
  return (
    p.reaction !== null ||
    p.pauseAfter ||
    p.pace !== "NORMAL" ||
    p.emphasis.length > 0
  );
}

/**
 * Attach the requested cues to the sentences Q will actually say.
 *
 * Anything that does not fit what was said is dropped rather than
 * repaired:
 * - a reaction before a sentence that does not exist;
 * - a pause after the last sentence (silence after Q stops is not a
 *   pause, it is the person's turn);
 * - an emphasised phrase the reply does not contain word for word.
 *
 * Only sentences with at least one cue are returned.
 */
export function anchorCues(
  spoken: readonly string[],
  cues: SpeechCues | null | undefined,
): readonly SentencePerformance[] {
  if (cues === null || cues === undefined || spoken.length === 0) {
    return [];
  }
  const emphasisBySentence = new Map<number, string[]>();
  for (const raw of cues.emphasis.slice(0, 2)) {
    const phrase = raw.trim();
    if (phrase.length === 0) continue;
    const at = spoken.findIndex((sentence) => sentence.includes(phrase));
    if (at === -1) continue;
    emphasisBySentence.set(at, [...(emphasisBySentence.get(at) ?? []), phrase]);
  }
  const pauses = new Set(
    cues.pauseAfter.filter(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < spoken.length - 1,
    ),
  );
  const reactionAt =
    cues.reaction !== null &&
    Number.isInteger(cues.reactionAt) &&
    cues.reactionAt >= 0 &&
    cues.reactionAt < spoken.length
      ? cues.reactionAt
      : -1;
  return spoken
    .map((sentence, index): SentencePerformance => ({
      sentence,
      reaction: index === reactionAt ? cues.reaction : null,
      pauseAfter: pauses.has(index),
      pace: cues.pace,
      emphasis: emphasisBySentence.get(index) ?? [],
    }))
    .filter(hasCue);
}

/** Case, spacing and punctuation differences are not a different sentence. */
export function sentenceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type SpeechPerformanceBoard = {
  /** The cues for the reply about to be spoken. Replaces any still waiting. */
  readonly perform: (
    voiceSessionId: string,
    performances: readonly SentencePerformance[],
  ) => void;
  /**
   * The cues for one piece of text the provider asked to hear, taken so
   * that they are rendered once. Empty when there are none.
   */
  readonly take: (
    voiceSessionId: string,
    text: string,
  ) => readonly SentencePerformance[];
  readonly clear: (voiceSessionId: string) => void;
};

type Waiting = {
  readonly at: number;
  readonly entries: { readonly key: string; readonly p: SentencePerformance }[];
};

/**
 * Process-local, like the voice bindings it sits beside: the relay request
 * for a sentence reaches the same process that wrote the sentence.
 */
export function createSpeechPerformanceBoard(
  options: {
    readonly now?: (() => number) | undefined;
    /** Cues for a sentence nobody asked to hear within this are dropped. */
    readonly ttlMs?: number | undefined;
    readonly maxSessions?: number | undefined;
  } = {},
): SpeechPerformanceBoard {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 60_000;
  const maxSessions = options.maxSessions ?? 500;
  const waiting = new Map<string, Waiting>();

  const sweep = () => {
    const cutoff = now() - ttlMs;
    for (const [id, w] of waiting) {
      if (w.at < cutoff) waiting.delete(id);
    }
    // Oldest first: a Map iterates in insertion order.
    while (waiting.size > maxSessions) {
      const oldest = waiting.keys().next().value;
      if (oldest === undefined) break;
      waiting.delete(oldest);
    }
  };

  return {
    perform: (voiceSessionId, performances) => {
      waiting.delete(voiceSessionId);
      if (performances.length > 0) {
        waiting.set(voiceSessionId, {
          at: now(),
          entries: performances
            .map((p) => ({ key: sentenceKey(p.sentence), p }))
            .filter((entry) => entry.key.length > 0),
        });
      }
      sweep();
    },
    take: (voiceSessionId, text) => {
      const w = waiting.get(voiceSessionId);
      if (w === undefined) return [];
      if (w.at < now() - ttlMs) {
        waiting.delete(voiceSessionId);
        return [];
      }
      const key = sentenceKey(text);
      if (key.length === 0) return [];
      // The provider may hand over one of our sentences, several run
      // together, or a piece of one it split further. Containment either
      // way covers all three; padding keeps it to whole words, so "no"
      // is not found inside "I know".
      const padded = ` ${key} `;
      const taken = w.entries.filter(
        (entry) =>
          padded.includes(` ${entry.key} `) ||
          ` ${entry.key} `.includes(padded),
      );
      if (taken.length === 0) return [];
      const rest = w.entries.filter((entry) => !taken.includes(entry));
      if (rest.length === 0) waiting.delete(voiceSessionId);
      else waiting.set(voiceSessionId, { at: w.at, entries: rest });
      return taken.map((entry) => entry.p);
    },
    clear: (voiceSessionId) => {
      waiting.delete(voiceSessionId);
    },
  };
}
