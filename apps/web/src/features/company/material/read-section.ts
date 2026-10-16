import type { DeckFact, DeckSection } from "@capital-q/contracts";

/**
 * The shape the section card renders (deck-sections.tsx), in a plain
 * module so a server component can build it (lane ov 2026-10-16: the
 * profile Overview and Q's read of the deck share one card).
 */

/** "Slide 3", "Slides 2–4": where in the deck. */
export function slidesLine(pages: readonly number[]): string | null {
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  const first = unique[0] ?? 0;
  const last = unique.at(-1) ?? first;
  return first === last
    ? `Slide ${String(first)}`
    : `Slides ${String(first)}–${String(last)}`;
}

/**
 * One row of a section card: a label, its value (null: unknown), and the
 * tiny source line ("Founder's claim · Slide 1"). `group` starts a small
 * sub-heading when it changes (Traction's own rows in Opportunity).
 */
export type ReadFact = {
  readonly key: string;
  readonly label: string;
  readonly value: string | null;
  readonly source: string;
  readonly group?: string | null | undefined;
};

/**
 * One section as the card shows it. Q's read of the deck and the profile
 * Overview (lane ov 2026-10-16) both render this one card, so the two
 * never drift apart: the deck maps its twelve sections into it, the
 * Overview its own sections.
 */
export type ReadSection = {
  readonly key: string;
  /** The card's heading. */
  readonly label: string;
  /** The chip's words; the label when they fit. */
  readonly chip: string;
  readonly status: DeckSection["status"];
  readonly statusWords: string;
  readonly summary: string | null;
  /** Where the summary came from, when it is not the deck's own read. */
  readonly summarySource?: string | null | undefined;
  /** What the card says when there is no summary. */
  readonly emptyText: string;
  readonly facts: readonly ReadFact[];
  /** The footer's slides line ("Slides 2–3 · deck is view only"). */
  readonly where: string | null;
  /** "Ask Q about …": the question it starts. */
  readonly askHref: string;
  readonly askLabel: string;
  /** The founder's own gap: a prompt to tell Q (their own view only). */
  readonly prompt?:
    | {
        readonly href: string;
        readonly label: string;
        readonly question: string | null;
      }
    | undefined;
};

/** "Founder's claim · Slide 2 · as of Mar 2026": a deck fact's provenance. */
export function deckFactSource(fact: DeckFact): string {
  const where = slidesLine(fact.pages);
  return [
    fact.truthClass === "Q_INFERENCE" ? "Q's inference" : "Founder's claim",
    where,
    fact.evidenceStatus === "DOCUMENT_SUPPORTED"
      ? "supported by a data-room document"
      : null,
    fact.asOf === null ? null : `as of ${fact.asOf}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
