import {
  Q_GESTURE_MAX_SENTENCE_INDEX,
  Q_GESTURES_MAX,
  QPresenceGestureSchema,
  QSentenceGestureSchema,
  type QSentenceGesture,
  type QSentenceGestures,
} from "@capital-q/contracts";
import { z } from "zod";

/**
 * What the model is told about the field. It travels as the output
 * schema's field description rather than in the task text: the task
 * bundles have a size budget, and the schema already names the gestures.
 */
export const PRESENCE_GESTURES_GUIDANCE =
  "Usually []. Up to 4 {sentence: 0-based index of a sentence in your reply, gesture} that your particles form while that sentence is said, only when the sentence is plainly about it: QUESTION you ask them something; EXCLAIM surprise or emphasis; MONEY money, revenue, a raise, valuation; BUILDINGS companies, offices, property; CHART_UP growth, traction; CLAP impressed, congratulating, or they ask you to clap or cheer; LAUGH you find it funny or they ask you to laugh; THINK_TILT weighing something up; NOD agreeing; HANDS_EXPLAIN explaining steps or how something works.";

/**
 * PRESENCE (spec §5): the gestures a model may ask for beside its reply,
 * one closed-set gesture per sentence it belongs to. The model chooses;
 * nothing here reads the reply's words to pick one (ADR 0011/0016).
 *
 * Lenient on the way in (plain strings and numbers, so an unknown gesture
 * or a stray index is dropped here and is never a reason to lose the
 * answer), exact on the way out (the contract's closed set).
 */
export const ModelSentenceGesturesSchema = z
  .array(
    z
      .object({
        sentence: z.number(),
        gesture: z.string().max(24),
      })
      .strict(),
  )
  .max(12)
  .default([])
  .describe(PRESENCE_GESTURES_GUIDANCE);
export type ModelSentenceGestures = z.infer<typeof ModelSentenceGesturesSchema>;

/** How many sentences a reply has, for clamping gesture positions. */
export function sentenceCount(reply: string): number {
  let count = 0;
  let open = false;
  for (const char of reply.trim()) {
    if (char === "." || char === "!" || char === "?" || char === "\n") {
      if (open) count += 1;
      open = false;
    } else if (char.trim().length > 0) {
      open = true;
    }
  }
  return Math.max(1, count + (open ? 1 : 0));
}

/**
 * What survives of the model's gestures for this reply: positions inside
 * the reply, one gesture per sentence, in order, at most Q_GESTURES_MAX.
 */
export function gesturesForReply(
  reply: string,
  gestures: ModelSentenceGestures | null | undefined,
): QSentenceGestures {
  if (gestures === null || gestures === undefined) return [];
  const last = sentenceCount(reply) - 1;
  const seen = new Set<number>();
  const kept: QSentenceGesture[] = [];
  for (const raw of gestures) {
    const read = QSentenceGestureSchema.safeParse({
      sentence: Number.isFinite(raw.sentence)
        ? Math.max(
            0,
            Math.min(Q_GESTURE_MAX_SENTENCE_INDEX, Math.floor(raw.sentence)),
          )
        : 0,
      gesture: raw.gesture,
    });
    if (!read.success) continue;
    const item = read.data;
    const sentence = Math.min(item.sentence, last);
    if (seen.has(sentence)) continue;
    seen.add(sentence);
    kept.push({ sentence, gesture: item.gesture });
  }
  return kept.sort((a, b) => a.sentence - b.sentence).slice(0, Q_GESTURES_MAX);
}

/**
 * The same field with the gesture names as an enum, for tasks whose
 * gateway call drops an invalid list item rather than the reply
 * (`invalidListItems: "DROP"`): the model sees the closed set.
 */
export const ModelSentenceGesturesEnumSchema = z
  .array(
    z
      .object({
        sentence: z.number(),
        gesture: QPresenceGestureSchema,
      })
      .strict(),
  )
  .max(12)
  .default([])
  .describe(PRESENCE_GESTURES_GUIDANCE);
