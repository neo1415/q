import Link from "next/link";
import type { ReactNode } from "react";

import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { QControl } from "@/features/q/control/q-control";

/**
 * Settings building blocks (P5 redesign): a card per group, rows divided by
 * hairlines inside it (doc 18's panel: no shadow at rest, no nested cards).
 * Each row is a plain name, an optional one-line hint, and its control.
 */

export function SettingsCard({
  id,
  title,
  description,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  // RECOVERY-2026-10 (C1): each settings group is a section Q can bring
  // into view by name ("section.<id>").
  return (
    <QControl id={`section.${id}`} kind="SECTION">
      <section
        id={id}
        aria-labelledby={headingId}
        className="cq-panel scroll-mt-6 overflow-hidden"
      >
        <div className="flex flex-col gap-0.5 border-b border-(--cq-border-subtle) px-5 pt-4 pb-3">
          <h2 id={headingId} className="cq-title-sm text-(--cq-text-primary)">
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {description}
            </p>
          )}
        </div>
        <dl className="cq-panel-rows">{children}</dl>
      </section>
    </QControl>
  );
}

export function SettingRow({
  term,
  hint,
  children,
}: {
  readonly term: string;
  readonly hint?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
      <dt className="flex min-w-0 flex-col gap-0.5 sm:w-44 sm:shrink-0">
        <span className="cq-body text-(--cq-text-primary)">{term}</span>
        {hint === undefined ? null : (
          <span className="cq-caption text-(--cq-text-tertiary)">{hint}</span>
        )}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/** A secondary action that opens another page: 44 px on every screen. */
export const rowLinkClassName =
  "cq-body-sm inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-(--cq-border) bg-(--cq-surface) pr-3 pl-4 font-medium text-(--cq-text-primary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle)";

export function RowLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link href={href} className={rowLinkClassName}>
      {children}
      <ChevronRight
        size={ICON_SIZE.regular}
        aria-hidden="true"
        className="text-(--cq-text-tertiary)"
      />
    </Link>
  );
}

/**
 * The in-page index (desktop: a sticky list beside the cards; phone: a
 * scrollable row above them). Plain anchors, so it works without script.
 */
export function SettingsIndex({
  sections,
}: {
  readonly sections: readonly { readonly id: string; readonly label: string }[];
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="min-w-0 lg:sticky lg:top-6 lg:self-start"
    >
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:px-0">
        {sections.map((section) => (
          <li key={section.id} className="shrink-0">
            <a
              href={`#${section.id}`}
              className="cq-body-sm flex min-h-11 items-center rounded-(--cq-radius-md) px-3 whitespace-nowrap text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
