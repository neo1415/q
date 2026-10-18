"use client";

import { useId, useState, type ReactNode } from "react";

import { cx } from "@capital-q/ui";
import { ChevronDown, ICON_SIZE } from "@capital-q/ui/icons";

/**
 * One bordered, square surface for one question on a workspace page
 * (owner 2026-10-16: the CRM Overview's sections were hard to tell apart).
 * A header bar names the question, its count and the one action that goes
 * with it; rows inside run edge to edge under hairlines, so a panel is
 * never a card of cards. `lead` marks the page's first question (what
 * needs the person) with the accent rule, the one emphasis on the page.
 */
export function Panel({
  id,
  title,
  headingLevel = 2,
  count,
  description,
  action,
  lead = false,
  flush = false,
  collapsible = false,
  defaultOpen = true,
  className,
  children,
  ...rest
}: {
  readonly id: string;
  readonly title: string;
  readonly headingLevel?: 2 | 3;
  /** A plain count beside the title; never a badge. */
  readonly count?: number | undefined;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly lead?: boolean;
  /** Rows run edge to edge; the body adds no padding of its own. */
  readonly flush?: boolean;
  /**
   * The title becomes a toggle with a caret (owner 2026-10-16: "Needs you"
   * shows only its name and count until opened). The header action shows
   * only while open.
   */
  readonly collapsible?: boolean;
  /** With `collapsible`: whether it starts open. */
  readonly defaultOpen?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  const bodyId = useId();
  const titleText = (
    <>
      {title}
      {count === undefined ? null : (
        <span className="cq-numeric ms-2 font-normal text-(--cq-text-tertiary)">
          {count}
        </span>
      )}
    </>
  );
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cx(
        "flex min-w-0 scroll-mt-4 flex-col border border-(--cq-border-subtle) bg-(--cq-surface)",
        lead && "border-s-[3px] border-s-(--cq-accent)",
        className,
      )}
      {...rest}
    >
      <header
        className={cx(
          "flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-5",
          open && "border-b border-(--cq-border-subtle)",
        )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading
            id={`${id}-title`}
            className={cx(
              headingLevel === 3 ? "cq-body font-semibold" : "cq-title-sm",
              "text-(--cq-text-primary)",
            )}
          >
            {collapsible ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setOpen((current) => !current)}
                className="inline-flex min-h-11 items-center gap-2 text-start focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              >
                <span>{titleText}</span>
                <ChevronDown
                  size={ICON_SIZE.compact}
                  aria-hidden="true"
                  className={cx(
                    "text-(--cq-text-secondary) transition-transform motion-reduce:transition-none",
                    open && "rotate-180",
                  )}
                />
              </button>
            ) : (
              titleText
            )}
          </Heading>
          {description === undefined ? null : (
            <p className="cq-caption text-(--cq-text-secondary)">
              {description}
            </p>
          )}
        </div>
        {open ? (action ?? null) : null}
      </header>
      <div
        id={bodyId}
        hidden={!open}
        className={flush ? "flex flex-col" : "flex flex-col gap-4 p-4 sm:p-5"}
      >
        {open ? children : null}
      </div>
    </section>
  );
}

/** A quiet link in a panel's header bar ("Open Capital", "Usage"). */
export const panelLinkClassName =
  "cq-body-sm inline-flex min-h-11 items-center text-(--cq-accent) underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)";
