import { createHash } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";

import { meetingIcs } from "./ics.js";
import type { AppEmailPort } from "./service.js";

/**
 * The meeting email (founder report 2026-10-02: "I can't see the meeting
 * links in the emails"). Every participant of a booked call -- organiser
 * and attendees alike -- gets one Capital Q email: the title, the time in
 * their own zone, the Meet link as a button and as a plain URL, a calendar
 * file (.ics, the link as its location and URL) and a link to prepare with
 * Q. When the time, title or link changes, they get one updated email.
 *
 * Once per meeting, person and version (communication.meeting_emails), so
 * the worker can run as often as it likes. Only calls booked or changed in
 * the last week and not yet started are looked at.
 */

const RECENT_MS = 7 * 24 * 3_600_000;
const HORIZON_MS = 60 * 24 * 3_600_000;
/** Reserved and test domains are never mailed. */
const UNDELIVERABLE = /(\.invalid|\.local|\.test|@example\.(com|org|net))$/i;

export type MeetingMailRow = {
  meeting_id: string;
  purpose: string;
  starts_at: Date;
  ends_at: Date;
  time_zone: string;
  meet_link: string | null;
  organiser_user_id: string;
  user_id: string;
  display_name: string;
  email: string;
  timezone: string | null;
  version: string | null;
  sequence: number | null;
};

function zoneOr(zone: string | null, fallback: string): string {
  if (zone === null) return fallback;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format(new Date(0));
    return zone;
  } catch {
    return fallback;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function meetingVersion(meeting: {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly meetLink: string | null;
  readonly purpose: string;
}): string {
  return createHash("sha256")
    .update(
      [
        meeting.startsAt.toISOString(),
        meeting.endsAt.toISOString(),
        meeting.meetLink ?? "",
        meeting.purpose,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

/** The email for one participant: subject, text, html and the .ics. */
export function meetingEmail(input: {
  readonly meetingId: string;
  readonly purpose: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly meetLink: string | null;
  readonly timeZone: string;
  readonly updated: boolean;
  readonly sequence: number;
  readonly organiser: { readonly name: string; readonly email: string };
  readonly attendees: readonly {
    readonly name: string;
    readonly email: string;
  }[];
  readonly appOrigin: string | null;
  readonly now: Date;
}): {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly ics: string;
} {
  const when = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: input.timeZone,
    timeZoneName: "short",
  }).format(input.startsAt);
  const minutes = Math.round(
    (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000,
  );
  const prepare =
    input.appOrigin === null
      ? null
      : `${input.appOrigin}/rehearsals/meeting/${input.meetingId}`;
  const lead = input.updated ? "Your call has changed" : "Your call is booked";
  const subject =
    `${input.updated ? "Updated: " : ""}${input.purpose} - ${when}`
      .replace(/[\r\n]+/g, " ")
      .slice(0, 150);
  const text = [
    `${lead}: ${input.purpose}`,
    `${when} (${String(minutes)} minutes)`,
    "",
    input.meetLink === null
      ? "Video link: to follow. Capital Q will email it as soon as it is ready."
      : `Join with Google Meet: ${input.meetLink}`,
    "",
    "The calendar invite is attached: open it to add the call to your calendar.",
    ...(prepare === null
      ? []
      : ["", `Prepare with Q (the prep brief and a rehearsal): ${prepare}`]),
  ].join("\n");
  const button = (href: string, label: string) =>
    `<p style="margin:16px 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1f3a5f;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;
  const html = [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14171f">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">',
    '<p style="margin:0 0 4px;font-size:13px;color:#5b6271">Capital Q</p>',
    `<h1 style="margin:0 0 8px;font-size:20px">${escapeHtml(lead)}: ${escapeHtml(input.purpose)}</h1>`,
    `<p style="margin:0 0 4px;font-size:16px">${escapeHtml(when)}</p>`,
    `<p style="margin:0;font-size:14px;color:#5b6271">${String(minutes)} minutes</p>`,
    input.meetLink === null
      ? '<p style="margin:16px 0">Video link: to follow. Capital Q will email it as soon as it is ready.</p>'
      : `${button(input.meetLink, "Join with Google Meet")}<p style="margin:0;font-size:13px;color:#5b6271">Or open: <a href="${escapeHtml(input.meetLink)}">${escapeHtml(input.meetLink)}</a></p>`,
    '<p style="margin:16px 0 0;font-size:14px">Add to calendar: open the attached invite (invite.ics).</p>',
    prepare === null
      ? ""
      : `<p style="margin:12px 0 0;font-size:14px"><a href="${escapeHtml(prepare)}">Prepare with Q</a>: the prep brief and a rehearsal of this call.</p>`,
    "</div></body></html>",
  ].join("");
  const ics = meetingIcs({
    uid: input.meetingId,
    sequence: input.sequence,
    start: input.startsAt,
    end: input.endsAt,
    summary: input.purpose,
    description: `${input.purpose}${input.meetLink === null ? "\nVideo link to follow." : `\nJoin: ${input.meetLink}`}\nArranged on Capital Q.`,
    location: input.meetLink,
    url: input.meetLink,
    organiser: input.organiser,
    attendees: input.attendees,
    createdAt: input.now,
  });
  return { subject, text, html, ics };
}

export function createMeetingMailer(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly email: AppEmailPort;
  readonly appOrigin: string | null;
  readonly now?: () => Date;
  readonly logger?: {
    readonly warn: (
      fields: Readonly<Record<string, unknown>>,
      message: string,
    ) => void;
  };
}) {
  const now = dependencies.now ?? (() => new Date());
  const { sql, email } = dependencies;

  return {
    /** One pass: email every participant whose version is not yet sent. */
    tick: async (limit = 200): Promise<{ readonly sent: number }> => {
      if (!email.available) return { sent: 0 };
      const current = now();
      const rows = await sql<MeetingMailRow[]>`
        select m.id as meeting_id, m.purpose, m.starts_at, m.ends_at, m.time_zone,
               m.meet_link, m.organiser_user_id, p.user_id, p.display_name, p.email,
               up.timezone, e.version, e.sequence
          from communication.meetings m
          join communication.meeting_participants p on p.meeting_id = m.id
          left join identity.user_profiles up on up.id = p.user_id
          left join communication.meeting_emails e
            on e.meeting_id = m.id and e.user_id = p.user_id
         where m.status = 'SCHEDULED'
           and m.starts_at > ${current}
           and m.starts_at < ${new Date(current.getTime() + HORIZON_MS)}
           and m.updated_at > ${new Date(current.getTime() - RECENT_MS)}
         order by m.starts_at
         limit ${limit}`;
      const byMeeting = new Map<string, MeetingMailRow[]>();
      for (const row of rows) {
        byMeeting.set(row.meeting_id, [
          ...(byMeeting.get(row.meeting_id) ?? []),
          row,
        ]);
      }
      let sent = 0;
      for (const people of byMeeting.values()) {
        const first = people[0];
        if (first === undefined) continue;
        const meeting = {
          startsAt: new Date(first.starts_at),
          endsAt: new Date(first.ends_at),
          meetLink: first.meet_link,
          purpose: first.purpose,
        };
        const version = meetingVersion(meeting);
        const organiserRow =
          people.find((person) => person.user_id === first.organiser_user_id) ??
          first;
        const organiser = {
          name: organiserRow.display_name,
          email: organiserRow.email,
        };
        const attendees = people
          .filter((person) => person.user_id !== first.organiser_user_id)
          .map((person) => ({
            name: person.display_name,
            email: person.email,
          }));
        for (const person of people) {
          if (person.version === version) continue;
          if (UNDELIVERABLE.test(person.email)) continue;
          const sequence = person.sequence === null ? 0 : person.sequence + 1;
          const message = meetingEmail({
            meetingId: first.meeting_id,
            ...meeting,
            timeZone: zoneOr(person.timezone, zoneOr(first.time_zone, "UTC")),
            updated: person.version !== null,
            sequence,
            organiser,
            attendees,
            appOrigin: dependencies.appOrigin,
            now: current,
          });
          try {
            await email.send({
              to: person.email,
              subject: message.subject,
              text: message.text,
              html: message.html,
              attachments: [
                {
                  filename: "invite.ics",
                  content: message.ics,
                  contentType: "text/calendar; method=REQUEST",
                },
              ],
            });
          } catch (error: unknown) {
            // Retried next pass: nothing was recorded.
            dependencies.logger?.warn(
              {
                meetingId: first.meeting_id,
                errorName: error instanceof Error ? error.name : typeof error,
              },
              "meeting email not sent",
            );
            continue;
          }
          await sql`
            insert into communication.meeting_emails (meeting_id, user_id, version, sequence)
            values (${first.meeting_id}, ${person.user_id}, ${version}, ${sequence})
            on conflict (meeting_id, user_id) do update
              set version = excluded.version, sequence = excluded.sequence,
                  sent_at = clock_timestamp()`;
          sent += 1;
        }
      }
      return { sent };
    },
  };
}

export type MeetingMailer = ReturnType<typeof createMeetingMailer>;
