import type { QAnswerCard, QAnswerCardsBlock } from "@capital-q/contracts";

import type { QTurn } from "./conversation";

/**
 * The spotlight on a set of answer cards (founder, Dubai demo 2026-10-09:
 * "when we are talking about a specific company, let that one enlarge and
 * let it be the only one there while the rest are very small, and it can
 * move between cards/companies like that").
 *
 * Which card the conversation is about, decided by code, never a model:
 *
 * 1. structured first: a later answer's own subject references (the
 *    run's authorised COMPANY_/INVESTOR_REFERENCE blocks, which carry B's
 *    reference resolution and the voice line's delegated runs);
 * 2. "the second one", "number three", "the last one" in the person's
 *    words, against this set's own order (the screen's order is what
 *    they see; B binds the same reference server-side);
 * 3. the cards' own names in the person's or Q's words, a closed set.
 *
 * A turn that points at one card spotlights it; one that points at two or
 * more puts them back level; one that points at none leaves the spotlight
 * where it was. A tap is the person's own choice and stands until a later
 * turn points somewhere. Pure, so every rule is a test.
 */

export type SpotlightTap = {
  /** The card tapped; -1: the person put them back level. */
  readonly index: number;
  /** How many turns the conversation had when they tapped. */
  readonly at: number;
};

/** A stable name for one card set, the same on every surface. */
export function setKeyOf(block: QAnswerCardsBlock): string {
  return `${block.title}\u0000${block.cards.map((card) => card.key).join(",")}`;
}

function folded(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const THING = "(?:one|company|card|pick|option|startup|result|investor)";

/**
 * "The second one", "number 3", "#2", "the last one": a position in this
 * set (0-based), or null. Only a position the set has.
 */
export function ordinalIn(text: string, count: number): number | null {
  const said = ` ${folded(text)} `;
  const last = new RegExp(`\\b(?:the )?last ${THING}\\b`, "u");
  if (last.test(said)) return count > 0 ? count - 1 : null;
  const word = new RegExp(
    `\\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) ${THING}\\b`,
    "u",
  ).exec(said);
  const numbered =
    /\bnumber (one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b/u.exec(
      said,
    );
  const hash = /#\s?(\d{1,2})\b/u.exec(text);
  const raw = word?.[1] ?? numbered?.[1] ?? hash?.[1];
  if (raw === undefined) return null;
  const n = ORDINALS[raw] ?? Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
}

/** Positions of the cards a text names (whole names, a closed set). */
export function cardsNamedIn(
  cards: readonly Pick<QAnswerCard, "name">[],
  text: string,
): readonly number[] {
  const said = ` ${folded(text)} `;
  const found: number[] = [];
  cards.forEach((card, index) => {
    const name = folded(card.name);
    if (name.length > 0 && said.includes(` ${name} `)) found.push(index);
  });
  return found;
}

function subjectIdOf(card: Pick<QAnswerCard, "subject">): string | null {
  const subject = card.subject;
  if (subject === null) return null;
  if (subject.kind === "COMPANY") return subject.companyId.toLowerCase();
  if (subject.kind === "INVESTOR_ORGANISATION") {
    return subject.investorOrganisationId.toLowerCase();
  }
  return null;
}

/** Positions of the cards a later turn points at, best signal first. */
export function cardsReferredBy(
  turn: QTurn,
  cards: readonly Pick<QAnswerCard, "name" | "subject">[],
): readonly number[] {
  if (turn.kind === "PERSON") {
    const ordinal = ordinalIn(turn.text, cards.length);
    if (ordinal !== null) return [ordinal];
    return cardsNamedIn(cards, turn.text);
  }
  if (turn.streaming) return [];
  // Structured: the run's own authorised subjects.
  const refs = new Set(
    turn.blocks.flatMap((block) =>
      block.kind === "COMPANY_REFERENCE"
        ? [block.companyId.toLowerCase()]
        : block.kind === "INVESTOR_REFERENCE"
          ? [block.investorOrganisationId.toLowerCase()]
          : [],
    ),
  );
  if (refs.size > 0) {
    const hits = cards.flatMap((card, index) => {
      const id = subjectIdOf(card);
      return id !== null && refs.has(id) ? [index] : [];
    });
    if (hits.length > 0) return hits;
  }
  return cardsNamedIn(cards, turn.text);
}

/**
 * The card in the spotlight for the set `answerId` showed, from what was
 * said after it and the person's last tap; null: all cards level.
 */
export function spotlightOf(input: {
  readonly turns: readonly QTurn[];
  readonly answerId: string;
  readonly cards: readonly Pick<QAnswerCard, "name" | "subject">[];
  readonly tap?: SpotlightTap | null | undefined;
}): number | null {
  const at = input.turns.findIndex((turn) => turn.id === input.answerId);
  const own = input.turns[at];
  const run = own?.kind === "Q" ? (own.runId ?? own.id) : null;
  let spot: number | null = null;
  const tap = input.tap ?? null;
  let tapped = false;
  const applyTap = () => {
    if (tap === null || tapped) return;
    tapped = true;
    spot = tap.index >= 0 && tap.index < input.cards.length ? tap.index : null;
  };
  // Turns after the set (none known: a set from elsewhere, taps only).
  const after = at < 0 ? [] : input.turns.slice(at + 1);
  after.forEach((turn, offset) => {
    if (tap !== null && at + 1 + offset >= tap.at) applyTap();
    // A later copy of the same run is the same answer, not a new signal.
    if (turn.kind === "Q" && (turn.runId ?? turn.id) === run) return;
    const hits = [...new Set(cardsReferredBy(turn, input.cards))];
    if (hits.length === 1) spot = hits[0] ?? null;
    else if (hits.length > 1) spot = null;
  });
  applyTap();
  return spot;
}
