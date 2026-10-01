import { z } from "zod";

/**
 * A time the person said, resolved by code in their own zone (live test
 * 2026-09-28 #2).
 *
 * "Set up a meeting 2 PM tomorrow" was refused as a date that "could not be
 * validated": the tools asked the model for an ISO 8601 UTC instant, and the
 * model knows neither today's date nor where the person is. Now the model
 * only transcribes what was said -- a day word or a calendar date, and a
 * wall-clock time -- and this module turns it into one instant, in the
 * person's IANA zone, against the server's clock. Deterministic and
 * testable across zones and DST; refused only when the words really do not
 * name one instant (a time the clocks skip or repeat, a date that
 * contradicts its weekday, a moment already past, or no zone at all).
 */

export const LOCAL_DAY_WORDS = [
  "today",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type LocalDayWord = (typeof LOCAL_DAY_WORDS)[number];

const WEEKDAYS: readonly LocalDayWord[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const LocalWhenSchema = z
  .object({
    day: z
      .enum(LOCAL_DAY_WORDS)
      .optional()
      .describe(
        "The day as they said it: today, tomorrow, or a weekday (the next one after today; 'Friday' said on a Friday means a week later). Omit when they gave a calendar date.",
      ),
    date: z.iso
      .date()
      .optional()
      .describe(
        "A calendar date they named, YYYY-MM-DD. Omit when they said today, tomorrow or a weekday.",
      ),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour")
      .optional()
      .describe(
        "Their wall-clock time, HH:MM 24-hour (2 PM is 14:00). Never converted to UTC: Capital Q does that in their time zone. Omit only with inMinutes.",
      ),
    inMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 366)
      .optional()
      .describe(
        "When they gave a span from now instead of a clock time (in 2 minutes, in an hour, in three days): that span in minutes, and nothing else.",
      ),
  })
  .strict()
  .refine(
    (when) =>
      when.inMinutes === undefined
        ? when.time !== undefined
        : when.time === undefined &&
          when.day === undefined &&
          when.date === undefined,
    { message: "give a clock time (with day or date), or inMinutes alone" },
  );
export type LocalWhen = z.infer<typeof LocalWhenSchema>;

export type LocalWhenResolution =
  | { readonly kind: "OK"; readonly instant: Date; readonly timeZone: string }
  | {
      readonly kind:
        | "NO_TIME_ZONE"
        | "NO_DAY"
        | "DAY_CONFLICT"
        | "SKIPPED_BY_CLOCK_CHANGE"
        | "REPEATED_BY_CLOCK_CHANGE"
        | "PAST";
    };

/**
 * A device that reports UTC is usually not telling where the person is:
 * privacy-hardened browsers, virtual machines and servers all say UTC
 * (live 2026-10-01: a founder in Lagos got a reminder at 09:00 UTC because
 * the browser said UTC). Such a zone is not trusted on the device's word.
 */
export function isUncertainDeviceZone(timeZone: string): boolean {
  return /^(Etc\/)?(UTC|UCT|GMT|Universal|Zulu|Greenwich)(\+0|-0|0)?$/i.test(
    timeZone,
  );
}

export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

type Wall = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

function wallIn(instant: Date, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

/** The zone's offset from UTC at an instant, in ms (wall - utc). */
function offsetAt(instant: Date, timeZone: string): number {
  const wall = wallIn(instant, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return asUtc - truncated;
}

const sameWall = (a: Wall, b: Wall) =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute;

/** Every instant that shows this wall-clock time in the zone: 0, 1 or 2. */
function instantsFor(wall: Wall, timeZone: string): Date[] {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );
  const day = 24 * 3_600_000;
  // The offsets either side of any transition near this day.
  const offsets = new Set([
    offsetAt(new Date(guess - day), timeZone),
    offsetAt(new Date(guess), timeZone),
    offsetAt(new Date(guess + day), timeZone),
  ]);
  const found = new Map<number, Date>();
  for (const offset of offsets) {
    const candidate = new Date(guess - offset);
    if (sameWall(wallIn(candidate, timeZone), wall)) {
      found.set(candidate.getTime(), candidate);
    }
  }
  return [...found.values()].sort((a, b) => a.getTime() - b.getTime());
}

function addDays(
  date: { year: number; month: number; day: number },
  days: number,
) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function weekdayOf(date: { year: number; month: number; day: number }) {
  const index = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  return WEEKDAYS[index] ?? "sunday";
}

/** The calendar day a day word names, from today in the zone. */
function dayFor(
  word: LocalDayWord,
  today: { year: number; month: number; day: number },
) {
  if (word === "today") return today;
  if (word === "tomorrow") return addDays(today, 1);
  const target = WEEKDAYS.indexOf(word);
  const current = WEEKDAYS.indexOf(weekdayOf(today));
  const ahead = (target - current + 7) % 7;
  return addDays(today, ahead === 0 ? 7 : ahead);
}

export function resolveLocalWhen(
  when: LocalWhen,
  timeZone: string | undefined,
  now: Date,
): LocalWhenResolution {
  // A span from now ("in 2 minutes") needs no zone and no calendar: live
  // 2026-10-01, "remind me in 2 minutes" could not be expressed at all, and
  // Q asked the person for a clock time.
  if (when.inMinutes !== undefined) {
    return {
      kind: "OK",
      instant: new Date(now.getTime() + when.inMinutes * 60_000),
      timeZone:
        timeZone !== undefined && isKnownTimeZone(timeZone) ? timeZone : "UTC",
    };
  }
  if (timeZone === undefined || !isKnownTimeZone(timeZone)) {
    return { kind: "NO_TIME_ZONE" };
  }
  const todayWall = wallIn(now, timeZone);
  const today = {
    year: todayWall.year,
    month: todayWall.month,
    day: todayWall.day,
  };
  let date: { year: number; month: number; day: number };
  if (when.date !== undefined) {
    const [year, month, day] = when.date.split("-").map(Number);
    date = { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
    if (when.day !== undefined) {
      // "Tuesday 30 September" is fine; "tomorrow, the 3rd" when tomorrow
      // is the 29th names two days, and neither is picked silently.
      const named =
        when.day === "today" || when.day === "tomorrow"
          ? dayFor(when.day, today)
          : null;
      const agrees =
        named === null
          ? weekdayOf(date) === when.day
          : named.year === date.year &&
            named.month === date.month &&
            named.day === date.day;
      if (!agrees) return { kind: "DAY_CONFLICT" };
    }
  } else if (when.day !== undefined) {
    date = dayFor(when.day, today);
  } else {
    return { kind: "NO_DAY" };
  }
  if (when.time === undefined) return { kind: "NO_DAY" };
  const [hour, minute] = when.time.split(":").map(Number);
  const instants = instantsFor(
    { ...date, hour: hour ?? 0, minute: minute ?? 0 },
    timeZone,
  );
  const [only, second] = instants;
  if (only === undefined) return { kind: "SKIPPED_BY_CLOCK_CHANGE" };
  if (second !== undefined) return { kind: "REPEATED_BY_CLOCK_CHANGE" };
  if (only.getTime() <= now.getTime()) return { kind: "PAST" };
  return { kind: "OK", instant: only, timeZone };
}

/** One sentence for the model when the words did not name one instant. */
export function unresolvedMessage(
  kind: Exclude<LocalWhenResolution["kind"], "OK">,
): string {
  switch (kind) {
    case "NO_TIME_ZONE":
      return "Their time zone is not known here. Ask once which city or time zone they are in, then pass it as timeZone; and offer to save it to their profile (propose_profile_change, PERSON timeZone) so you never have to ask again. Never assume UTC.";
    case "NO_DAY":
      return "Say which day: pass day (today, tomorrow or a weekday) or date (YYYY-MM-DD) with the time.";
    case "DAY_CONFLICT":
      return "The day and the date they gave name different days. Ask which one they mean.";
    case "SKIPPED_BY_CLOCK_CHANGE":
      return "That time does not exist on that day in their time zone (the clocks go forward). Ask for another time.";
    case "REPEATED_BY_CLOCK_CHANGE":
      return "That time happens twice on that day in their time zone (the clocks go back). Ask whether they mean the first or second, or another time.";
    case "PAST":
      return "That time has already passed in their time zone. Ask for a time in the future.";
  }
}

/** A readable local label for the person, e.g. "Tue 29 Sep, 14:00 (Europe/London)". */
export function localLabel(instant: Date, timeZone: string): string {
  try {
    return `${new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant)} (${timeZone})`;
  } catch {
    return instant.toISOString();
  }
}
