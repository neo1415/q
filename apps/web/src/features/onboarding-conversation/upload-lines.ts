/**
 * What an upload during onboarding says, and to whom (live founder run
 * 2026-11-15, D1 and D5).
 *
 * - The notes Q is handed about an upload are the screen's, not the
 *   founder's words: they travel to Q as a turn, but the thread shows them
 *   as an upload event ("You shared deck.pdf"), never as "You: I've just
 *   uploaded …". `uploadEventOf` recognises exactly these notes, so a
 *   redrawn thread shows them the same way.
 * - Once the reading's findings are in, Q's next line is code's, from the
 *   reading itself: what the document says and the figures it read, with
 *   their pages, each waiting for the founder's yes. Nothing is saved until
 *   they confirm (CLAUDE.md: material Q-extracted facts need confirmation).
 */

export type UploadNote =
  | "READ_BACK"
  | "STILL_READING"
  | "READING_NOW"
  | "UNCLASSIFIED"
  | "PRIVATE"
  | "FINISHED_READING"
  | "WAITING_FOR_COMPANY"
  /**
   * The upload itself, kept in the thread the moment the file lands (D5,
   * re-check 2026-11-15): a deck whose findings Q reads back by code sends
   * Q no note, so without it the thread never showed "You shared …".
   */
  | "SHARED";

const NOTES: Readonly<Record<UploadNote, (name: string) => string>> = {
  READ_BACK: (name) =>
    `I've just uploaded ${name}. Read back what you found in it and check it with me.`,
  STILL_READING: (name) =>
    `I've just uploaded ${name}; it's still being read. Say you're reading it now and will show what you found in a minute, then carry on.`,
  READING_NOW: (name) =>
    `I've just uploaded ${name}; you're still reading it. Say you're reading it now and will show what you found in a minute, then carry on.`,
  UNCLASSIFIED: (name) =>
    `I've just uploaded ${name}. Its first pages didn't make clear what kind of document it is, so it's kept private and not read: ask me what it is.`,
  PRIVATE: (name) =>
    `I've just uploaded ${name}. It's a private document: just note that I've shared it, don't read it, and tell me what's still outstanding.`,
  FINISHED_READING: (name) =>
    `I've finished reading ${name}. Read back what you found in it and check it with me.`,
  WAITING_FOR_COMPANY: (name) =>
    `I've added ${name}; it's here and waiting. You'll read it the moment my company exists, so ask me the company's name.`,
  SHARED: (name) => `I've shared the file "${name}".`,
};

/** The note Q is handed about an upload, by kind. */
export function uploadNote(kind: UploadNote, fileName: string): string {
  return NOTES[kind](fileName);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const MARK = "\u0000";
const PATTERNS: readonly RegExp[] = Object.values(NOTES).map((note) => {
  const [before = "", after = ""] = note(MARK).split(MARK);
  return new RegExp(`^${escaped(before)}(.{1,255}?)${escaped(after)}$`, "u");
});

/** The file an upload note names, when the line is one; null otherwise. */
export function uploadEventOf(text: string): string | null {
  const line = text.trim();
  for (const pattern of PATTERNS) {
    const named = pattern.exec(line)?.[1];
    if (named !== undefined) return named;
  }
  return null;
}

/** One figure card the reading of this document prepared, waiting on them. */
export type DeckFigureCard = {
  readonly approvalId: string;
  readonly summary: string;
};

/**
 * The figure cards this upload's reading prepared: a document figure card
 * ("Keep your MRR of USD 42,000 for October 2026, from … (page 3)") asked
 * for since the upload began. Only the card's own words are used.
 */
export function deckFigureCards(
  pending: readonly {
    readonly approvalId: string;
    readonly summary: string;
    readonly requestedAt: string;
  }[],
  since: number,
): readonly DeckFigureCard[] {
  return pending
    .filter(
      (item) =>
        /^Keep your /u.test(item.summary) &&
        /\(page \d+\)/u.test(item.summary) &&
        Date.parse(item.requestedAt) >= since,
    )
    .map((item) => ({ approvalId: item.approvalId, summary: item.summary }))
    .slice(0, 8);
}

function clipped(text: string, max: number): string {
  const one = text
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.;\s]+$/u, "");
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Q's line once the document is read: what it says, the figures it read
 * with their pages, and that nothing is kept until they confirm. Said by
 * code from the reading, never a model's summary of it.
 */
export function deckReadLine(
  fileName: string,
  found: readonly { readonly label: string; readonly value: string }[],
  figures: readonly DeckFigureCard[],
): string {
  const says = found
    .slice(0, 3)
    .map((item) => `${item.label}: ${clipped(item.value, 160)}`);
  const read = figures.map((card) =>
    clipped(card.summary.replace(/^Keep your /u, ""), 200),
  );
  return [
    `I've read ${fileName}.`,
    says.length === 0 ? "" : `It says: ${says.join("; ")}.`,
    read.length === 0
      ? ""
      : `I read ${read.length === 1 ? "this figure" : "these figures"} in it: ${read.join("; ")}.`,
    "None of this is saved until you confirm it: keep or change each one below.",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

/**
 * Q's follow-up when the figure cards are filed after its read-back line
 * (live 2026-11-15: 22–24 s after it): each figure with its page, waiting
 * on their yes below. Said by code from the cards' own words.
 */
export function deckFiguresLaterLine(
  figures: readonly DeckFigureCard[],
): string {
  const read = figures.map((card) =>
    clipped(card.summary.replace(/^Keep your /u, ""), 200),
  );
  return `I also found ${read.length === 1 ? "this figure" : "these figures"}: ${read.join("; ")}. ${read.length === 1 ? "It isn't saved until you keep it below" : "None of them is saved until you keep each one below"}.`;
}

/**
 * One "You shared …" per file in the thread (D5): the upload is kept as
 * its own event when the file lands, and a note Q is then handed about it
 * ("…still being read") is the same event, not a second one.
 */
export function withoutRepeatedUploads<
  T extends { readonly uploaded?: string | undefined },
>(turns: readonly T[]): readonly T[] {
  const shown = new Set<string>();
  return turns.filter((turn) => {
    if (turn.uploaded === undefined) return true;
    if (shown.has(turn.uploaded)) return false;
    shown.add(turn.uploaded);
    return true;
  });
}
