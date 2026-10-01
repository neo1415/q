import type { QDailyFrequency } from "@capital-q/contracts";

/**
 * When an edition is due (DAILY spec G1): 07:00 in the reader's own time
 * zone, every day for DAILY, Mondays for WEEKLY, never for OFF. An unknown
 * or invalid zone is read as UTC.
 */

export const DELIVERY_HOUR = 7;

function validZone(timeZone: string | null): string {
  if (timeZone === null || timeZone.length === 0) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return "UTC";
  }
}

type WallClock = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number; // 0 = Sunday
};

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "0";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

/** The instant a wall-clock time in a zone falls on (two passes cover DST). */
function instantOf(
  local: { year: number; month: number; day: number; hour: number },
  timeZone: string,
): Date {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour);
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClock(new Date(guess), timeZone);
    const seenUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
    );
    guess += target - seenUtc;
  }
  return new Date(guess);
}

/** The reader's calendar date for an instant, as YYYY-MM-DD. */
export function localDate(instant: Date, timeZone: string | null): string {
  const clock = wallClock(instant, validZone(timeZone));
  return `${String(clock.year).padStart(4, "0")}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
}

export function nextDueAt(
  frequency: QDailyFrequency,
  timeZone: string | null,
  now: Date,
): Date | null {
  if (frequency === "OFF") return null;
  const zone = validZone(timeZone);
  const today = wallClock(now, zone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = new Date(
      Date.UTC(today.year, today.month - 1, today.day + offset),
    );
    const weekday = day.getUTCDay();
    if (frequency === "WEEKLY" && weekday !== 1) continue;
    const due = instantOf(
      {
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
        hour: DELIVERY_HOUR,
      },
      zone,
    );
    if (due.getTime() > now.getTime()) return due;
  }
  return null;
}
