/**
 * Slot proposal (BIZ-008): three free times inside the organiser's working
 * hours, in the organiser's time zone. Pure code over busy intervals; no
 * calendar, clock or model in here.
 *
 * Working hours are 09:00-17:30 local, Monday to Friday, on a 30-minute
 * grid, starting at least one hour from now. The three are spread across
 * different days first (the earliest free time of each day), then filled
 * from the earliest remaining, so a person gets a real choice.
 */

export const SLOT_POLICY = Object.freeze({
  version: "slots.v1",
  dayStartMinutes: 9 * 60,
  dayEndMinutes: 17 * 60 + 30,
  stepMinutes: 30,
  leadMinutes: 60,
  count: 3,
  workingDays: [1, 2, 3, 4, 5] as readonly number[],
});

export type Interval = { readonly start: Date; readonly end: Date };

type LocalParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
};

const WEEKDAY: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let known = formatters.get(timeZone);
  if (known === undefined) {
    known = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, known);
  }
  return known;
}

/** Whether the runtime knows this IANA zone. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY[parts.weekday ?? ""] ?? 0,
  };
}

/** The UTC instant of a wall-clock time in a zone (DST-safe for our grid). */
export function zonedTime(
  date: { readonly year: number; readonly month: number; readonly day: number },
  minutes: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Math.floor(minutes / 60),
    minutes % 60,
  );
  const offsetAt = (instant: number) => {
    const p = localParts(new Date(instant), timeZone);
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) -
      Math.floor(instant / 60_000) * 60_000
    );
  };
  const first = naive - offsetAt(naive);
  return new Date(naive - offsetAt(first));
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function proposeSlots(input: {
  readonly now: Date;
  readonly from: Date;
  readonly to: Date;
  readonly durationMinutes: number;
  readonly timeZone: string;
  readonly busy: readonly Interval[];
}): readonly Interval[] {
  const policy = SLOT_POLICY;
  const earliest = new Date(
    Math.max(
      input.from.getTime(),
      input.now.getTime() + policy.leadMinutes * 60_000,
    ),
  );
  const perDay: Interval[][] = [];
  // Walk local calendar days from the earliest instant to the window end.
  let cursor = localParts(earliest, input.timeZone);
  for (let dayIndex = 0; dayIndex < 31; dayIndex += 1) {
    const date = { year: cursor.year, month: cursor.month, day: cursor.day };
    const dayStart = zonedTime(date, 0, input.timeZone);
    if (dayStart >= input.to) break;
    const free: Interval[] = [];
    if (policy.workingDays.includes(cursor.weekday)) {
      for (
        let minutes = policy.dayStartMinutes;
        minutes + input.durationMinutes <= policy.dayEndMinutes;
        minutes += policy.stepMinutes
      ) {
        const start = zonedTime(date, minutes, input.timeZone);
        const end = new Date(start.getTime() + input.durationMinutes * 60_000);
        if (start < earliest || end > input.to) continue;
        const slot = { start, end };
        if (input.busy.some((busy) => overlaps(busy, slot))) continue;
        free.push(slot);
      }
    }
    if (free.length > 0) perDay.push(free);
    // Next local day: noon today + 24h lands on tomorrow in any zone.
    const nextNoon = new Date(
      zonedTime(date, 12 * 60, input.timeZone).getTime() + 24 * 3_600_000,
    );
    cursor = localParts(nextNoon, input.timeZone);
  }
  const chosen: Interval[] = perDay
    .map((day) => day[0])
    .filter((slot): slot is Interval => slot !== undefined)
    .slice(0, policy.count);
  if (chosen.length < policy.count) {
    const rest = perDay
      .flat()
      .filter((slot) => !chosen.includes(slot))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    chosen.push(...rest.slice(0, policy.count - chosen.length));
  }
  return chosen.sort((a, b) => a.start.getTime() - b.start.getTime());
}
