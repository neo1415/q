import Link from "next/link";

import type { FundraisingDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";

/**
 * The raise in money (spec 6.6.15): confirmed by both sides, soft (said
 * but not confirmed), who is in conversation, and what remains of the
 * target. Each investor counts once, in one bucket; other currencies are
 * listed, never converted into the target's.
 */
export function FundraisingPanel({
  fundraising,
}: {
  readonly fundraising: FundraisingDto;
}) {
  const currency = fundraising.target?.currencyCode ?? "USD";
  const inTarget = fundraising.totals.find(
    (total) => total.currencyCode === currency,
  );
  const others = fundraising.totals.filter(
    (total) => total.currencyCode !== currency,
  );
  const figures: readonly { readonly term: string; readonly value: string }[] =
    [
      {
        term: "Confirmed",
        value: `${currency} ${formatAmountForDisplay(inTarget?.confirmed ?? "0")}`,
      },
      {
        term: "Soft",
        value: `${currency} ${formatAmountForDisplay(inTarget?.soft ?? "0")}`,
      },
      {
        term: "In conversation",
        value: String(fundraising.pipeline),
      },
      ...(fundraising.remaining === null
        ? []
        : [
            {
              term: "Remaining",
              value: `${currency} ${formatAmountForDisplay(fundraising.remaining)}`,
            },
          ]),
    ];
  return (
    <div className="flex flex-col gap-4" data-fundraising>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.term} className="flex flex-col gap-1">
            <dt className="cq-caption text-(--cq-text-secondary)">
              {figure.term}
            </dt>
            <dd className="cq-title-sm text-(--cq-text-primary) tabular-nums">
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>
      {others.length === 0 ? null : (
        <p className="cq-caption text-(--cq-text-secondary)">
          Also:{" "}
          {others
            .map(
              (total) =>
                `${total.currencyCode} ${formatAmountForDisplay(total.confirmed)} confirmed, ${formatAmountForDisplay(total.soft)} soft`,
            )
            .join("; ")}
        </p>
      )}
      {fundraising.investors.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
          {fundraising.investors.map((investor) => (
            <li
              key={investor.relationshipId}
              className="flex items-center justify-between gap-3 py-2"
            >
              <Link
                href={`/relationships/investor/${investor.investorOrganisationId}`}
                className="cq-body-sm text-(--cq-text-primary) hover:underline"
              >
                {investor.investorName}
              </Link>
              <span className="cq-body-sm text-(--cq-text-secondary) tabular-nums">
                {investor.currencyCode}{" "}
                {formatAmountForDisplay(investor.amount)} ·{" "}
                {investor.bucket === "CONFIRMED" ? "Confirmed" : "Soft"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div>
        <a
          href="/capital/export"
          className={buttonClassName("quiet", "compact")}
          download
        >
          Download CSV
        </a>
      </div>
    </div>
  );
}
