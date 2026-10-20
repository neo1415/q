import type { MeetingDto } from "@capital-q/contracts";

import { formatDay } from "@/components/date-format";
import { serverTNow } from "@/features/i18n/server-now";

/**
 * The calls already behind this relationship (calls option 2, "Earlier"):
 * dated, in words that claim only what the calendar knows -- a past call
 * was "on" a day, a cancelled one was cancelled. Both sides see this list.
 */
export function CallsEarlier({
  meetings,
  now,
}: {
  readonly meetings: readonly MeetingDto[];
  readonly now: number;
}) {
  const t = serverTNow();
  const earlier = meetings
    .filter(
      (meeting) =>
        meeting.status === "CANCELLED" ||
        (meeting.status === "SCHEDULED" && Date.parse(meeting.endsAt) <= now),
    )
    .toSorted((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return (
    <section aria-labelledby="calls-earlier" className="flex flex-col gap-3">
      <h2
        id="calls-earlier"
        className="text-[20px] font-semibold tracking-[-0.01em] text-(--cq-text-primary)"
      >
        {t("Earlier")}
      </h2>
      <div className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-1.5">
        {earlier.length === 0 ? (
          <p className="cq-body-sm py-2 text-(--cq-text-secondary)">
            {t("No calls yet.")}
          </p>
        ) : (
          <ol aria-label={t("Earlier calls")} className="flex flex-col">
            {earlier.map((meeting) => (
              <li
                key={meeting.id}
                className="grid grid-cols-[76px_14px_minmax(0,1fr)] gap-2.5 py-2"
              >
                <time
                  dateTime={meeting.startsAt}
                  className="cq-caption cq-numeric pt-px text-(--cq-text-tertiary)"
                >
                  {t(formatDay(meeting.startsAt))}
                </time>
                <span
                  aria-hidden="true"
                  className={`mt-1 size-[9px] rounded-full border-2 ${
                    meeting.status === "CANCELLED"
                      ? "border-(--cq-border) bg-(--cq-surface-raised)"
                      : "border-(--cq-positive) bg-(--cq-positive)"
                  }`}
                />
                <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                  {meeting.status === "CANCELLED"
                    ? t(`${meeting.purpose}. Cancelled`)
                    : t(
                        `${meeting.purpose}, ${String(Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 60_000))} min`,
                      )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
