"use client";

import "@/features/relationships/crm.css";

import Link from "next/link";
import { useState } from "react";

import type { QDailyFrequency } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ICON_SIZE,
} from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { monthDays, monthTitle, shiftMonth } from "./daily-calendar-model";

/**
 * The edition calendar (chosen design 2026-10-21, The Q Daily option 3's
 * calendar beside option 1's newspaper): a dot marks a day with an
 * edition, and that day opens its edition; a day without one says so and
 * opens nothing. A right rail on a wide screen; on a phone a strip that
 * opens the month in place.
 */

export type CalendarEdition = {
  readonly date: string;
  readonly number: number;
  readonly headline: string | null;
};

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function footnote(frequency: QDailyFrequency): string {
  switch (frequency) {
    case "DAILY":
      return "A dot marks a day with an edition. Pick one to read it.";
    case "WEEKLY":
      return "A dot marks a day with an edition. Yours comes weekly, so most days have none.";
    case "OFF":
      return "A dot marks a day with an edition. The Q Daily is off, so no new ones come.";
  }
}

function Month({
  month,
  today,
  selected,
  editions,
  frequency,
  loaded,
}: {
  readonly month: string;
  readonly today: string;
  readonly selected: string | null;
  readonly editions: readonly CalendarEdition[];
  readonly frequency: QDailyFrequency;
  readonly loaded: boolean;
}) {
  const t = useT();
  const byDate = new Map(editions.map((edition) => [edition.date, edition]));
  const days = monthDays(month);
  const title = monthTitle(month);
  const later = shiftMonth(month, 1) <= today.slice(0, 7);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <h3 className="m-0 flex-1 text-[15px] font-semibold text-(--cq-text-primary)">
          {t(title)}
        </h3>
        <Link
          href={`/daily?month=${shiftMonth(month, -1)}`}
          scroll={false}
          aria-label={t(`Earlier: ${monthTitle(shiftMonth(month, -1))}`)}
          className="grid size-11 place-items-center rounded-(--cq-radius-md) text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) lg:size-9"
          data-calendar-prev
        >
          <ChevronLeft
            size={ICON_SIZE.regular}
            aria-hidden="true"
            className="rtl:rotate-180"
          />
        </Link>
        {later ? (
          <Link
            href={`/daily?month=${shiftMonth(month, 1)}`}
            scroll={false}
            aria-label={t(`Later: ${monthTitle(shiftMonth(month, 1))}`)}
            className="grid size-11 place-items-center rounded-(--cq-radius-md) text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) lg:size-9"
            data-calendar-next
          >
            <ChevronRight
              size={ICON_SIZE.regular}
              aria-hidden="true"
              className="rtl:rotate-180"
            />
          </Link>
        ) : (
          <span aria-hidden="true" className="size-11 lg:size-9" />
        )}
      </div>
      <div
        role="grid"
        aria-label={t(`Editions in ${title}`)}
        className="grid grid-cols-7 gap-1 text-center"
      >
        <div role="row" className="contents">
          {WEEKDAYS.map((day, index) => (
            <span
              key={WEEKDAY_NAMES[index]}
              role="columnheader"
              aria-label={t(WEEKDAY_NAMES[index] ?? "")}
              className="pb-1 text-[11px] text-(--cq-text-tertiary)"
            >
              {t(day)}
            </span>
          ))}
        </div>
        <div role="row" className="contents">
          {days.map((cell) => {
            const edition = byDate.get(cell.date);
            const isToday = cell.date === today;
            const isPicked = cell.date === selected;
            const future = cell.date > today;
            const base = cx(
              "relative grid h-11 place-items-center rounded-(--cq-radius-md) text-[13px] tabular-nums lg:h-9",
              isToday &&
                !isPicked &&
                "font-semibold shadow-[inset_0_0_0_1.5px_var(--cq-tile,var(--cq-text-primary))]",
            );
            const style =
              cell.day === 1 ? { gridColumnStart: cell.weekday } : undefined;
            if (edition !== undefined) {
              return (
                <Link
                  key={cell.date}
                  role="gridcell"
                  href={`/daily?date=${cell.date}`}
                  scroll={false}
                  style={style}
                  aria-current={isPicked ? "date" : undefined}
                  aria-label={t(
                    `${String(cell.day)} ${title}: edition No. ${String(edition.number)}${
                      edition.headline === null ? "" : `, ${edition.headline}`
                    }`,
                  )}
                  className={cx(
                    base,
                    "focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
                    isPicked
                      ? "bg-[var(--cq-tile,var(--cq-text-primary))] font-semibold text-[var(--cq-on-tile,var(--cq-text-inverse))]"
                      : "bg-(--cq-surface-subtle) text-(--cq-text-primary) hover:bg-(--cq-surface-strong)",
                  )}
                  data-day={cell.date}
                  data-edition
                >
                  {cell.day}
                  <i
                    aria-hidden="true"
                    className={cx(
                      "absolute bottom-1 size-1 rounded-full",
                      isPicked
                        ? "bg-[var(--cq-on-tile,var(--cq-text-inverse))]"
                        : "bg-(--cq-accent)",
                    )}
                  />
                </Link>
              );
            }
            return (
              <span
                key={cell.date}
                role="gridcell"
                style={style}
                aria-label={t(
                  future
                    ? `${String(cell.day)} ${title}: still to come`
                    : `${String(cell.day)} ${title}: no edition`,
                )}
                className={cx(
                  base,
                  "text-(--cq-text-tertiary)",
                  isPicked && "bg-(--cq-surface-strong) text-(--cq-text-primary)",
                  future && "opacity-60",
                )}
                data-day={cell.date}
              >
                {cell.day}
              </span>
            );
          })}
        </div>
      </div>
      <p className="m-0 text-xs text-(--cq-text-tertiary)">
        {loaded
          ? t(footnote(frequency))
          : t("This month's editions couldn't load. The days show without them.")}
      </p>
    </div>
  );
}

export function DailyCalendar(props: {
  readonly month: string;
  readonly today: string;
  readonly selected: string | null;
  readonly editions: readonly CalendarEdition[];
  readonly frequency: QDailyFrequency;
  readonly loaded: boolean;
  /** Open on a phone (a month or day was just picked). */
  readonly startOpen: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(props.startOpen);
  const month = {
    month: props.month,
    today: props.today,
    selected: props.selected,
    editions: props.editions,
    frequency: props.frequency,
    loaded: props.loaded,
  };
  return (
    <>
      <aside
        className="hidden flex-col rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 lg:flex"
        aria-label={t("Edition calendar")}
        data-daily-calendar="rail"
      >
        <Month {...month} />
      </aside>
      <div
        className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) lg:hidden"
        data-daily-calendar="strip"
      >
        <button
          type="button"
          onClick={() => setOpen((shown) => !shown)}
          aria-expanded={open}
          aria-controls="daily-calendar-month"
          className="flex min-h-12 w-full items-center gap-2.5 px-4 text-start text-sm text-(--cq-text-primary)"
        >
          <CalendarDays
            size={ICON_SIZE.regular}
            aria-hidden="true"
            className="text-(--cq-text-secondary)"
          />
          <span className="flex-1">
            {t("Editions")} · {t(monthTitle(props.month))}
          </span>
          <ChevronDown
            size={ICON_SIZE.regular}
            aria-hidden="true"
            className={cx(
              "text-(--cq-text-tertiary) transition-transform duration-(--cq-motion-fast)",
              open && "rotate-180",
            )}
          />
        </button>
        {open ? (
          <div
            id="daily-calendar-month"
            className="cq-crm-swap border-t border-(--cq-border-subtle) p-4"
          >
            <Month {...month} />
          </div>
        ) : null}
      </div>
    </>
  );
}
