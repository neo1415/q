import type { QNavigationOfferBlock } from "@capital-q/contracts";

import type { QTurn } from "./conversation";
import { resultKey } from "./shown";

/**
 * N1/N3 (owner 2026-11-04): an offer to open a page ("Open pipeline" /
 * "Stay here") is answerable while it is Q's latest word. The person's
 * typed or spoken "yes, open it" / "stay here" is resolved by the server
 * against Q's last message only, and answered with a message of its own;
 * once any later Q message is in the conversation the offer is settled --
 * answered, or moved on from -- on every device and after a reload,
 * because it is read from the conversation's durable messages, not from
 * this browser's storage alone.
 */
export function offerAnsweredLater(
  turns: readonly QTurn[],
  turnId: string,
): boolean {
  const at = turns.findIndex((turn) => turn.id === turnId);
  const offered = turns[at];
  if (offered?.kind !== "Q") return false;
  const run = resultKey(offered);
  return turns
    .slice(at + 1)
    .some((turn) => turn.kind === "Q" && resultKey(turn) !== run);
}

export type OpenOffer = {
  /** The Q message that carries it (its settle key's first part). */
  readonly turnId: string;
  readonly block: QNavigationOfferBlock;
};

/**
 * The offers the Q view's stage draws beside its object (block-surfaces
 * BESIDE): those of Q's latest settled answer (every message of its run),
 * none while a newer answer is still arriving.
 */
export function openOffers(turns: readonly QTurn[]): readonly OpenOffer[] {
  const latest = turns.findLast(
    (turn): turn is Extract<QTurn, { kind: "Q" }> => turn.kind === "Q",
  );
  if (latest === undefined || latest.streaming) return [];
  const run = resultKey(latest);
  const offers: OpenOffer[] = [];
  for (const turn of turns) {
    if (turn.kind !== "Q" || resultKey(turn) !== run) continue;
    for (const block of turn.blocks) {
      if (block.kind === "NAVIGATION_OFFER") {
        offers.push({ turnId: turn.id, block });
      }
    }
  }
  return offers;
}

/** One offer's settle key: its message and its own words, never a position. */
export function offerKey(
  turnId: string,
  block: Pick<QNavigationOfferBlock, "openLabel" | "place">,
): string {
  return `${turnId}:${block.place}:${block.openLabel}`;
}
