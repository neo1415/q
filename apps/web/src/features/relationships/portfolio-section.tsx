import Link from "next/link";

import type {
  RelationshipCommitmentsDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

import { dealDay } from "./deal-stage-strip";
import { commitmentLine, PORTFOLIO_READ_LIMIT } from "./portfolio";
import { relationshipHref } from "./relationship-words";

/**
 * Portfolio on the investor's CRM Overview (S4): every company the firm
 * invested in, one hairline row each, opening the relationship record.
 * The money line is the current commitment in words; a company past the
 * first rows says to open it rather than read every commitment here.
 * `items` undefined: the relationships could not be read (said, not none).
 */
export function PortfolioSection({
  items,
  commitments,
}: {
  readonly items: readonly RelationshipSummaryDto[] | undefined;
  readonly commitments: ReadonlyMap<
    string,
    RelationshipCommitmentsDto | undefined
  >;
}) {
  return (
    <section
      aria-labelledby="portfolio"
      className="flex flex-col gap-2"
      data-portfolio
    >
      <h2 id="portfolio" className="cq-title-sm text-(--cq-text-primary)">
        Portfolio
        {items === undefined || items.length === 0 ? null : (
          <span className="cq-numeric ml-2 font-normal text-(--cq-text-tertiary)">
            {items.length}
          </span>
        )}
      </h2>
      {items === undefined ? (
        <p
          className="cq-body-sm border-y border-(--cq-border-subtle) py-3 text-(--cq-text-secondary)"
          data-state="unavailable"
        >
          Your portfolio couldn&apos;t be read just now. Nothing is lost.
        </p>
      ) : items.length === 0 ? (
        <p
          className="cq-body-sm border-y border-(--cq-border-subtle) py-3 text-(--cq-text-secondary)"
          data-state="empty"
        >
          No investments recorded yet. A company joins your portfolio when a
          commitment is confirmed on its relationship.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
          {items.map((item, index) => (
            <li key={item.relationshipId}>
              <Link
                href={relationshipHref(item)}
                className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
                data-portfolio-row
              >
                <span className="cq-body-sm min-w-0 truncate font-semibold text-(--cq-text-primary)">
                  {item.counterpart.name}
                </span>
                <span className="cq-caption cq-numeric text-(--cq-text-secondary)">
                  {index < PORTFOLIO_READ_LIMIT
                    ? commitmentLine(commitments.get(item.relationshipId))
                    : "Open for the commitment"}
                  {" · since "}
                  <time dateTime={item.stateSince}>
                    {dealDay(item.stateSince)}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
