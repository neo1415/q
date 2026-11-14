import { isKnownTimeZone } from "./slots.js";

/**
 * The one wording of a call's time in every meeting notice and Q card
 * (live audit 2026-11-14 D2/D4): the local time in a named zone, always
 * labelled, e.g. "Tue 17 Nov, 10:00 West Africa Time" or
 * "Tue 17 Nov, 09:00 GMT". Never a raw UTC instant under a zone label.
 *
 * The label is the zone's short name when it is a real abbreviation (GMT,
 * BST, CET, UTC); where the short form is only an offset ("GMT+1") the
 * zone's long name is clearer and is used instead. An unknown zone falls
 * back to UTC, said as UTC.
 */
export function meetingTimeLabel(
  instant: Date | string,
  timeZone: string | null | undefined,
): string {
  const at = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(at.getTime())) return String(instant);
  const zone =
    timeZone !== null && timeZone !== undefined && isKnownTimeZone(timeZone)
      ? timeZone
      : "UTC";
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(at)) {
    parts[part.type] = part.value;
  }
  let label = parts["timeZoneName"] ?? zone;
  if (/\d/.test(label)) {
    label =
      new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "long" })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value ?? label;
  }
  return `${parts["weekday"] ?? ""} ${parts["day"] ?? ""} ${parts["month"] ?? ""}, ${parts["hour"] ?? ""}:${parts["minute"] ?? ""} ${label}`;
}
