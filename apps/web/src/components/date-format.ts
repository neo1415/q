/**
 * How Capital Q writes a date, everywhere (R30 #20): day, short month and
 * year in British order ("27 Sept 2026"), the same form the exported PDFs
 * use. A calendar date (YYYY-MM-DD) is a day, not an instant, so it is read
 * in UTC and never shifts with the reader's time zone. Anything that is not
 * a date is returned as it came rather than shown as "Invalid Date".
 */

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const LONG_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_NO_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

function parse(value: string): Date | null {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "27 Sept 2026". */
export function formatDay(value: string): string {
  const at = parse(value);
  return at === null ? value : DAY.format(at);
}

/** "27 September 2026", for a single fact given room (a founding date). */
export function formatLongDay(value: string): string {
  const at = parse(value);
  return at === null ? value : LONG_DAY.format(at);
}

/** "27 Sept 2026, 06:54": an instant, in the reader's own time. */
export function formatDayTime(value: string): string {
  const at = parse(value);
  if (at === null) return value;
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(at);
  return `${day}, ${TIME.format(at)}`;
}

/** A list's compact stamp: the time today, "27 Sept" otherwise. */
export function formatStamp(value: string, now: Date = new Date()): string {
  const at = parse(value);
  if (at === null) return value;
  return at.toDateString() === now.toDateString()
    ? TIME.format(at)
    : DAY_NO_YEAR.format(at);
}
