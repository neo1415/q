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
}: {
  readonly sentence: string;
  readonly href: string;
  readonly action: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-4" data-state="empty">
      <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
        {t(sentence)}
      </p>
      <Link href={href} className={buttonClassName("secondary")}>
        {t(action)}
      </Link>
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
