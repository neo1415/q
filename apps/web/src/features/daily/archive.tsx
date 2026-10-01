import Link from "next/link";

import type { QDailyEditionSummary } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { formatDay } from "@/components/date-format";

/** Earlier editions of The Q Daily, newest first, a page at a time. */
export function DailyArchive({
  items,
  nextCursor,
}: {
  readonly items: readonly QDailyEditionSummary[];
  readonly nextCursor: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="daily-archive"
      className="flex flex-col gap-3"
      data-daily-archive
    >
      <h2 id="daily-archive" className="cq-title-sm text-(--cq-text-primary)">
        Earlier editions
      </h2>
      <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/daily/${item.id}`}
              className="flex min-h-11 flex-col gap-0.5 py-3 hover:bg-(--cq-surface-subtle) sm:flex-row sm:items-baseline sm:gap-4"
            >
              <span className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-44">
                {formatDay(item.editionDate)} · No. {item.number}
              </span>
              <span className="cq-body-sm text-(--cq-text-primary)">
                {item.headline ?? "A quiet edition"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {nextCursor === null ? null : (
        <Link
          href={`/daily?before=${nextCursor}`}
          className={buttonClassName("secondary", "compact", "self-start")}
        >
          Older editions
        </Link>
      )}
    </section>
  );
}
