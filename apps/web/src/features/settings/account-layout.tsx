import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@capital-q/ui";
import { ArrowLeft, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

/**
 * The account pages' frame (chosen designs 2026-10-21), server-safe: an
 * 820px column, the page head (a way back, the title, one line under it)
 * and the design's card. Presentation only; callers pass translated words.
 */

export function AccountColumn({
  children,
  width = "page",
  className,
}: {
  readonly children: ReactNode;
  /** page: 820px; form: 680px (verification, reviews). */
  readonly width?: "page" | "form" | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={cx(
        "mx-auto w-full px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8",
        width === "form"
          ? "max-w-[calc(680px+4rem)]"
          : "max-w-[calc(820px+4rem)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AccountHead({
  title,
  back,
  sub,
  right,
}: {
  readonly title: string;
  readonly back?: { readonly href: string; readonly label: string } | undefined;
  readonly sub?: ReactNode;
  readonly right?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {back === undefined ? null : (
        <Link
          href={back.href}
          className="-ms-1 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-(--cq-radius-md) px-1 text-sm text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          data-account-back
        >
          <ArrowLeft
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
            aria-hidden="true"
            className="rtl:rotate-180"
          />
          {back.label}
        </Link>
      )}
      <div className="flex min-h-11 items-center gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em] text-(--cq-text-primary) lg:text-[28px]">
          {title}
        </h1>
        {right === undefined ? null : (
          <div className="ms-auto flex items-center gap-2">{right}</div>
        )}
      </div>
      {sub === undefined ? null : (
        <p className="mt-1.5 max-w-[70ch] text-[15px] text-(--cq-text-secondary)">
          {sub}
        </p>
      )}
    </header>
  );
}

/** The design's card: 12px corners, one hairline, the raised surface. */
export function AccountCard({
  children,
  className,
  id,
  ...rest
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly id?: string | undefined;
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  return (
    <div
      id={id}
      className={cx(
        "flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A small heading above a group of cards, with an optional note at the end. */
export function GroupHead({
  title,
  note,
  id,
  className,
}: {
  readonly title: string;
  readonly note?: ReactNode;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cx("mt-7 mb-3 flex items-baseline gap-2.5", className)}>
      <h2
        id={id}
        className="m-0 text-[15px] font-semibold text-(--cq-text-primary)"
      >
        {title}
      </h2>
      {note === undefined ? null : (
        <span className="ms-auto text-xs text-(--cq-text-tertiary)">
          {note}
        </span>
      )}
    </div>
  );
}

/** One settings row: what it is and a sentence, then its control. */
export function SRow({
  title,
  description,
  children,
  id,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  readonly id?: string | undefined;
}) {
  return (
    <div
      id={id}
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-(--cq-border-subtle) py-3.5 first:border-t-0 sm:flex-nowrap"
      data-srow
    >
      <div className="flex min-w-[58%] flex-1 flex-col gap-0.5 sm:min-w-0">
        <b className="text-[15px] font-medium text-(--cq-text-primary)">
          {title}
        </b>
        {description === undefined ? null : (
          <span className="text-[13px] leading-[1.45] text-(--cq-text-secondary)">
            {description}
          </span>
        )}
      </div>
      {children === undefined ? null : (
        <div className="flex max-w-full min-w-0 flex-none flex-wrap items-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
