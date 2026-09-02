import type { ReactNode } from "react";

import { cx } from "@capital-q/ui";

/**
 * Page framing: 16 px mobile edge padding growing with the viewport, content
 * width capped at the content layout width. Pages that need full-bleed media
 * (the future Discover feed) simply do not use it.
 */
export function PageContainer({
  children,
  width = "content",
  className,
}: {
  readonly children: ReactNode;
  readonly width?: "content" | "reading" | "narrow" | undefined;
  readonly className?: string | undefined;
}) {
  const maxWidth = {
    content: "max-w-(--cq-layout-content)",
    reading: "max-w-(--cq-layout-reading)",
    narrow: "max-w-(--cq-layout-narrow)",
  }[width];
  return (
    <div
      className={cx(
        "mx-auto w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-8",
        maxWidth,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly children?: ReactNode | undefined;
}) {
  return (
    <header className="flex flex-col gap-2 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="cq-title-xl min-w-0 text-(--cq-text-primary)">
          {title}
        </h1>
        {children}
      </div>
      {description !== undefined ? (
        <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
          {description}
        </p>
      ) : null}
    </header>
  );
}

export function PageSection({
  id,
  title,
  titleHidden = false,
  description,
  children,
  className,
}: {
  readonly id: string;
  readonly title: string;
  readonly titleHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cx("scroll-mt-4", className)}
    >
      <div
        className={cx("flex flex-col gap-1", titleHidden ? "sr-only" : "pb-3")}
      >
        <h2 id={headingId} className="cq-title-md text-(--cq-text-primary)">
          {title}
        </h2>
        {description !== undefined ? (
          <p className="cq-body-sm max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
