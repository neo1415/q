"use client";

import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";

import { useT } from "@/features/i18n/language";

/**
 * The Relationships page's empty and unreadable states, in the person's
 * language. A client leaf so the index stays usable from server and
 * client pages alike.
 */
export function RelationshipsEmpty({
  sentence,
  href,
  action,
  importable = false,
}: {
  readonly sentence: string;
  readonly href: string;
  readonly action: string;
  /**
   * D2 (admin design 2026-11-19): an empty pipeline also offers to bring
   * the one they already keep, rather than hiding the import a view away.
   */
  readonly importable?: boolean | undefined;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-4" data-state="empty">
      <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
        {t(sentence)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={href} className={buttonClassName("secondary")}>
          {t(action)}
        </Link>
        {importable ? (
          <Link
            href="/relationships/import"
            className={buttonClassName("secondary")}
            data-import-pipeline
          >
            {t("Import your pipeline")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function RelationshipsUnavailable() {
  const t = useT();
  return (
    <p
      className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)"
      data-state="unavailable"
    >
      {t("Your relationships couldn't be read just now. Reload in a moment.")}
    </p>
  );
}
