import { z } from "zod";

import type { TurnKind } from "./reading.js";

/**
 * A series of questions the person asked Q to put to them (R35).
 *
 * "Ask me three questions about my mandate" used to get one question and
 * then silence: nothing held the request once the first question was
 * asked, so the person's answer was answered and the series was over.
 *
 * The split is the usual one. The turn reader (a model) records what the
 * person asked for as a typed value -- a series of N about a topic, or a
 * request to stop one -- and never decides progress. This code holds the
 * series as conversation state and decides, per turn, which question
 * comes next and when the series is done. No words are matched here: the
 * same reading gives the same step however the person phrased it.
 */

/** Enough for any series a person would sit through in a chat. */
export const QUESTION_SEQUENCE_MAX = 10;
export const QUESTION_SEQUENCE_TOPIC_MAX = 120;

export const QUESTION_SEQUENCE_ACTIONS = ["START", "STOP"] as const;

/**
 * The reader's record of a series, or null when this turn neither asks
 * for one nor asks to stop one. Flat with nullable parameters, like the
 * reader's tool, so every structured-output provider accepts the shape.
 */
export const QuestionSequenceReadingSchema = z
  .object({
    action: z.enum(QUESTION_SEQUENCE_ACTIONS),
    /** START: how many they asked for (a few, unnumbered: 3). STOP: null. */
    count: z
      .number()
      .int()
      .min(1)
      .max(QUESTION_SEQUENCE_MAX)
      .nullable()
      .default(null),
    /** START: what the questions are about, briefly. STOP: null. */
    topic: z
      .string()
      .trim()
      .min(1)
      .max(QUESTION_SEQUENCE_TOPIC_MAX)
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (sequence) =>
      sequence.action === "START"
        ? sequence.count !== null && sequence.topic !== null
        : sequence.count === null && sequence.topic === null,
    { message: "a series carries exactly its own parameters" },
  );
export type QuestionSequenceReading = z.infer<
  typeof QuestionSequenceReadingSchema
>;

/** The series in hand: `asked` is how many of its questions Q has put. */
export type QuestionSequence = {
  readonly topic: string;
  readonly total: number;
  readonly asked: number;
};

/**
 * What this turn's answer must do about the series, for the answer's
 * trusted notes. Built here, never by a model.
 */
export type QuestionSequenceStep =
  /** Put question `number` (after a word on their answer, when there was one). */
  | {
      readonly kind: "ASK";
      readonly topic: string;
      readonly number: number;
      readonly total: number;
    }
  /** They said something other than an answer: respond, then ask `number` again. */
  | {
      readonly kind: "REASK";
      readonly topic: string;
      readonly number: number;
      readonly total: number;
    }
  /** The last answer is in: close the series, ask nothing more of it. */
  | {
      readonly kind: "FINISHED";
      readonly topic: string;
      readonly total: number;
    }
  /** They asked to stop: stop. */
  | { readonly kind: "STOPPED"; readonly topic: string };

export type QuestionSequenceTurn = {
  /** What this turn's answer must do; null when no series is involved. */
  readonly step: QuestionSequenceStep | null;
  /** The series after this turn, committed only once the answer lands. */
  readonly next: QuestionSequence | null;
};

/** The reading's parts this decision uses; null when the turn was unread. */
export type QuestionSequenceTurnReading = {
  readonly kind: TurnKind;
  readonly sequence?: QuestionSequenceReading | null | undefined;
} | null;

/** A topic from the person's words, made safe to quote in a note. */
function cleanTopic(topic: string): string {
  const flat = topic
    .replace(/[\s"“”]+/g, " ")
    .trim()
    .slice(0, QUESTION_SEQUENCE_TOPIC_MAX);
  return flat.length === 0 ? "what they asked about" : flat;
}

export function stepQuestionSequence(
  current: QuestionSequence | null,
  reading: QuestionSequenceTurnReading,
): QuestionSequenceTurn {
  const asked = reading?.sequence ?? null;
  if (asked?.action === "STOP") {
    return current === null
      ? { step: null, next: null }
      : { step: { kind: "STOPPED", topic: current.topic }, next: null };
  }
  // A new series, unless this turn is an answer to the one in hand: the
  // reader sees the original request in the recent turns and may repeat
  // it, and an answer must never restart the count.
  if (
    asked?.action === "START" &&
    asked.count !== null &&
    asked.topic !== null &&
    !(current !== null && reading?.kind === "ANSWER")
  ) {
    const topic = cleanTopic(asked.topic);
    const total = Math.min(Math.max(asked.count, 1), QUESTION_SEQUENCE_MAX);
    return {
      step: { kind: "ASK", topic, number: 1, total },
      next: { topic, total, asked: 1 },
    };
  }
  if (current === null) return { step: null, next: null };
  if (reading?.kind !== "ANSWER") {
    // A question of their own, a remark, an unread turn: answered, and the
    // question still open is put again. Only an answer moves the series.
    return {
      step: {
        kind: "REASK",
        topic: current.topic,
        number: current.asked,
        total: current.total,
      },
      next: current,
    };
  }
  if (current.asked >= current.total) {
    return {
      step: { kind: "FINISHED", topic: current.topic, total: current.total },
      next: null,
    };
  }
  const number = current.asked + 1;
  return {
    step: { kind: "ASK", topic: current.topic, number, total: current.total },
    next: { ...current, asked: number },
  };
}
