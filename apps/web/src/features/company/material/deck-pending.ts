import type { CompanyDeckView } from "@capital-q/contracts";

/**
 * The founder's own deck sections Q read that they have not checked yet
 * (lead 2026-10-16). Pure, over the OWNER deck view: a section counts when
 * Q read it as present and it is still PENDING (never confirmed, corrected
 * or marked as wrong). Investors see these only as unconfirmed, factor by
 * factor, never quoted (ADR 0075); confirming them is what makes them the
 * founder's confirmed claims.
 */
export function pendingDeckSections(view: CompanyDeckView | null): number {
  if (view === null || view.viewer !== "OWNER") return 0;
  const extraction = view.extraction;
  if (extraction === null) return 0;
  const present = extraction.sections.filter((s) => s.status === "PRESENT");
  const states = extraction.sectionStates;
  if (states === undefined) return extraction.confirmed ? 0 : present.length;
  const pending = new Set(
    states.filter((s) => s.state === "PENDING").map((s) => s.section),
  );
  return present.filter((s) => pending.has(s.section)).length;
}

/** Where the founder confirms them: the deck tab's section review. */
export function deckReviewHref(companyId: string): string {
  return `/company/${encodeURIComponent(companyId)}?tab=deck#check-read`;
}

/** "Confirm 6 deck sections…": what the founder can do about it, in words. */
export function deckReviewLine(pending: number): string {
  return pending === 1
    ? "Confirm 1 deck section: investors see it as unconfirmed, and your Investability stays an early read, until you do."
    : `Confirm ${String(pending)} deck sections: investors see them as unconfirmed, and your Investability stays an early read, until you do.`;
}

export const DECK_REVIEW_TITLE = "Confirm Q's reading of your deck";
