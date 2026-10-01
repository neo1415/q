import { z } from "zod";

/**
 * Q's presence gestures (PRESENCE spec §5, founder direction 2026-10-01):
 * what Q's particles form for a sentence of its answer -- a dollar sign
 * when it talks money, buildings for companies or property, clapping when
 * impressed, the head thrown back when it laughs.
 *
 * A closed set the model chooses from beside its reply, never derived from
 * the words by pattern (ADR 0011/0016). Presentation only: a gesture
 * carries no content, grants nothing and is never stored as history.
 */
export const Q_PRESENCE_GESTURES = [
  "QUESTION",
  "EXCLAIM",
  "MONEY",
  "BUILDINGS",
  "CHART_UP",
  "CLAP",
  "LAUGH",
  "THINK_TILT",
  "NOD",
  "HANDS_EXPLAIN",
] as const;
export type QPresenceGesture = (typeof Q_PRESENCE_GESTURES)[number];
export const QPresenceGestureSchema = z.enum(Q_PRESENCE_GESTURES);

/** Replies are a few sentences; a position past this is not a position. */
export const Q_GESTURE_MAX_SENTENCE_INDEX = 11;
/** A few moments per answer; more is a light show, not a presence. */
export const Q_GESTURES_MAX = 4;

/** One gesture, at the sentence (0-based) of the reply it belongs to. */
export const QSentenceGestureSchema = z
  .object({
    sentence: z.number().int().min(0).max(Q_GESTURE_MAX_SENTENCE_INDEX),
    gesture: QPresenceGestureSchema,
  })
  .strict();
export type QSentenceGesture = z.infer<typeof QSentenceGestureSchema>;

export const QSentenceGesturesSchema = z
  .array(QSentenceGestureSchema)
  .max(Q_GESTURES_MAX);
export type QSentenceGestures = z.infer<typeof QSentenceGesturesSchema>;

/**
 * The gestures of one spoken answer, on the voice turn board, keyed by the
 * answer so a screen plays each answer's gestures once.
 */
export const QVoicePresenceSchema = z
  .object({
    answerId: z.string().min(1).max(64),
    gestures: QSentenceGesturesSchema,
  })
  .strict();
export type QVoicePresence = z.infer<typeof QVoicePresenceSchema>;
