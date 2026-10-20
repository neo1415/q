import type {
  CommitmentDto,
  RelationshipCommitmentsDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

import { money, totalsByCurrency } from "@/features/capital/money";

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

/** Where the current commitment stands, in words; null when nothing to add. */
export function commitmentStatusWords(
  read: RelationshipCommitmentsDto | undefined,
): string | null {
  const current = read?.current ?? null;
  return current === null ? null : (STATUS_WORDS[current.status] ?? null);
}

/**
 * Invested companies whose amount is not recorded: their commitment read
 * answered and holds none. A read that failed is not "none" and is left
 * out (its row says it couldn't be read instead).
 */
export function unrecordedInvestments(
  portfolio: readonly RelationshipSummaryDto[],
  commitments: ReadonlyMap<string, RelationshipCommitmentsDto | undefined>,
): readonly RelationshipSummaryDto[] {
  return portfolio.slice(0, PORTFOLIO_READ_LIMIT).filter((item) => {
    const read = commitments.get(item.relationshipId);
    return read !== undefined && read.current === null;
  });
}

/**
 * What the portfolio's known total can say: the recorded amounts by
 * currency, and how many companies have no amount or were not read here.
 * Unknown is never counted as zero.
 */
export function portfolioTotals(
  portfolio: readonly RelationshipSummaryDto[],
  commitments: ReadonlyMap<string, RelationshipCommitmentsDto | undefined>,
): {
  readonly known: readonly {
    readonly amount: string;
    readonly currency: string;
  }[];
  readonly unrecorded: number;
  readonly unread: number;
} {
  const known: { amount: string; currency: string }[] = [];
  let unrecorded = 0;
  let unread = 0;
  portfolio.forEach((item, index) => {
    const read =
      index < PORTFOLIO_READ_LIMIT
        ? commitments.get(item.relationshipId)
        : undefined;
    if (read === undefined) {
      unread += 1;
      return;
    }
    if (read.current === null) {
      unrecorded += 1;
      return;
    }
    known.push({
      amount: read.current.amount,
      currency: read.current.currencyCode,
    });
  });
  return { known: totalsByCurrency(known), unrecorded, unread };
}
