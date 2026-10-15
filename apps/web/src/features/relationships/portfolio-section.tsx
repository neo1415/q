import Link from "next/link";

import type {
  RelationshipCommitmentsDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

import { PagedList } from "@/components/paged-list";
import { Panel } from "@/components/panel";
import { EntityAvatar } from "@/features/entity/entity-avatar";

import { dealDay } from "./deal-stage-strip";
import { commitmentLine, PORTFOLIO_READ_LIMIT } from "./portfolio";
import { relationshipHref } from "./relationship-words";

/** Rows per page: a portfolio longer than a screen pages by cursor. */
export const PORTFOLIO_PAGE = 8;

/**
 * Portfolio on the investor's CRM Overview (S4; redesign 2026-10-16):
 * every company the firm invested in, one row each, opening the
 * relationship record. Company on the left, the money line (the current
 * commitment in words) and since when on the right, aligned for scanning.
 * A company past the first rows says to open it rather than read every
 * commitment here. `items` undefined: the relationships could not be read
 * (said, not none).
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
    <Panel
      id="portfolio"
      title="Portfolio"
      count={
        items === undefined || items.length === 0 ? undefined : items.length
      }
      description="Companies you have invested in, newest first."
      flush
      data-portfolio
    >
      {items === undefined ? (
        <p
          className="cq-body-sm px-4 py-4 text-(--cq-text-secondary) sm:px-5"
          data-state="unavailable"
        >
          Your portfolio couldn&apos;t be read just now. Nothing is lost.
        </p>
      ) : items.length === 0 ? (
        <p
          className="cq-body-sm px-4 py-4 text-(--cq-text-secondary) sm:px-5"
          data-state="empty"
        >
          No investments recorded yet. A company joins your portfolio when a
          commitment is confirmed on its relationship.
        </p>
      ) : (
        <PagedList
          items={items.map((item, index) => ({
            key: item.relationshipId,
            node: (
              <Link
                href={relationshipHref(item)}
                className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring) sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5"
                data-portfolio-row
              >
                <EntityAvatar
                  kind="company"
                  name={item.counterpart.name}
                  companyId={item.counterpart.id}
                  size="sm"
                  decorative
                />
                <span className="cq-body-sm min-w-0 truncate font-semibold text-(--cq-text-primary)">
                  {item.counterpart.name}
                </span>
                <span className="cq-caption cq-numeric col-start-2 text-(--cq-text-secondary) sm:col-start-3 sm:text-right">
                  {index < PORTFOLIO_READ_LIMIT
                    ? commitmentLine(commitments.get(item.relationshipId))
                    : "Open for the commitment"}
                  {" · since "}
                  <time dateTime={item.stateSince}>
                    {dealDay(item.stateSince)}
                  </time>
                </span>
              </Link>
            ),
          }))}
          pageSize={PORTFOLIO_PAGE}
          noun="companies"
          className="flex flex-col divide-y divide-(--cq-border-subtle)"
          footerClassName="border-t border-(--cq-border-subtle) px-4 py-2 sm:px-5"
        />
      )}
    </Panel>
  );
}
