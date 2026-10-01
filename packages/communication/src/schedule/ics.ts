/**
 * A calendar invite as an iCalendar file (RFC 5545), for meetings agreed
 * without Google (AUTO, 2026-10-02): both sides get it by email and add it
 * to whatever calendar they use. Times are written in UTC (the "Z" form),
 * so no time-zone database is needed and no reader can misplace them.
 */

export type IcsInvite = {
  /** Stable per meeting, so a resent invite updates rather than duplicates. */
  readonly uid: string;
  /** Raise to supersede an earlier copy of the same meeting. */
  readonly sequence: number;
  readonly start: Date;
  readonly end: Date;
  readonly summary: string;
  readonly description: string;
  readonly location: string | null;
  readonly organiser: { readonly name: string; readonly email: string };
  readonly attendees: readonly {
    readonly name: string;
    readonly email: string;
  }[];
  readonly createdAt: Date;
};

function utc(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** TEXT escaping (RFC 5545 §3.3.11). */
function text(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** A quoted parameter value may not contain a double quote or control. */
function param(value: string): string {
  return `"${value.replace(/["\r\n]/g, "").slice(0, 120)}"`;
}

/** Content lines fold at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // Never split a UTF-8 sequence.
    while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.join("\r\n ");
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+$/;

export function meetingIcs(invite: IcsInvite): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Capital Q//Meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${invite.uid}@capitalq`,
    `SEQUENCE:${String(invite.sequence)}`,
    `DTSTAMP:${utc(invite.createdAt)}`,
    `DTSTART:${utc(invite.start)}`,
    `DTEND:${utc(invite.end)}`,
    `SUMMARY:${text(invite.summary)}`,
    `DESCRIPTION:${text(invite.description)}`,
    ...(invite.location === null ? [] : [`LOCATION:${text(invite.location)}`]),
    ...(EMAIL.test(invite.organiser.email)
      ? [
          `ORGANIZER;CN=${param(invite.organiser.name)}:mailto:${invite.organiser.email}`,
        ]
      : []),
    ...invite.attendees
      .filter((attendee) => EMAIL.test(attendee.email))
      .map(
        (attendee) =>
          `ATTENDEE;CN=${param(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee.email}`,
      ),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
