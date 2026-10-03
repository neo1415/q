import type { QTurn, QTurnObjectBlock } from "./conversation";

/**
 * What the Q page shows over Q's presence (founder request 2026-10-03).
 *
 * The Q page is Q's presence, not a transcript: the words live in Chat.
 * The page shows something only when Q has something to show -- a
 * document, a comparison, cards, a question back -- and that object steps
 * back once the conversation has moved on a few answers. Everything shown
 * in this session stays one tap away under "Shown recently", and Q can
 * show it again when asked (a later answer carrying the same object is
 * simply shown again).
 *
 * A change waiting for approval is never one of these: it is decided where
 * it is shown (QNow), and stays there until it is decided.
 */

/** Q answers after which a shown object steps back to "Shown recently". */
export const SHOWN_FOR_ANSWERS = 3;
/** How many recent objects the side list keeps. */
export const SHOWN_RECENTLY_MAX = 8;

const SHOWABLE: ReadonlySet<QTurnObjectBlock["kind"]> = new Set([
  "ARTIFACT_REFERENCE",
  "COMPARISON",
  "COMPARISON_CARDS",
  "CLARIFICATION_REQUEST",
]);

export type ShownItem = {
  /** The answer that showed it. */
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly QTurnObjectBlock[];
  /** Which of Q's answers (counting from 1) showed it. */
  readonly answer: number;
};

function titleOf(blocks: readonly QTurnObjectBlock[]): string {
  for (const block of blocks) {
    switch (block.kind) {
      case "ARTIFACT_REFERENCE":
        return block.title;
      case "COMPARISON_CARDS":
        if (block.title !== null && block.title.length > 0) return block.title;
        return "Comparison";
      case "COMPARISON":
        return "Comparison";
      case "CLARIFICATION_REQUEST":
        return block.question;
      case "COMPANY_REFERENCE":
      case "INVESTOR_REFERENCE":
      case "ACTION_PROPOSAL":
      case "UI_INTENT":
        break;
    }
  }
  return "Shown by Q";
}

/** Every object Q's settled answers showed, oldest first. */
export function shownItems(turns: readonly QTurn[]): readonly ShownItem[] {
  const items: ShownItem[] = [];
  let answer = 0;
  for (const turn of turns) {
    if (turn.kind !== "Q") continue;
    answer += 1;
    if (turn.streaming) continue;
    const blocks = turn.blocks.filter((block) => SHOWABLE.has(block.kind));
    if (blocks.length === 0) continue;
    items.push({ id: turn.id, title: titleOf(blocks), blocks, answer });
  }
  return items;
}

/** How many answers Q has given in these turns. */
export function answersIn(turns: readonly QTurn[]): number {
  return turns.filter((turn) => turn.kind === "Q").length;
}

/**
 * What is over the presence now: the newest shown object while fewer than
 * SHOWN_FOR_ANSWERS answers have followed it and it was not dismissed; or
 * one reopened from "Shown recently", which counts from when it was
 * reopened.
 */
export function onStage(
  items: readonly ShownItem[],
  answers: number,
  dismissed: ReadonlySet<string>,
  reopened: { readonly id: string; readonly atAnswer: number } | null,
): ShownItem | null {
  const newest = items.at(-1);
  const newestLive =
    newest !== undefined &&
    !dismissed.has(newest.id) &&
    answers - newest.answer < SHOWN_FOR_ANSWERS
      ? newest
      : null;
  if (reopened !== null) {
    const item = items.find((one) => one.id === reopened.id);
    const live =
      item !== undefined &&
      !dismissed.has(`${item.id}@${String(reopened.atAnswer)}`) &&
      answers - reopened.atAnswer < SHOWN_FOR_ANSWERS;
    // Something Q showed after the reopening comes first.
    if (
      item !== undefined &&
      live &&
      (newestLive === null || newestLive.answer <= reopened.atAnswer)
    ) {
      return item;
    }
  }
  return newestLive;
}

/** The side list: the latest objects, newest first. */
export function shownRecently(
  items: readonly ShownItem[],
): readonly ShownItem[] {
  return items.slice(-SHOWN_RECENTLY_MAX).reverse();
}
