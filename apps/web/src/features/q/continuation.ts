import type { QTurn } from "./conversation";

/**
 * What Q says first when voice opens on a conversation already under way
 * (owner 2026-11-06): it carries on from this thread, never the arrival's
 * "welcome, N things are waiting". Deterministic and instant, from the
 * thread the page already holds -- the person's last words and what Q
 * answered -- so it never waits on a read. The line itself goes to the
 * same conversation (same id), so the voice has the whole Chat history.
 *
 * The server composes no opening on a resumed line (voice/routes.ts); a
 * model-written opener from the conversation's own state would be a
 * q-api change, proposed separately.
 */

type ThreadLine = {
  readonly role: "person" | "q";
  readonly text: string;
  readonly turn?: Extract<QTurn, { kind: "Q" }> | undefined;
};

/** The stored turns as thread lines, in order. */
export function threadOfTurns(turns: readonly QTurn[]): readonly ThreadLine[] {
  return turns.map((turn) =>
    turn.kind === "PERSON"
      ? { role: "person" as const, text: turn.text }
      : { role: "q" as const, text: turn.text, turn },
  );
}

const QUOTED_AT_MOST = 90;
const NUMBER_WORDS = [
  "none",
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

/** Their words, short enough to say back: whole words, no end stop. */
function quoted(text: string): string {
  const plain = text
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?\s]+$/u, "");
  if (plain.length <= QUOTED_AT_MOST) return plain;
  const cut = plain.slice(0, QUOTED_AT_MOST);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** How many cards an answer laid out (discovery, comparison). */
function cardsIn(turn: Extract<QTurn, { kind: "Q" }> | undefined): number {
  if (turn === undefined) return 0;
  let count = 0;
  for (const block of turn.blocks) {
    if (block.kind === "ANSWER_CARDS") count += block.cards.length;
    else if (block.kind === "COMPARISON_CARDS") count += block.items.length;
  }
  return count;
}

/**
 * Q's first words on a voice line opened mid-conversation, or null with
 * nothing said yet (then the arrival greeting is the right opening).
 */
export function continuationLine(lines: readonly ThreadLine[]): string | null {
  if (lines.length === 0) return null;
  const at = lines.findLastIndex((line) => line.role === "person");
  if (at < 0) {
    // Only Q has spoken (an opener nobody answered): carry on from it.
    return "Shall we carry on from where we were, or is there something else?";
  }
  const asked = quoted(lines[at]?.text ?? "");
  const answer = lines.slice(at + 1).findLast((line) => line.role === "q");
  if (answer === undefined) {
    return `You'd asked “${asked}”. Want me to carry on with that, or something else?`;
  }
  const cards = cardsIn(answer.turn);
  if (cards > 0) {
    const count = NUMBER_WORDS[cards] ?? String(cards);
    return `You'd asked “${asked}”, and I found ${count}. Want me to go through ${cards === 1 ? "it" : "them"}, or something else?`;
  }
  return `We were on “${asked}”. Want to pick up from there, or something else?`;
}
