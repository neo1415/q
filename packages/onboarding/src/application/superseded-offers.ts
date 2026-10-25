import type {
  OnboardingSourceRef,
  OnboardingSuggestion,
} from "../contracts/index.js";
import { proposalSource } from "./coverage.js";
import { sameResponseValue } from "./pending-writes.js";

/**
 * A new offer read from the person's own material, against the offers
 * already waiting (live 25 Oct, run b9-0746: a second deck's "Stage · Seed"
 * sat beside the first deck's).
 *
 * The same value from their documents again supersedes the earlier offer:
 * one offer, citing every document it was read in, with the earlier kept
 * as EXPIRED history. A different value is a contradiction, never resolved
 * here: both stay until the person settles it. Offers from anywhere else
 * (Q's research, the conversation) are never touched by a document.
 */
export function supersededDocumentOffers(
  pending: readonly OnboardingSuggestion[],
  offer: {
    readonly stepKey: string;
    readonly suggestedValue: OnboardingSuggestion["suggestedValue"];
  },
): readonly OnboardingSuggestion[] {
  return pending.filter(
    (earlier) =>
      earlier.status === "PENDING" &&
      earlier.stepKey === offer.stepKey &&
      proposalSource(earlier.sourceRefs) === "DOCUMENT" &&
      sameResponseValue(earlier.suggestedValue, offer.suggestedValue),
  );
}

/**
 * The sources of an offer and of one it supersedes, newest first, each
 * once, within the 20 references a suggestion keeps.
 */
export function withSources(
  newer: readonly OnboardingSourceRef[],
  older: readonly OnboardingSourceRef[],
): OnboardingSourceRef[] {
  const out: OnboardingSourceRef[] = [];
  for (const ref of [...newer, ...older]) {
    if (
      !out.some(
        (kept) =>
          kept.sourceType === ref.sourceType && kept.sourceId === ref.sourceId,
      )
    ) {
      out.push(ref);
    }
  }
  return out.slice(0, 20);
}
