import type {
  QAnswerCard,
  QAnswerCardLevel,
  QAnswerCardsBlock,
} from "@capital-q/contracts";

import type { QTurn } from "./conversation";
import { shownItems, stageOf } from "./shown";

/**
 * The answer canvas's rules, as plain functions (C1-C4).
 *
 * Kept apart from the component so the layout for 1, 3, 5 or 10 cards,
 * which card Q is talking about, and when the topic has moved on are
 * decided by code that a test can pin, not by what happens to render.
 */

export type CanvasLayout = {
  /** A row of cards side by side, or the focused card beside a grid. */
  readonly layout: "row" | "grid";
  /** On a phone, the cards not in focus become half-width tiles. */
  readonly tiles: boolean;
};

/**
 * Desktop: up to four in a row (the focused one wide); five or more, the
 * focused card beside a grid of the rest (live 23 Oct: five in a row left
 * the rest about 170px wide, names broke mid-word). Phone: one column; from four
 * cards, the rest become half-width tiles so the focused card is never
 * pushed off a 390px screen.
 */
export function canvasLayout(count: number, wide: boolean): CanvasLayout {
  return {
    layout: wide && count > 4 ? "grid" : "row",
    tiles: !wide && count >= 4,
  };
}

/** How a measure's level reads: a word, always beside its shape. */
export const LEVEL_WORD: Readonly<Record<QAnswerCardLevel, string>> = {
  STRONG: "Strong",
  GOOD: "Good",
  PARTIAL: "Partial",
  MISMATCH: "Does not match",
  UNKNOWN: "Unknown",
};

/** The fit as a number to show, one decimal, or null when there is none. */
export function fitNumber(card: QAnswerCard): string | null {
  return card.fit === null ? null : card.fit.score.toFixed(1);
}

/** The fit in words for a screen reader and the line under the number. */
export function fitWords(card: QAnswerCard): string | null {
  if (card.fit === null) return null;
  const { score, measured, of } = card.fit;
  // INC-1 / G-D17: fit with the declared mandate, never a quality score.
  const base = `Mandate fit ${score.toFixed(1)} out of 10`;
  return measured < of
    ? `${base}, from ${String(measured)} of ${String(of)} measures known`
    : base;
}

/**
 * How the card's mandate fit was made, on the card (G-D17): how many of
 * its measures were known, and what it rests on. No sources is said, never
 * left blank.
 */
export function fitProvenance(card: QAnswerCard): string | null {
  if (card.fit === null) return null;
  const known = `${String(card.fit.measured)} of ${String(card.fit.of)} measures known`;
  const sources =
    card.sourceCount > 0
      ? `${String(card.sourceCount)} ${card.sourceCount === 1 ? "source" : "sources"}`
      : "no source documents yet";
  return `${known} · ${sources}`;
}

/**
 * Points a known measure adds to mandate fit (ADR 0053 answer cards, ADR
 * 0059 platform fit: Strong 10, Partial 4, Mismatch 0; Good 7.5 exists only
 * on answer-card levels). Presentation of the existing formula only: the
 * score itself is computed upstream and is never recomputed for display.
 */
export const FIT_LEVEL_POINTS: Readonly<
  Record<Exclude<QAnswerCardLevel, "UNKNOWN">, number>
> = { STRONG: 10, GOOD: 7.5, PARTIAL: 4, MISMATCH: 0 };

export type FitExplanation = {
  readonly score: string;
  /** Every measure on the card with what it added; null = left out. */
  readonly rows: readonly {
    readonly label: string;
    readonly level: QAnswerCardLevel;
    readonly points: number | null;
  }[];
  readonly unknown: readonly string[];
  /** "(10 + 10 + 4) ÷ 3 = 8.0"; null when the card's measures do not
   *  reproduce the stored score (then the sum is not shown, never a
   *  second, contradicting number). */
  readonly sum: string | null;
  /** The points scale, only the levels that can occur on this card. */
  readonly scale: string;
};

function points(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * How a card's mandate fit out of 10 is worked out, in plain parts the
 * person can open (2026-10-12 investor test: an "8.8" with no way to see
 * what it measured, what went in and what was not known).
 */
export function fitExplanation(card: QAnswerCard): FitExplanation | null {
  if (card.fit === null || card.measures.length === 0) return null;
  const rows = card.measures.map((measure) => ({
    label: measure.label,
    level: measure.level,
    points:
      measure.level === "UNKNOWN" ? null : FIT_LEVEL_POINTS[measure.level],
  }));
  const known = rows.flatMap((row) =>
    row.points === null ? [] : [row.points],
  );
  const unknown = rows
    .filter((row) => row.points === null)
    .map((row) => row.label);
  const score = card.fit.score.toFixed(1);
  const mean =
    known.length === 0
      ? null
      : Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10;
  const sum =
    mean !== null &&
    mean.toFixed(1) === score &&
    known.length === card.fit.measured
      ? `(${known.map(points).join(" + ")}) ÷ ${String(known.length)} = ${score}`
      : null;
  const hasGood = rows.some((row) => row.level === "GOOD");
  const scale = [
    `${LEVEL_WORD.STRONG} 10`,
    ...(hasGood ? [`${LEVEL_WORD.GOOD} 7.5`] : []),
    `${LEVEL_WORD.PARTIAL} 4`,
    `${LEVEL_WORD.MISMATCH} 0`,
  ].join(", ");
  return { score, rows, unknown, sum, scale };
}

const PROVENANCE_SAID =
  /^.{1,60}: mandate fit [\d.]+ out of 10, not a quality score\./u;

/**
 * What Q says about a card in the walk-through. The stored line for a
 * scored card is the scoring method (INC-1 provenance); leading with the
 * method is the opposite of progressive disclosure, and its point scale
 * names levels the platform fit never uses. The method sits behind the
 * card's "How this score is worked out"; Q leads with the card's insight.
 */
export function spokenLine(card: QAnswerCard): string {
  const said = card.said;
  if (said !== null && !PROVENANCE_SAID.test(said)) return said;
  const reason = card.reasons[0];
  if (card.fit !== null) {
    return `${card.name}, ${card.fit.score.toFixed(1)} on mandate fit${reason === undefined ? "." : `: ${reason}`}`;
  }
  return `${card.name}: ${reason ?? ""}`.trim();
}

/** "Tied with Ledgerfold on mandate fit (8.0)": said, never implied by order. */
export function tieLine(
  block: QAnswerCardsBlock,
  card: QAnswerCard,
): string | null {
  const fit = card.fit;
  if (fit === null) return null;
  const tied = block.cards.filter(
    (other) =>
      other.key !== card.key &&
      other.fit !== null &&
      other.fit.score.toFixed(1) === fit.score.toFixed(1),
  );
  if (tied.length === 0) return null;
  const names = tied.map((other) => other.name);
  const who =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  return `Tied with ${who ?? ""} on mandate fit (${fit.score.toFixed(1)}).`;
}

/**
 * A side-by-side comparison lays out as one table whenever every card has
 * measures. Live 2026-10-13: Ledgerfold carried seven measures and F2 six
 * (each had one the other lacked), so the comparison fell back to two loose
 * cards. The rows are every measure any card has, in the order first seen;
 * a company without that measure shows it as not recorded, never as a low
 * level (unknown stays unknown).
 */
export function comparesAsTable(block: QAnswerCardsBlock): boolean {
  if (block.shape !== "SIDE_BY_SIDE" || block.cards.length < 2) return false;
  return block.cards.every((card) => card.measures.length > 0);
}

/** The comparison table's rows: every measure label, in first-seen order. */
export function compareRows(block: QAnswerCardsBlock): readonly string[] {
  const labels: string[] = [];
  for (const card of block.cards) {
    for (const measure of card.measures) {
      if (!labels.includes(measure.label)) labels.push(measure.label);
    }
  }
  return labels;
}

function folded(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The card a spoken sentence is about: the card it names first. Names
 * are matched as whole words, case and punctuation aside ("Norrland's"
 * names Norrland Grid only when the full name is said, and a name that
 * appears inside a longer word is not a mention). Null: the sentence
 * names none of them, and focus stays where it is.
 */
export function focusForSaid(
  cards: readonly Pick<QAnswerCard, "name">[],
  sentence: string,
): number | null {
  const said = ` ${folded(sentence)} `;
  let best: number | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const [index, card] of cards.entries()) {
    const name = folded(card.name);
    if (name.length === 0) continue;
    const at = said.indexOf(` ${name} `);
    if (at >= 0 && at < bestAt) {
      best = index;
      bestAt = at;
    }
  }
  return best;
}

export type PlaybackStep = {
  readonly focus: number;
  readonly said: string;
  readonly ms: number;
};

/** Time to say a line aloud, near speaking pace, never rushed. */
export function sayingMs(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(2600, Math.round(words * 360));
}

/**
 * The walk-through of an answer when no live voice is driving it: each
 * card in focus while its line is said, then the overview (focus -1) with
 * Q's closing line. A card with no line of its own is said by its first
 * reason.
 */
export function playbackSteps(
  block: QAnswerCardsBlock,
  closing: string,
): readonly PlaybackStep[] {
  const steps: PlaybackStep[] = block.cards.map((card, focus) => {
    const said = spokenLine(card);
    return { focus, said, ms: sayingMs(said) };
  });
  if (block.cards.length > 1) {
    steps.push({ focus: -1, said: closing, ms: 0 });
  }
  return steps;
}

/** An answer's ANSWER_CARDS block, if it carries one. */
export function answerCardsOf(
  turn: QTurn | undefined,
): QAnswerCardsBlock | null {
  if (turn === undefined || turn.kind !== "Q") return null;
  for (const block of turn.blocks) {
    if (block.kind === "ANSWER_CARDS") return block;
  }
  return null;
}

/**
 * Whether the conversation has moved on from the cards that answer
 * `answerId` showed (C4). Lane A: the stage's one rule (shown.ts
 * stageOf) -- replaced by a later answer's own object, kept while an
 * answer or its question is about them, back when the subject returns.
 */
export function topicMovedOn(
  turns: readonly QTurn[],
  answerId: string,
): boolean {
  const first = turns.find((turn) => turn.id === answerId);
  if (answerCardsOf(first) === null) return false;
  return stageOf(shownItems(turns), turns).item?.id !== answerId;
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

export type AnswerChipContent = {
  readonly answerId: string;
  readonly heading: string;
  readonly names: string;
  readonly hues: readonly number[];
};

/**
 * The compact chip other pages show for a new answer with cards (C6):
 * the newest such answer that was neither on screen before this page
 * opened nor dismissed. Files keep their own floating card.
 */
export function answerChipFor(
  turns: readonly QTurn[],
  before: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): AnswerChipContent | null {
  const turn = turns.findLast(
    (one) => one.kind === "Q" && !one.streaming && answerCardsOf(one) !== null,
  );
  const block = answerCardsOf(turn);
  if (turn === undefined || block === null) return null;
  if (before.has(turn.id) || dismissed.has(turn.id)) return null;
  const n = block.cards.length;
  const heading =
    block.shape === "RESEARCH"
      ? "Research ready"
      : block.shape === "SIDE_BY_SIDE"
        ? "Comparison ready"
        : n === 1
          ? "Top pick ready"
          : `Top ${NUMBER_WORDS[n] ?? String(n)} ready`;
  return {
    answerId: turn.id,
    heading,
    names: block.cards
      .slice(0, 4)
      .map((card) => card.name.split(/\s+/u)[0] ?? card.name)
      .join(", "),
    hues: block.cards.slice(0, 7).map((card) => card.hue),
  };
}
