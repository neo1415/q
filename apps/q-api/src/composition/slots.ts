/**
 * Times for a call without anyone's calendar (AUTO, 2026-10-02): the
 * owner's working hours in their own time zone, as a human assistant would
 * offer them. Pure and zone-correct with the platform's own Intl data: no
 * offsets are assumed, so DST changes and half- or quarter-hour zones
 * (Asia/Kolkata, Asia/Kathmandu) fall where they really are.
 */

export type Window = {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  readonly days: readonly number[];
  readonly startHour: number;
  readonly endHour: number;
};

/** Weekdays, 10:00 to 16:00: what Q offers when nothing else is known. */
export const DEFAULT_WORKING_HOURS: readonly Window[] = [
  { days: [1, 2, 3, 4, 5], startHour: 10, endHour: 16 },
];

const STEP_MS = 15 * 60_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** ISO weekday, hour and minute of an instant in a zone. */
export function wallClock(
  at: Date,
  timeZone: string,
): { readonly day: number; readonly hour: number; readonly minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(at);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: WEEKDAYS.indexOf(value("weekday")) + 1,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

export function isKnownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** The call, start to end, sits inside one window on one local day. */
export function insideWindows(
  start: Date,
  durationMinutes: number,
  windows: readonly Window[],
  timeZone: string,
): boolean {
  const begin = wallClock(start, timeZone);
  const end = wallClock(
    new Date(start.getTime() + durationMinutes * 60_000 - 1),
    timeZone,
  );
  return windows.some(
    (window) =>
      window.days.includes(begin.day) &&
      begin.day === end.day &&
      begin.hour >= window.startHour &&
      end.hour < window.endHour,
  );
}

/**
 * Up to `count` starts on the hour inside the windows, no sooner than
 * `from`, at most one in the morning and one in the afternoon of a day, so
 * the offer spans days the way a person would offer it.
 */
export function workingHourSlots(input: {
  readonly from: Date;
  readonly until: Date;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly windows?: readonly Window[] | undefined;
  readonly count: number;
}): Date[] {
  const windows = input.windows ?? DEFAULT_WORKING_HOURS;
  const zone = isKnownZone(input.timeZone) ? input.timeZone : "UTC";
  const picked: Date[] = [];
  const taken = new Set<string>();
  let at = Math.ceil(input.from.getTime() / STEP_MS) * STEP_MS;
  while (at < input.until.getTime() && picked.length < input.count) {
    const start = new Date(at);
    const local = wallClock(start, zone);
    const half = local.hour < 13 ? "am" : "pm";
    const key = `${new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(start)}:${half}`;
    if (
      local.minute === 0 &&
      (local.hour === 10 ||
        local.hour === 14 ||
        local.hour === windows[0]?.startHour) &&
      !taken.has(key) &&
      insideWindows(start, input.durationMinutes, windows, zone)
    ) {
      picked.push(start);
      taken.add(key);
      // The next offer is on another day.
      taken.add(key.replace(/:(am|pm)$/, half === "am" ? ":pm" : ":am"));
    }
    at += STEP_MS;
  }
  return picked;
}

export function slotLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: isKnownZone(timeZone) ? timeZone : "UTC",
    timeZoneName: "short",
  }).format(at);
}
