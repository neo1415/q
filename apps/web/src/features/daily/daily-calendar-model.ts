import type { QDailyEditionSummary } from "@capital-q/contracts";

/**
 * The Q Daily's calendar (chosen design 2026-10-21: the newspaper with the
 * edition calendar beside it). Pure date arithmetic on calendar dates
 * ("2026-10-20"), never on instants, so a day is the same day whatever the
 * clock's time zone. Weeks start on Monday, as the design draws them.
 */

export type DayCell = {
  /** "2026-10-14". */
  readonly date: string;
  readonly day: number;
  /** Column, 1 (Monday) to 7 (Sunday). */
  readonly weekday: number;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MONTH = /^(\d{4})-(\d{2})$/u;

export function isDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (match === null) return false;
  const [, y, m, d] = match.map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(`${pad(y, 4)}-${pad(m)}`);
}

export function isMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = MONTH.exec(value);
  const m = match === null ? NaN : Number(match[2]);
  return m >= 1 && m <= 12;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function parts(month: string): { readonly y: number; readonly m: number } {
  const [y = "1970", m = "01"] = month.split("-");
  return { y: Number(y), m: Number(m) };
}

/** "2026-10" for a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function daysIn(month: string): number {
  const { y, m } = parts(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonth(month: string, by: number): string {
  const { y, m } = parts(month);
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}`;
}

/** The first day after the month: the archive's `before` for it. */
export function monthEnd(month: string): string {
  return `${shiftMonth(month, 1)}-01`;
}

/** Every day of the month with its Monday-first column. */
export function monthDays(month: string): readonly DayCell[] {
  const { y, m } = parts(month);
  return Array.from({ length: daysIn(month) }, (_, index) => {
    const day = index + 1;
    const sunday0 = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    return {
      date: `${month}-${pad(day)}`,
      day,
      weekday: sunday0 === 0 ? 7 : sunday0,
    };
  });
}

/** Today's calendar date as the server's clock sees it, in UTC. */
export function todayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The month's editions by date (the newest wins if two share a day). */
export function editionsByDate(
  summaries: readonly QDailyEditionSummary[],
  month: string,
): ReadonlyMap<string, QDailyEditionSummary> {
  const out = new Map<string, QDailyEditionSummary>();
  for (const summary of summaries) {
    if (monthOf(summary.editionDate) !== month) continue;
    const known = out.get(summary.editionDate);
    if (known === undefined || summary.number > known.number) {
      out.set(summary.editionDate, summary);
    }
  }
  return out;
}

/** "October 2026" in English; the reader's language formats it again. */
export function monthTitle(month: string, locale = "en-GB"): string {
  const { y, m } = parts(month);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Tuesday 14 October" for a calendar date. */
export function dayTitle(date: string, locale = "en-GB"): string {
  const [y = "1970", m = "01", d = "01"] = date.split("-");
  return new Date(
    Date.UTC(Number(y), Number(m) - 1, Number(d)),
  ).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
