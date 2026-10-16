import "server-only";

import { getCompanyDeck } from "@capital-q/api-client";

import { apiSession, resolveOwnContext } from "@/features/q/context";

import { deckReviewHref, pendingDeckSections } from "./deck-pending";

export type OwnDeckReview = {
  readonly companyId: string;
  readonly pending: number;
  readonly href: string;
};

/**
 * The signed-in founder's own deck review, for Needs you and Home: null
 * when they are not a founder, have nothing pending, or it could not be
 * read (a quiet absence, never a guess).
 */
export async function ownDeckReview(): Promise<OwnDeckReview | null> {
  try {
    const context = await resolveOwnContext();
    if (context.kind !== "FOUNDER") return null;
    const session = await apiSession();
    if (session === null) return null;
    const view = await getCompanyDeck(session, context.companyId);
    const pending = pendingDeckSections(view);
    return pending === 0
      ? null
      : {
          companyId: context.companyId,
          pending,
          href: deckReviewHref(context.companyId),
        };
  } catch {
    return null;
  }
}
