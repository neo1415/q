import { z } from "zod";

/**
 * How Q would like a spoken reply to be delivered (CQ-VOICE-010).
 *
 * A closed, provider-independent request that the model makes BESIDE its
 * reply and never inside it. The reply is what Q said: it is what the
 * transcript shows, what the interview thread stores and what memory may
 * learn from. Delivery is only about how those same words sound, so it
 * travels in its own field and stops at the speech boundary. A model that
 * wrote "[laughs]" into its reply put a stage direction into the record.
 * On a voice that cannot render it, "[laughs]" was also read aloud as a
 * word (measured: "Halfs").
 *
 * The request follows what the conversation means, never particular
 * words. Nothing here looks at the reply to decide whether Q should
 * laugh. The model asks, this schema bounds what it may ask for, and the
 * speech layer renders only what the chosen voice can actually do. A voice
 * that cannot laugh does not laugh. It is not given a substitute.
 *
 * Restraint is part of the shape: one reaction at most, two pauses, two
 * emphasised phrases, one pace. Sentence positions refer to the reply's
 * sentences in order, counting from zero.
 */

export const SPEECH_REACTIONS = ["LAUGH", "CHUCKLE", "SIGH"] as const;
export type SpeechReaction = (typeof SPEECH_REACTIONS)[number];

export const SPEECH_PACES = ["NORMAL", "SLOWER", "FASTER"] as const;
export type SpeechPace = (typeof SPEECH_PACES)[number];

/** Replies are a few sentences; a position past this is not a position. */
export const SPEECH_MAX_SENTENCE_INDEX = 11;

const SentenceIndex = z.number().int().min(0).max(SPEECH_MAX_SENTENCE_INDEX);

export const SpeechDeliverySchema = z
  .object({
    /** A short non-verbal reaction, where a person would make one. */
    reaction: z.enum(SPEECH_REACTIONS).nullable().default(null),
    /** Which sentence the reaction comes before. */
    reactionAt: SentenceIndex.default(0),
    /** Sentences followed by a thinking pause. */
    pauseAfter: z.array(SentenceIndex).max(2).default([]),
    pace: z.enum(SPEECH_PACES).default("NORMAL"),
    /** Words from the reply, verbatim, that carry the weight of a sentence. */
    emphasis: z.array(z.string().min(1).max(40)).max(2).default([]),
  })
  .strict();

export type SpeechDelivery = z.infer<typeof SpeechDeliverySchema>;

/** Nothing requested: the voice speaks the reply as written. */
export const PLAIN_DELIVERY: SpeechDelivery = {
  reaction: null,
  reactionAt: 0,
  pauseAfter: [],
  pace: "NORMAL",
  emphasis: [],
};
