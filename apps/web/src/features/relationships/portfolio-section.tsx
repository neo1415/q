import Link from "next/link";

import type {
  RelationshipCommitmentsDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { PagedList } from "@/components/paged-list";
import { money, moneyList } from "@/features/capital/money";
import { EntityAvatar } from "@/features/entity/entity-avatar";

import { UnknownValue } from "./crm-kit";
import { dealDay } from "./deal-stage-strip";
import {
  commitmentStatusWords,
  PORTFOLIO_READ_LIMIT,
  portfolioTotals,
} from "./portfolio";
import { relationshipHref } from "./relationship-words";
import { serverTNow } from "@/features/i18n/server-now";

/** Rows per page: a portfolio longer than a screen pages by cursor. */
export const PORTFOLIO_PAGE = 8;

/**
 * Portfolio on the investor's CRM Overview (design 2026-10-20, "Morning
 * brief"): every company the firm invested in, newest first, one row each
 * opening the relationship record. The amount sits on the right; one that
 * is not recorded says so instead of counting as zero, and the known total
 * under the list says what it leaves out. `items` undefined: the
 * relationships could not be read (said, not none).
 */
export function PortfolioSection({
  items,
  commitments,
  agreed,
}: {
  /**
   * Commitments both sides confirmed whose money has not arrived yet
   * (Results' CONFIRMED line). They are not investments: the projector
   * reads INVESTED only on receipt or an INVESTED-level confirmation.
   * Undefined: not known, so nothing is said.
   */
  readonly agreed?:
    { readonly count: number; readonly amounts: readonly string[] } | undefined;
  readonly items: readonly RelationshipSummaryDto[] | undefined;
  readonly commitments: ReadonlyMap<
    string,
    RelationshipCommitmentsDto | undefined
  >;
}) {
  const t = serverTNow();
  const totals =
    items === undefined || items.length === 0
      ? null
      : portfolioTotals(items, commitments);

  return (
    <section
      id="portfolio"
      aria-label={t("Portfolio")}
      className="flex flex-col"
      data-portfolio
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
          {t("Portfolio")}
        </h2>
        {items === undefined || items.length === 0 ? null : (
          <span className="text-xs text-(--cq-text-tertiary)">
            {t("Newest first")}
          </span>
        )}
      </div>
      {items === undefined ? (
        <p
          className="rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-4 py-4 text-sm text-(--cq-text-secondary)"
          data-state="unavailable"
        >
          {t("Your portfolio couldn't be read just now. Nothing is lost.")}
        </p>
      ) : items.length === 0 ? (
        <div
          className="flex flex-col gap-2 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-4"
          data-state="empty"
        >
          <p className="text-sm text-(--cq-text-secondary)">
            {t(
              "No investments recorded yet. A company joins your portfolio when its money is marked received.",
            )}
          </p>
          {agreed === undefined || agreed.count === 0 ? null : (
            <p className="cq-numeric text-sm text-(--cq-text-primary)">
              {agreed.count === 1
                ? "1 commitment is confirmed and not yet received"
                : t(
                    `${String(agreed.count)} commitments are confirmed and not yet received`,
                  )}
              {agreed.amounts.length === 0
                ? ". "
                : t(` (${agreed.amounts.join(", ")}). `)}
              <Link
                href="/relationships?view=capital#commitments"
                className="font-medium text-(--cq-accent) underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              >
                {t("Open Capital")}
              </Link>
            </p>
          )}
        </div>
      ) : (
        <>
          <PagedList
            items={items.map((item, index) => {
              const read =
                index < PORTFOLIO_READ_LIMIT
                  ? commitments.get(item.relationshipId)
                  : undefined;
              const current = read?.current ?? null;
              const status = commitmentStatusWords(read);
              return {
                key: item.relationshipId,
                node: (
                  <Link
                    href={relationshipHref(item)}
                    className="grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3.5 px-4 py-3 transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
                    data-portfolio-row
                  >
                    <EntityAvatar
                      kind="company"
                      name={item.counterpart.name}
                      companyId={item.counterpart.id}
                      src={item.counterpart.photoUrl}
                      size={28}
                      decorative
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-(--cq-text-primary)">
                        {item.counterpart.name}
                      </span>
                      <span className="block text-xs text-(--cq-text-tertiary)">
                        {t(`Invested ${dealDay(item.stateSince)}`)}
                      </span>
                    </span>
                    {index >= PORTFOLIO_READ_LIMIT ? (
                      <span className="text-xs text-(--cq-text-tertiary)">
                        {t("Open for the amount")}
                      </span>
                    ) : read === undefined ? (
                      <span className="text-xs text-(--cq-text-tertiary)">
                        {t("Amount couldn't be read")}
                      </span>
                    ) : current === null ? (
                      <UnknownValue>{t("Amount not recorded")}</UnknownValue>
                    ) : (
                      <span className="flex flex-col items-end">
                        <span className="cq-numeric font-semibold text-(--cq-text-primary)">
                          {money(current.amount, current.currencyCode)}
                        </span>
                        {status === null || status === "received" ? null : (
                          <span className="text-xs text-(--cq-text-tertiary)">
                            {t(status)}
                          </span>
                        )}
                      </span>
                    )}
                    <ChevronRight
                      size={ICON_SIZE.compact}
                      aria-hidden="true"
                      className="text-(--cq-text-tertiary)"
                    />
                  </Link>
                ),
              };
            })}
            pageSize={PORTFOLIO_PAGE}
            noun="companies"
            className="flex flex-col divide-y divide-(--cq-border-subtle) overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
            footerClassName="pt-2"
          />
          {totals === null ? null : (
            <p
              className="cq-numeric mx-0.5 mt-2.5 text-xs text-(--cq-text-tertiary)"
              data-portfolio-total
            >
              {totalLine(totals, t)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** The known total, and exactly what it leaves out. */
function totalLine(
  totals: ReturnType<typeof portfolioTotals>,
  t: (text: string) => string,
): string {
  const known =
    totals.known.length === 0
      ? t("No amount is recorded yet.")
      : t(`Known total: ${moneyList(totals.known)}.`);
  const gaps = [
    totals.unrecorded === 0
      ? null
      : totals.unrecorded === 1
        ? t("One amount is not recorded")
        : t(`${String(totals.unrecorded)} amounts are not recorded`),
    totals.unread === 0
      ? null
      : totals.unread === 1
        ? t("one isn't read here")
        : t(`${String(totals.unread)} aren't read here`),
  ].filter((part): part is string => part !== null);
  if (gaps.length === 0) return known;
  return `${known} ${gaps.join(t(", and "))}${t(", so the total is incomplete.")}`;
}
