import Link from "next/link";
import type { ReactNode } from "react";

import {
  ADMIN_LIST_SORTS,
  AdminListSortSchema,
  type AdminListSort,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";
import { fieldControlClassName } from "@capital-q/ui/input";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { serverTNow } from "@/features/i18n/server-now";

/**
 * The console's one list table (admin design 2026-11-19 §4 T2): a filter
 * bar, sortable columns, the server's total, keyset (cursor) pages and a
 * CSV of the current filter. Everything lives in the address, so a view
 * can be shared and Back works; the server reads each page under the
 * operator's own permission. On a phone each row is two lines.
 */

export type AdminTableColumn<Row> = {
  readonly id: string;
  readonly label: string;
  /** The sorts this column orders by, ascending then descending. */
  readonly sort?:
    { readonly asc: AdminListSort; readonly desc: AdminListSort } | undefined;
  readonly cell: (row: Row) => ReactNode;
  readonly numeric?: boolean | undefined;
};

export type AdminTableView = {
  readonly q: string;
  readonly sort: AdminListSort;
  /** Set when this is not the first page. */
  readonly cursor?: string | undefined;
};

export const SORT_WORDS: Readonly<Record<AdminListSort, string>> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name_asc: "Name, A to Z",
  name_desc: "Name, Z to A",
};

/** The address of a view: only what differs from the defaults is written. */
export function viewHref(
  basePath: string,
  view: {
    readonly q?: string;
    readonly sort?: AdminListSort;
    readonly cursor?: string;
  },
): string {
  const params = new URLSearchParams();
  if (view.q !== undefined && view.q.length > 0) params.set("q", view.q);
  if (view.sort !== undefined && view.sort !== "newest")
    params.set("sort", view.sort);
  if (view.cursor !== undefined) params.set("cursor", view.cursor);
  const text = params.toString();
  return text.length === 0 ? basePath : `${basePath}?${text}`;
}

export function AdminDataTable<Row>({
  title,
  basePath,
  csvPath,
  columns,
  rows,
  rowKey,
  rowHref,
  primary,
  secondary,
  view,
  total,
  nextCursor,
  searchLabel,
  placeholder,
  noun,
}: {
  readonly title: string;
  readonly basePath: string;
  /** The CSV of this filter, built from the same permissioned pages. */
  readonly csvPath: string;
  readonly columns: readonly AdminTableColumn<Row>[];
  /** Null when the read failed. */
  readonly rows: readonly Row[] | null;
  readonly rowKey: (row: Row) => string;
  readonly rowHref: (row: Row) => string;
  /** The phone's two lines. */
  readonly primary: (row: Row) => ReactNode;
  readonly secondary: (row: Row) => ReactNode;
  readonly view: AdminTableView;
  readonly total: number | null;
  readonly nextCursor: string | null;
  readonly searchLabel: string;
  readonly placeholder: string;
  /** Plural noun for counts and empty states, e.g. "accounts". */
  readonly noun: string;
}) {
  const t = serverTNow();
  const firstPage = view.cursor === undefined;
  return (
    <div className="flex flex-col gap-4" data-admin-table>
      <form
        action={basePath}
        method="get"
        role="search"
        className="flex flex-wrap items-end gap-2"
        data-admin-table-filters
      >
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <span className="cq-caption text-(--cq-text-secondary)">
            {t(searchLabel)}
          </span>
          <input
            name="q"
            type="search"
            defaultValue={view.q}
            placeholder={t(placeholder)}
            maxLength={100}
            className={`${fieldControlClassName} h-11 cq-body-sm lg:h-10`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="cq-caption text-(--cq-text-secondary)">
            {t("Order")}
          </span>
          <select
            name="sort"
            defaultValue={view.sort}
            className={`${fieldControlClassName} h-11 cq-body-sm lg:h-10`}
          >
            {ADMIN_LIST_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(SORT_WORDS[sort])}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClassName("secondary")}>
          {t("Apply")}
        </button>
        {view.q.length > 0 || view.sort !== "newest" ? (
          <Link href={basePath} className={buttonClassName("quiet")}>
            {t("Clear")}
          </Link>
        ) : null}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="m-0 cq-body-sm text-(--cq-text-secondary)"
          aria-live="polite"
          data-admin-table-total
        >
          {total === null
            ? t(`${title}: the count is not available.`)
            : t(
                view.q.length > 0
                  ? `${total.toLocaleString("en-GB")} ${noun} match "${view.q}"`
                  : `${total.toLocaleString("en-GB")} ${noun}`,
              )}
          {firstPage ? "" : t(" · a later page")}
        </p>
        {rows !== null && rows.length > 0 ? (
          <a
            href={viewHref(csvPath, { q: view.q, sort: view.sort })}
            className={buttonClassName("quiet", "compact")}
            download
            data-admin-table-csv
          >
            <Download
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            {t("Download CSV")}
          </a>
        ) : null}
      </div>

      {rows === null ? (
        <ErrorState
          title={t(`${title} couldn't load`)}
          description={t("Nothing changed. Try again in a moment.")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          title={t(view.q.length > 0 ? `No ${noun} match` : `No ${noun} yet`)}
          description={t(
            view.q.length > 0
              ? `Nothing found for "${view.q}". Clear the search to see every one.`
              : `When there are ${noun}, they appear here, newest first.`,
          )}
        />
      ) : (
        <>
          <div className="relative hidden overflow-x-auto rounded-(--cq-radius-lg) border border-(--cq-border-subtle) sm:block">
            <table className="w-full cq-body-sm" data-admin-table-grid>
              <caption className="sr-only">{t(title)}</caption>
              <thead className="sticky top-0 bg-(--cq-surface-raised)">
                <tr className="border-b border-(--cq-border-subtle)">
                  {columns.map((column) => (
                    <SortHeader
                      key={column.id}
                      column={column}
                      view={view}
                      basePath={basePath}
                      t={t}
                    />
                  ))}
                  <th className="w-8" aria-hidden="true" />
                </tr>
              </thead>
              <tbody className="divide-y divide-(--cq-border-subtle)">
                {rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className="text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
                  >
                    {columns.map((column, index) => (
                      <td
                        key={column.id}
                        className={cx(
                          "px-3 py-2.5 align-top",
                          column.numeric === true
                            ? "text-end tabular-nums"
                            : null,
                        )}
                      >
                        {index === 0 ? (
                          <Link
                            href={rowHref(row)}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {column.cell(row)}
                          </Link>
                        ) : (
                          column.cell(row)
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-2.5 text-(--cq-text-tertiary)">
                      <ChevronRight
                        aria-hidden="true"
                        size={ICON_SIZE.compact}
                        strokeWidth={ICON_STROKE}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul
            className="m-0 flex list-none flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle) p-0 sm:hidden"
            data-admin-table-rows
          >
            {rows.map((row) => (
              <li key={rowKey(row)}>
                <Link
                  href={rowHref(row)}
                  className="flex min-h-14 items-center gap-2 py-2.5"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate cq-body-sm font-medium text-(--cq-text-primary)">
                      {primary(row)}
                    </span>
                    <span className="truncate cq-caption text-(--cq-text-secondary)">
                      {secondary(row)}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                    className="text-(--cq-text-tertiary)"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {firstPage && nextCursor === null ? null : (
        <nav
          aria-label={t(`${title} pages`)}
          className="flex flex-wrap gap-2"
          data-admin-table-pages
        >
          {firstPage ? null : (
            <Link
              href={viewHref(basePath, { q: view.q, sort: view.sort })}
              className={buttonClassName("secondary", "compact")}
            >
              {t("First page")}
            </Link>
          )}
          {nextCursor === null ? null : (
            <Link
              href={viewHref(basePath, {
                q: view.q,
                sort: view.sort,
                cursor: nextCursor,
              })}
              className={buttonClassName("secondary", "compact")}
              data-admin-table-next
            >
              {t("Next page")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

function SortHeader<Row>({
  column,
  view,
  basePath,
  t,
}: {
  readonly column: AdminTableColumn<Row>;
  readonly view: AdminTableView;
  readonly basePath: string;
  readonly t: (english: string) => string;
}) {
  const sort = column.sort;
  const align = column.numeric === true ? "text-end" : "text-start";
  if (sort === undefined) {
    return (
      <th
        scope="col"
        className={cx(
          "px-3 py-2 cq-caption font-medium text-(--cq-text-secondary)",
          align,
        )}
      >
        {t(column.label)}
      </th>
    );
  }
  const direction =
    view.sort === sort.asc ? "asc" : view.sort === sort.desc ? "desc" : null;
  // The first press orders it ascending; a second, descending.
  const next = direction === "asc" ? sort.desc : sort.asc;
  return (
    <th
      scope="col"
      aria-sort={
        direction === "asc"
          ? "ascending"
          : direction === "desc"
            ? "descending"
            : "none"
      }
      className={cx("px-1 py-1 cq-caption font-medium", align)}
    >
      <Link
        href={viewHref(basePath, { q: view.q, sort: next })}
        className="inline-flex min-h-9 items-center gap-1 rounded-(--cq-radius-sm) px-2 text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
        data-admin-sort={column.id}
      >
        {t(column.label)}
        {direction === "asc" ? (
          <ArrowUp
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        ) : direction === "desc" ? (
          <ArrowDown
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        ) : null}
      </Link>
    </th>
  );
}

/** The table's shape while a page loads (admin `loading.tsx`). */
export function AdminDataTableSkeleton({
  rows = 8,
}: {
  readonly rows?: number;
}) {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      data-admin-table-loading
    >
      <div className="h-11 w-full max-w-md animate-pulse rounded-(--cq-radius-md) bg-(--cq-surface-subtle)" />
      <div className="h-4 w-40 animate-pulse rounded bg-(--cq-surface-subtle)" />
      <div className="flex flex-col divide-y divide-(--cq-border-subtle) rounded-(--cq-radius-lg) border border-(--cq-border-subtle)">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-3 py-3">
            <div className="h-4 w-1/3 animate-pulse rounded bg-(--cq-surface-subtle)" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-(--cq-surface-subtle)" />
            <div className="ms-auto h-4 w-16 animate-pulse rounded bg-(--cq-surface-subtle)" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The view a list page reads from its address; anything unknown is dropped. */
export function viewFrom(
  params: Readonly<Record<string, string | string[] | undefined>>,
): AdminTableView {
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const sort = AdminListSortSchema.safeParse(one("sort"));
  const cursor = one("cursor");
  return {
    q: (one("q") ?? "").trim().slice(0, 100),
    sort: sort.success ? sort.data : "newest",
    ...(cursor !== undefined && cursor.length > 0 && cursor.length <= 400
      ? { cursor }
      : {}),
  };
}
