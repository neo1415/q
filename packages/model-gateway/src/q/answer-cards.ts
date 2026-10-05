import {
  Q_ANSWER_CARD_HUES,
  QAnswerCardsBlockSchema,
  type QAnswerCard,
  type QAnswerCardFit,
  type QAnswerCardLevel,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";

/**
 * The model's answer cards, made reproducible (ADR 0053).
 *
 * The model reads each measure's level; this code turns those levels into
 * the fit out of 10 and the order of a ranked answer, so the same reading
 * always gives the same number and the same order, and the number can be
 * explained from what is on the card. Weights live here, in one table,
 * not in the prompt.
 */

/** Points out of 10 for a measure at each known level. */
export const ANSWER_CARD_LEVEL_POINTS: Readonly<
  Record<Exclude<QAnswerCardLevel, "UNKNOWN">, number>
> = { STRONG: 10, GOOD: 7.5, PARTIAL: 4 };

/** Below this many known measures a fit says more than the evidence. */
export const ANSWER_CARD_FIT_MIN_KNOWN = 3;

export type ModelAnswerCardsLike = {
  readonly shape: "RANKED" | "SIDE_BY_SIDE" | "RESEARCH";
  readonly title: string;
  readonly cards: readonly {
    readonly name: string;
    readonly line: string | null;
    readonly reasons: readonly string[];
    readonly measures: readonly {
      readonly label: string;
      readonly level: QAnswerCardLevel;
      readonly value: string | null;
    }[];
    readonly view: string | null;
    readonly said: string | null;
    readonly citations: readonly string[];
  }[];
  readonly followUps: readonly string[];
};

/**
 * Fit out of 10: the mean of the known measures' points, to one decimal.
 * An UNKNOWN measure is left out (never scored as zero) and still counted
 * in `of`; too few known measures and there is no fit at all.
 */
export function answerCardFit(
  measures: readonly { readonly level: QAnswerCardLevel }[],
): QAnswerCardFit | null {
  const known = measures.flatMap((measure) =>
    measure.level === "UNKNOWN"
      ? []
      : [ANSWER_CARD_LEVEL_POINTS[measure.level]],
  );
  if (known.length < ANSWER_CARD_FIT_MIN_KNOWN) return null;
  const mean = known.reduce((sum, points) => sum + points, 0) / known.length;
  return {
    score: Math.round(mean * 10) / 10,
    measured: known.length,
    of: measures.length,
  };
}

function keyOf(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "card";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${String(n)}`;
  taken.add(key);
  return key;
}

/**
 * The block the page renders, or null when the reading cannot make one.
 * RANKED is ordered by fit, highest first; equal fits and cards without a
 * fit keep the order the model wrote. Colours follow the final order.
 */
export function answerCardsBlock(
  model: ModelAnswerCardsLike,
): QAnswerCardsBlock | null {
  const research = model.shape === "RESEARCH";
  const scored = model.cards.map((card, index) => ({
    card,
    index,
    fit: research ? null : answerCardFit(card.measures),
  }));
  if (model.shape === "RANKED") {
    scored.sort((a, b) => {
      const fa = a.fit?.score ?? -1;
      const fb = b.fit?.score ?? -1;
      return fb - fa || a.index - b.index;
    });
  }
  const taken = new Set<string>();
  const cards: QAnswerCard[] = scored.map(({ card, fit }, at) => ({
    key: keyOf(card.name, taken),
    name: card.name,
    line: card.line,
    hue: (at % Q_ANSWER_CARD_HUES) + 1,
    fit,
    reasons: card.reasons.slice(0, 3),
    measures: research
      ? []
      : card.measures.map((measure) => ({
          label: measure.label,
          level: measure.level,
          value: measure.value,
        })),
    view: card.view,
    said: card.said,
    sourceCount: new Set(card.citations).size,
    subject: null,
  }));
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: model.shape,
    title: model.title,
    cards,
    followUps: model.followUps.slice(0, 3),
  });
  return parsed.success ? parsed.data : null;
}
