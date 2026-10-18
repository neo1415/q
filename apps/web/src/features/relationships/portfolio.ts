import type {
  CommitmentDto,
  RelationshipCommitmentsDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

import { money } from "@/features/capital/money";

/**
 * The investor's portfolio on the CRM Overview (S4, research 2026-10-15 §2:
 * "no portfolio list"): the relationships whose canonical state is
 * INVESTED, newest first. The state is the projector's, never inferred
 * here from money or messages.
 */

/** How many portfolio rows read their commitment beside the list. */
export const PORTFOLIO_READ_LIMIT = 12;

export function portfolioOf(
  items: readonly RelationshipSummaryDto[],
): readonly RelationshipSummaryDto[] {
  return items
    .filter((item) => item.state === "INVESTED")
    .toSorted(
      (a, b) =>
        Date.parse(b.stateSince) - Date.parse(a.stateSince) ||
        a.counterpart.name.localeCompare(b.counterpart.name),
    );
}

const STATUS_WORDS: Partial<Record<CommitmentDto["status"], string>> = {
  STATED: "stated, not yet confirmed",
  CONFIRMED: "confirmed",
  ADOPTED: "confirmed",
  TRANSFER_SENT: "sent",
  RECEIVED: "received",
  DISPUTED: "disputed",
};

/**
 * The money line for one portfolio company, in words, from the current
 * commitment as this side sees it. `undefined`: the read failed, which is
 * said; null current: none recorded, which is not zero.
 */
export function commitmentLine(
  read: RelationshipCommitmentsDto | undefined,
): string {
  if (read === undefined) return "Commitment couldn't be read";
  const current = read.current;
  if (current === null) return "No amount recorded";
  const words = STATUS_WORDS[current.status];
  const amount = money(current.amount, current.currencyCode);
  return words === undefined ? amount : `${amount} · ${words}`;
}
