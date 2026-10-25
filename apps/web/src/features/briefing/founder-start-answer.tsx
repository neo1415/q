"use client";

import Link from "next/link";

import { useT } from "@/features/i18n/language";

import { founderStartLines, type FounderStart } from "./founder-start";

/**
 * Q's first answer on a founder's first Home after onboarding: where they
 * stand, the gaps, the next thing and Q's work (founder-start.ts), said
 * under the greeting as Q's own lines, with the next thing one tap away
 * when the assessment says where it is done.
 */
export function FounderStartAnswer({
  start,
}: {
  readonly start: FounderStart;
}) {
  const t = useT();
  const lines = founderStartLines(start);
  return (
    <div
      className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-2 text-start"
      data-founder-start
    >
      {lines.map((line) => (
        <p key={line} className="cq-body cq-prose text-(--cq-text-primary)">
          {t(line)}
        </p>
      ))}
      {start.next?.href === null || start.next === null ? null : (
        <Link
          href={start.next.href}
          className="cq-body-sm min-h-11 self-start py-2.5 font-medium text-(--cq-text-primary) underline underline-offset-4"
          data-founder-start-next
        >
          {t("Go there")}
        </Link>
      )}
    </div>
  );
}
