import type {
  QAnswerCard,
  QAnswerCardLevel,
  QAnswerCardsBlock,
} from "@capital-q/contracts";

import type { QTurn } from "./conversation";
import { cardsReferredBy } from "./spotlight";

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
 * Desktop: up to five in a row (the focused one wide); six or more, the
 * focused card beside a grid of the rest. Phone: one column; from four
 * cards, the rest become half-width tiles so the focused card is never
 * pushed off a 390px screen.
 */
export function canvasLayout(count: number, wide: boolean): CanvasLayout {
  return {
    layout: wide && count > 5 ? "grid" : "row",
    tiles: !wide && count >= 4,
  };
}

/** How a measure's level reads: a word, always beside its shape. */
export const LEVEL_WORD: Readonly<Record<QAnswerCardLevel, string>> = {
  STRONG: "Strong",
  GOOD: "Good",
  PARTIAL: "Partial",
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

/** Comparisons lay out as one table when every card has the same measures. */
export function comparesAsTable(block: QAnswerCardsBlock): boolean {
  if (block.shape !== "SIDE_BY_SIDE" || block.cards.length < 2) return false;
  const first = block.cards[0]?.measures.map((measure) => measure.label);
  if (first === undefined || first.length === 0) return false;
  return block.cards.every(
    (card) =>
      card.measures.length === first.length &&
      card.measures.every((measure, at) => measure.label === first[at]),
  );
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
    const said = card.said ?? `${card.name}: ${card.reasons[0] ?? ""}`.trim();
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
 * `answerId` showed (C4). It has when a later answer, now complete,
 * either brings cards of its own (they replace these) or names none of
 * these cards. A later answer that names one of them is a follow-up on
 * the same cards, and they stay. Decided by names, never by phrases.
 */
export function topicMovedOn(
  turns: readonly QTurn[],
  answerId: string,
): boolean {
  const at = turns.findIndex((turn) => turn.id === answerId);
  const first = turns[at];
  const own = answerCardsOf(first);
  if (at < 0 || own === null || first?.kind !== "Q") return false;
  // INC-1: the same run reaching the thread again (room feed, read-back)
  // is not a later answer; it never moves its own cards off the stage.
  const run = first.runId ?? first.id;
  for (const turn of turns.slice(at + 1)) {
    if (turn.kind !== "Q" || turn.streaming) continue;
    if ((turn.runId ?? turn.id) === run) continue;
    if (answerCardsOf(turn) !== null) return true;
    // Still on these cards when the answer is about one of them: its own
    // subject references (structured) or, failing those, their names.
    if (cardsReferredBy(turn, own.cards).length === 0) return true;
  }
  return false;
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
