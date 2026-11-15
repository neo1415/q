import { deckFigureCards, type DeckFigureCard } from "./upload-lines";

/**
 * D1 (live founder re-check 2026-11-15, 64637e8c9): the deck's figure
 * cards come from server state, not from one read when the findings land.
 *
 * On production the findings and Q's line arrived at 12:39:00Z and the
 * page-cited figure cards were filed 22–24 s later (the figure reading is
 * its own job, woken by the same "document is read" signal). One read at
 * the findings found none, so Q's line named no figures and no card was
 * drawn; and since the cards lived only in page state, a reload never
 * brought them back.
 *
 * Now the cards are the person's own pending document figure approvals
 * (the same list and the same approve/reject actions the Work page uses),
 * read when the page opens and watched after a deck is read. The web has
 * no stream of approvals and no read of the figure job's own record, so the
 * watch is a bounded poll with backoff: it stops once the cards it found
 * have settled (two reads in a row add nothing) or at the cap. While it
 * runs with nothing yet, the screen says so; when it stops with nothing,
 * nothing is claimed either way (unknown stays unknown).
 */

/** The pending approvals as their requested approver reads them. */
export type PendingFigureApproval = {
  readonly approvalId: string;
  readonly summary: string;
  readonly requestedAt: string;
};

/** Backoff after a deck's findings land: ~105 s in all, then it stops. */
export const FIGURE_WATCH_DELAYS_MS: readonly number[] = [
  2_000, 3_000, 4_000, 6_000, 8_000, 10_000, 12_000, 15_000, 15_000, 15_000,
  15_000,
];

/** On opening the page with a read document: a shorter watch. */
export const FIGURE_WATCH_ON_OPEN_DELAYS_MS: readonly number[] = [
  3_000, 5_000, 8_000, 12_000, 15_000,
];

/** Reads in a row that add nothing before found cards count as settled. */
const SETTLED_AFTER = 2;

/**
 * Q's working line under the thread (live re-check 2026-11-15, 84ac9afa7:
 * "Reading …pdf" stayed up after Q's read-back line until the cards came
 * 62.7 s after the upload, so "Still reading figures…" was never seen).
 * A turn's own stage comes first; once the read-back is said and the
 * figure cards are still being read for, that is what the line says, in
 * place of the upload's note; otherwise the upload's note.
 */
export function workingNote(input: {
  readonly turnStage: string | null;
  readonly uploadNote: string | null;
  readonly figuresReading: boolean;
  /** "Still reading figures…", already translated. */
  readonly stillReading: string;
}): string | null {
  if (input.turnStage !== null) return input.turnStage;
  if (input.figuresReading) return input.stillReading;
  return input.uploadNote;
}

/** The cards shown, with any newly read ones added (never one twice). */
export function mergeFigureCards(
  now: readonly DeckFigureCard[],
  incoming: readonly DeckFigureCard[],
): readonly DeckFigureCard[] {
  const added = incoming.filter(
    (card) => !now.some((had) => had.approvalId === card.approvalId),
  );
  return added.length === 0 ? now : [...now, ...added];
}

/**
 * Watch the person's pending figure cards for those filed since `since`.
 * `onCards` gets every newly seen card as it is read; the result is every
 * card seen. A failed read counts as a read that added nothing; `stopped`
 * ends the watch early (the page went away).
 */
export async function watchDeckFigures(input: {
  readonly since: number;
  readonly read: () => Promise<readonly PendingFigureApproval[] | null>;
  readonly onCards: (cards: readonly DeckFigureCard[]) => void;
  readonly delays?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
  readonly stopped?: () => boolean;
  /** Cards already shown: they never count as new. */
  readonly known?: readonly DeckFigureCard[];
}): Promise<readonly DeckFigureCard[]> {
  const sleep =
    input.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delays = input.delays ?? FIGURE_WATCH_DELAYS_MS;
  let seen: readonly DeckFigureCard[] = input.known ?? [];
  const found: DeckFigureCard[] = [];
  let quiet = 0;
  for (const delay of delays) {
    await sleep(delay);
    if (input.stopped?.() === true) break;
    const pending = await input.read().catch(() => null);
    const cards = pending === null ? [] : deckFigureCards(pending, input.since);
    const fresh = cards.filter(
      (card) => !seen.some((had) => had.approvalId === card.approvalId),
    );
    if (fresh.length > 0) {
      seen = [...seen, ...fresh];
      found.push(...fresh);
      quiet = 0;
      input.onCards(fresh);
    } else if (found.length > 0) {
      // Only what this watch found settles it: cards from an earlier deck
      // say nothing about this one's, which can land 20 s and more later.
      quiet += 1;
      if (quiet >= SETTLED_AFTER) break;
    }
  }
  return found;
}
