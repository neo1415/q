import Link from "next/link";

import type { QUsageDto } from "@capital-q/contracts";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { dollars, monthName, taskName, total } from "./usage-words";

/**
 * Settings → Usage (design-48): one figure for the month, then where it
 * went, by purpose and by standing instruction against its own limit.
 * Failed and unpriced calls are not shown here (lead decision: they belong
 * to the admin cost view); a person sees what their work cost, not how
 * the platform's calls fared. Plan allowances live on the plan page.
 */
export function UsageView({ usage }: { readonly usage: QUsageDto }) {
  const rows = usage.byTask.filter((row) => Number(row.usd) > 0);
  return (
    <div className="flex flex-col gap-6">
      <p className="flex items-baseline gap-2" data-usage-total>
        <span className="cq-numeric text-4xl font-semibold tracking-tight text-(--cq-text-primary)">
          {total(usage.totalUsd)}
        </span>
        <span className="cq-body text-(--cq-text-secondary)">USD</span>
        <span className="sr-only">
          in {monthName(usage.month)}, not charged
        </span>
      </p>
      {rows.length === 0 && usage.instructions.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Nothing used yet this month.
        </p>
      ) : (
        <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
          {rows.map((row) => (
            <div
              key={row.purpose}
              className="flex min-h-12 items-center justify-between gap-6 py-2"
            >
              <dt className="cq-body text-(--cq-text-primary)">
                {taskName(row.purpose)}
              </dt>
              <dd className="cq-body-sm cq-numeric text-(--cq-text-secondary)">
                {dollars(row.usd)}
              </dd>
            </div>
          ))}
          {usage.instructions.map((row) => (
            <div
              key={row.instructionId}
              className="flex min-h-12 items-center justify-between gap-6 py-2"
              data-usage-instruction
            >
              <dt className="cq-body line-clamp-1 min-w-0 text-(--cq-text-primary)">
                {row.goal}
              </dt>
              <dd className="cq-body-sm cq-numeric shrink-0 text-(--cq-text-secondary)">
                {dollars(row.usd)}
                {row.budgetUsdMonth === null
                  ? ""
                  : ` of ${dollars(row.budgetUsdMonth)}`}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {usage.plan === null ? null : (
        <Link
          href="/settings/plan"
          className="cq-body flex min-h-12 items-center justify-between border-b border-(--cq-border-subtle) text-(--cq-text-primary)"
        >
          Plan allowances
          <ChevronRight
            size={ICON_SIZE.regular}
            aria-hidden="true"
            className="text-(--cq-text-tertiary)"
          />
        </Link>
      )}
    </div>
  );
}
