import type { ReactNode } from "react";

import { cx } from "@capital-q/ui";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

/**
 * The relationship record's small parts (CRM prototypes 2026-10-20), shared
 * by its tabs: a card, Q's circled mark, a tag, Q's one line, and the
 * record's sheet. Presentation only: no reads, no state, no words of their
 * own (callers pass translated text), so server and client both use them.
 */

/** A record card: 12px corners, one hairline, a quiet heading. */
export function RecCard({
  title,
  id,
  icon,
  accent = false,
  className,
  children,
  ...rest
}: {
  readonly title?: ReactNode;
  readonly id?: string | undefined;
  readonly icon?: ReactNode;
  /** The one card that carries the next step: the accent's line. */
  readonly accent?: boolean | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
  readonly [data: `data-${string}`]: string | undefined;
}) {
  const heading = id === undefined ? undefined : `rec-${id}`;
  return (
    <section
      aria-labelledby={title === undefined ? undefined : heading}
      className={cx(
        "flex min-w-0 scroll-mt-24 flex-col gap-3 rounded-(--cq-radius-lg) border bg-(--cq-surface-raised) px-5 py-[18px]",
        accent ? "border-(--cq-accent)/60" : "border-(--cq-border-subtle)",
        className,
      )}
      {...rest}
    >
      {title === undefined ? null : (
        <h3
          id={heading}
          className="cq-body-sm flex items-center gap-2 font-medium text-(--cq-text-secondary)"
        >
          {icon}
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

/** Q's circled mark, beside words that are Q's (never alone). */
export function QCircle({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-grid size-5 flex-none place-items-center rounded-full border-[1.6px] border-current text-[11px] leading-none font-semibold",
        className,
      )}
    >
      Q
    </span>
  );
}

export type TagTone = "evidence" | "claim" | "accent" | "stone" | "dash";

const TAG: Readonly<Record<TagTone, string>> = {
  evidence: "bg-(--cq-positive-soft) text-(--cq-positive)",
  claim: "bg-(--cq-warning-soft) text-(--cq-warning)",
  accent: "bg-(--cq-accent-soft) text-(--cq-accent)",
  stone: "bg-(--cq-surface-subtle) text-(--cq-text-secondary)",
  dash: "border border-dashed border-(--cq-border) text-(--cq-text-tertiary)",
};

/** A small rounded tag; its words carry the meaning, the tone repeats it. */
export function Tag({
  tone,
  icon,
  children,
  className,
}: {
  readonly tone: TagTone;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cx(
        "cq-caption inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium whitespace-nowrap [&_svg]:size-3",
        TAG[tone],
        className,
      )}
      data-tag={tone}
    >
      {icon}
      {children}
    </span>
  );
}

/** Q's one line: what Q (or the record) says, and what it is not. */
export function QLine({
  children,
  note,
  className,
}: {
  readonly children: ReactNode;
  readonly note?: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={cx(
        "cq-body-sm flex items-start gap-2.5 rounded-(--cq-radius-lg) bg-(--cq-accent-soft) px-3.5 py-3 text-(--cq-text-primary)",
        className,
      )}
      data-q-line
    >
      <QCircle className="mt-px text-(--cq-accent)" />
      <div className="min-w-0">
        {children}
        {note === undefined ? null : (
          <small className="cq-caption mt-0.5 block text-(--cq-text-secondary)">
            {note}
          </small>
        )}
      </div>
    </div>
  );
}

/** A count beside a tab's name, in a small round pill. */
export function TabCount({ children }: { readonly children: ReactNode }) {
  return (
    <span className="cq-caption cq-numeric ms-1 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-(--cq-surface-subtle) px-1.5 text-[11px] font-semibold text-(--cq-text-secondary)">
      {children}
    </span>
  );
}

/**
 * The record's sheet: from the right on a large screen, from the bottom
 * on a phone. A sheet is portalled out of the page, so a warm-charcoal
 * page passes `charcoal` to keep its primary buttons in the same tone.
 */
export function RecordSheet({
  open,
  onOpenChange,
  title,
  description,
  charcoal = false,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly charcoal?: boolean | undefined;
  readonly children: ReactNode;
}) {
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      {open ? (
        <SheetContent
          title={title}
          description={description}
          side="side"
          className={cx(
            "max-lg:rounded-t-(--cq-radius-xl) lg:w-[520px]",
            charcoal ? "cq-charcoal" : undefined,
          )}
        >
          <div className="flex flex-col gap-4 pt-2">{children}</div>
        </SheetContent>
      ) : null}
    </SheetRoot>
  );
}

/** The record's dark tile colours: ink, or warm charcoal in its scope. */
export const TILE =
  "bg-[var(--cq-tile,var(--cq-text-primary))] text-[var(--cq-on-tile,var(--cq-text-inverse))]";
