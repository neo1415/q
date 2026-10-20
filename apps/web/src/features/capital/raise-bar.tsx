import type { CapitalLedgerDto } from "@capital-q/contracts";

import { minus, money, shareOf, totalsByCurrency } from "./money";

/**
 * The raise as one bar split by how far each amount has come (design
 * 2026-10-20): received (confirmed by the founder), sent but not yet
 * confirmed (hatched), confirmed by both sides, and stated by one side.
 * Each part has its words and amount in the legend, so colour only
 * repeats them. Shares are integer basis points, never floats; parts
 * never pass the target together.
 */

type Round = CapitalLedgerDto["rounds"][number];

export type RaiseParts = {
  readonly currency: string;
  readonly target: string;
  readonly received: string;
  readonly sent: string;
  readonly confirmed: string;
  readonly stated: string;
};

/** The current round's parts, in its own currency (others are said apart). */
export function raiseParts(
  round: Round,
  commitments: CapitalLedgerDto["commitments"],
): RaiseParts {
  const currency = round.target.currency;
  const sent =
    totalsByCurrency(
      commitments
        .filter(
          (item) =>
            item.roundId === round.id &&
            item.status === "TRANSFER_SENT" &&
            item.currencyCode === currency,
        )
        .map((item) => ({ amount: item.amount, currency })),
    )[0]?.amount ?? "0";
  return {
    currency,
    target: round.target.amount,
    received: round.sums.raised,
    sent,
    // The ledger's confirmed includes money marked sent; it is shown apart.
    confirmed: minus(round.sums.confirmed, sent),
    stated: round.sums.pledged,
  };
}

const PARTS = [
  { key: "received", label: "Received", fill: "bg-(--cq-positive)" },
  { key: "sent", label: "Sent, not confirmed", fill: "cq-crm-hatch" },
  { key: "confirmed", label: "Confirmed", fill: "bg-(--cq-accent)" },
  { key: "stated", label: "Stated", fill: "bg-(--cq-accent)/45" },
] as const;

export function RaiseBar({
  parts,
  words,
}: {
  readonly parts: RaiseParts;
  /** The words, translated by the caller. */
  readonly words: (english: string) => string;
}) {
  let left = 10000;
  const widths = PARTS.map((part) => {
    const width = Math.min(shareOf(parts[part.key], parts.target), left);
    left -= width;
    return width;
  });
  return (
    <div className="flex flex-col gap-2.5" data-raise-bar>
      <div
        className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-(--cq-surface-strong)"
        role="img"
        aria-label={words(
          `Raise of ${money(parts.target, parts.currency)}: ${PARTS.map((part) => `${money(parts[part.key], parts.currency)} ${part.label.toLowerCase()}`).join(", ")}`,
        )}
      >
        {PARTS.map((part, index) =>
          (widths[index] ?? 0) === 0 ? null : (
            <i
              key={part.key}
              data-meter={part.key}
              className={`block h-full transition-[width] duration-[400ms] ease-(--cq-ease) ${part.fill}`}
              style={{ width: `${String((widths[index] ?? 0) / 100)}%` }}
            />
          ),
        )}
      </div>
      <dl className="flex flex-wrap gap-x-[18px] gap-y-2 text-[13px] text-(--cq-text-secondary)">
        {PARTS.map((part) => (
          <div key={part.key} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden="true"
              className={`inline-block h-2.5 w-3 rounded-[3px] ${part.fill}`}
            />
            <dt>{words(part.label)}</dt>
            <dd className="cq-numeric font-semibold text-(--cq-text-primary)">
              {money(parts[part.key], parts.currency)}
            </dd>
          </div>
        ))}
        <div className="inline-flex items-center gap-1.5">
          <dt>{words("Target")}</dt>
          <dd className="cq-numeric font-semibold text-(--cq-text-primary)">
            {money(parts.target, parts.currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
