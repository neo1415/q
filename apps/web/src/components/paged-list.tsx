"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "@capital-q/ui";
import { useT } from "@/features/i18n/language";

/**
 * A list that shows one page and opens the next on request (owner
 * 2026-10-16: lists that run past a screen had no pagination). Cursor,
 * never offset: the page ends at a row's own key, so a row that leaves or
 * arrives between pages never shifts what the next page starts from.
 * Server-rendered rows, client-held position; "Show fewer" returns to the
 * first page. Focus moves to the first new row, and the count is spoken.
 */
export type PagedItem = { readonly key: string; readonly node: ReactNode };

export function pageThrough(
  items: readonly PagedItem[],
  through: string | null,
  pageSize: number,
): number {
  const at = through === null ? -1 : items.findIndex((i) => i.key === through);
  return at < 0 ? Math.min(pageSize, items.length) : at + 1;
}

export function PagedList({
  items,
  pageSize,
  noun,
  className,
  itemClassName,
  footerClassName,
  ...rest
}: {
  readonly items: readonly PagedItem[];
  readonly pageSize: number;
  /** What the rows are, plural: "Show 8 more companies". */
  readonly noun: string;
  readonly className?: string | undefined;
  readonly itemClassName?: string | undefined;
  readonly footerClassName?: string | undefined;
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  const t = useT();
  const [through, setThrough] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = pageThrough(items, through, pageSize);
  const left = items.length - shown;

  useEffect(() => {
    if (focusKey === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-paged-key="${CSS.escape(focusKey)}"]`,
    );
    const target =
      row?.querySelector<HTMLElement>("a, button, [tabindex]") ?? row;
    target?.focus();
  }, [focusKey]);

  const more = () => {
    const next = items.slice(shown, shown + pageSize);
    const last = next.at(-1);
    if (last === undefined) return;
    setThrough(last.key);
    setFocusKey(next[0]?.key ?? null);
  };

  return (
    <>
      <ul ref={listRef} className={className} {...rest}>
        {items.slice(0, shown).map((item) => (
          <li
            key={item.key}
            data-paged-key={item.key}
            tabIndex={-1}
            className={cx("outline-none", itemClassName)}
          >
            {item.node}
          </li>
        ))}
      </ul>
      {items.length <= pageSize ? null : (
        <div
          className={cx(
            "flex flex-wrap items-center justify-between gap-3",
            footerClassName,
          )}
        >
          <p
            className="cq-caption cq-numeric text-(--cq-text-tertiary)"
            aria-live="polite"
          >
            {`${String(shown)} of ${String(items.length)} ${noun}`}
          </p>
          {left > 0 ? (
            <button
              type="button"
              onClick={more}
              className="cq-body-sm inline-flex min-h-11 items-center border border-(--cq-border) bg-(--cq-surface) px-3 font-medium text-(--cq-text-primary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) active:scale-[0.98]"
            >
              {`Show ${String(Math.min(pageSize, left))} more`}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setThrough(null);
                setFocusKey(null);
                listRef.current?.scrollIntoView?.({ block: "nearest" });
              }}
              className="cq-body-sm inline-flex min-h-11 items-center px-3 text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            >
              {t("Show fewer")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
