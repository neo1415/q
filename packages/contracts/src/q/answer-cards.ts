import { z } from "zod";

import { QSubjectRefSchema } from "./subject.js";

/**
 * Q's answer as cards (founder brief 2026-10-05, C1-C5; ADR 0053).
 *
 * "Top three", "compare them" and "research Y Combinator" are answered on
 * the Q page as a set of cards, not as prose, a Markdown table or a PDF.
 * The model fills the parts that are reading (names, reasons, how well
 * each measure fits, Q's view, what Q says about each card); Capital Q's
 * code fills the parts that must be reproducible: the colour, the order of
 * a ranked answer and the fit out of 10, computed from the measure levels
 * (`answerCardFit` in the model gateway). A model never writes a number.
 *
 * Fit is fit against what the person declared (their mandate), never a
 * verdict on the business: Fit is not Business Quality (CLAUDE.md
 * invariants). An unknown measure is left out of the fit and counted in
 * `of`, so "based on 4 of 6" says what was not known instead of scoring
 * it as zero.
 */

/** How one measure fits, in words. Shown with a shape, never colour alone. */
export const Q_ANSWER_CARD_LEVELS = [
  "STRONG",
  "GOOD",
  "PARTIAL",
  "UNKNOWN",
] as const;
export const QAnswerCardLevelSchema = z.enum(Q_ANSWER_CARD_LEVELS);
export type QAnswerCardLevel = z.infer<typeof QAnswerCardLevelSchema>;

/**
 * RANKED: a "top N", ordered by fit (code orders it).
 * SIDE_BY_SIDE: a comparison, in the order asked; the page can lay it out
 *   as one table because every card carries the same measures.
 * RESEARCH: parts of a research answer; no fit, no order.
 */
export const Q_ANSWER_CARDS_SHAPES = [
  "RANKED",
  "SIDE_BY_SIDE",
  "RESEARCH",
] as const;
export const QAnswerCardsShapeSchema = z.enum(Q_ANSWER_CARDS_SHAPES);
export type QAnswerCardsShape = z.infer<typeof QAnswerCardsShapeSchema>;

export const Q_ANSWER_CARDS_MAX = 10;
export const Q_ANSWER_CARD_REASONS_MAX = 3;
export const Q_ANSWER_CARD_MEASURES_MAX = 8;
export const Q_ANSWER_CARD_FOLLOW_UPS_MAX = 3;
/** Identity colours: `--cq-card-hue-1` .. `--cq-card-hue-7`. */
export const Q_ANSWER_CARD_HUES = 7;

export const QAnswerCardMeasureSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    level: QAnswerCardLevelSchema,
    /** What was found, in a few words ("£38k a month"); null when not known. */
    value: z.string().trim().max(80).nullable(),
  })
  .strict();
export type QAnswerCardMeasure = z.infer<typeof QAnswerCardMeasureSchema>;

/** Fit out of 10, computed by code from the known measures. */
export const QAnswerCardFitSchema = z
  .object({
    score: z.number().min(0).max(10),
    /** Measures that were known and went into the score. */
    measured: z.number().int().min(1).max(Q_ANSWER_CARD_MEASURES_MAX),
    /** All measures on the card, known or not. */
    of: z.number().int().min(1).max(Q_ANSWER_CARD_MEASURES_MAX),
  })
  .strict()
  .refine((fit) => fit.measured <= fit.of, {
    message: "measured never exceeds the measures on the card",
  });
export type QAnswerCardFit = z.infer<typeof QAnswerCardFitSchema>;

export const QAnswerCardSchema = z
  .object({
    /** Stable within the block (the page keys animation and dismissal on it). */
    key: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    line: z.string().trim().max(140).nullable(),
    /**
     * What the company does, in its own one line, so Q can talk about it
     * ("tell me about the third one"). Absent from an older server.
     */
    about: z.string().trim().max(160).nullable().optional(),
    /** Its current raise in words ("$2 million"), only as this reader may see it. */
    raise: z.string().trim().max(60).nullable().optional(),
    hue: z.number().int().min(1).max(Q_ANSWER_CARD_HUES),
    fit: QAnswerCardFitSchema.nullable(),
    reasons: z
      .array(z.string().trim().min(1).max(160))
      .min(1)
      .max(Q_ANSWER_CARD_REASONS_MAX),
    measures: z.array(QAnswerCardMeasureSchema).max(Q_ANSWER_CARD_MEASURES_MAX),
    /** Q's view in a few words ("Meet: ask who leads"); null for none. */
    view: z.string().trim().max(120).nullable(),
    /** What Q says while this card is in focus; null for none. */
    said: z.string().trim().max(300).nullable(),
    /** How many of the answer's sources this card rests on. */
    sourceCount: z.number().int().min(0).max(100),
    /** The resolved record behind the card, when there is one. */
    subject: QSubjectRefSchema.nullable(),
  })
  .strict();
export type QAnswerCard = z.infer<typeof QAnswerCardSchema>;

export const QAnswerCardsBlockSchema = z
  .object({
    kind: z.literal("ANSWER_CARDS"),
    shape: QAnswerCardsShapeSchema,
    /** What was asked, as a heading ("Top three for your mandate"). */
    title: z.string().trim().min(1).max(120),
    cards: z.array(QAnswerCardSchema).min(1).max(Q_ANSWER_CARDS_MAX),
    /** Q's own next questions; one tap runs one (C8). */
    followUps: z
      .array(z.string().trim().min(1).max(120))
      .max(Q_ANSWER_CARD_FOLLOW_UPS_MAX),
  })
  .strict()
  .refine(
    (block) =>
      new Set(block.cards.map((card) => card.key)).size === block.cards.length,
    { message: "card keys are unique within an answer", path: ["cards"] },
  )
  .refine(
    (block) =>
      block.shape !== "RESEARCH" ||
      block.cards.every((card) => card.fit === null),
    { message: "a research answer carries no fit", path: ["cards"] },
  );
export type QAnswerCardsBlock = z.infer<typeof QAnswerCardsBlockSchema>;
