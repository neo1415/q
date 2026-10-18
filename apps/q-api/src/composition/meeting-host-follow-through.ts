import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContextResolver } from "@capital-q/security";

import type { MeetingHostFollowThrough } from "./meeting-host-runtime.js";

/**
 * After a call Q hosted did not take place, or with actions asked for in
 * it (MEET-HOST, founder direction 2026-10-01). Everything here goes
 * through paths the organiser already owns: the relationship's history
 * gets `meeting_no_show`, and people are told by a notice and an email.
 *
 * 2026-10-09 (live bug): Q NEVER cancels or reschedules a booked meeting
 * because someone was absent. It used to withdraw the calendar invite on a
 * no-show and promise to "reach out"; both are gone. The booking stays as
 * it is; a new time is only ever proposed through the meeting proposal
 * state machine and takes effect when the investor (or an authorised
 * party) explicitly accepts it.
 */

type Sql = DatabaseExecutor;

type Logger = {
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
};

type Person = {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly display_name: string;
  readonly email: string;
  readonly side: "FOUNDER" | "INVESTOR" | null;
  readonly organiser: boolean;
};

type Meeting = {
  readonly relationship_id: string;
  readonly organiser_user_id: string;
  readonly purpose: string;
  readonly company_id: string;
  readonly investor_organisation_id: string;
};

export type MeetingHostFollowThroughDependencies = {
  readonly sql: Sql;
  readonly resolver: ActorContextResolver;
  /** `meeting_no_show` on the relationship, through Network's appender. */
  readonly markNoShow: (input: {
    readonly relationshipId: string;
    readonly meetingId: string;
    readonly actorUserId: string;
  }) => Promise<void>;
  /** A plain email; absent or failing, the notice still stands. */
  readonly email?: (input: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
  }) => Promise<void>;
  readonly publicWebUrl?: string | undefined;
  readonly logger?: Logger;
};

export function createMeetingHostFollowThrough(
  dependencies: MeetingHostFollowThroughDependencies,
): MeetingHostFollowThrough {
  const { sql, logger } = dependencies;

  async function meetingOf(meetingId: string): Promise<{
    readonly meeting: Meeting;
    readonly people: readonly Person[];
  } | null> {
    const meetings = await sql<Meeting[]>`
      select m.relationship_id, m.organiser_user_id, m.purpose,
             r.company_id, r.investor_organisation_id
        from communication.meetings m
        join network.relationships r on r.id = m.relationship_id
       where m.id = ${meetingId}
       limit 1`;
    const meeting = meetings[0];
    if (meeting === undefined) return null;
    const people = await sql<Person[]>`
      select p.user_id, p.participant_tenant_id as tenant_id, p.display_name, p.email,
             case when exists (select 1 from identity.organisation_memberships om
                                where om.user_id = p.user_id and om.organisation_id = c.organisation_id
                                  and om.membership_status = 'active') then 'FOUNDER'
                  when exists (select 1 from identity.organisation_memberships om
                                where om.user_id = p.user_id and om.organisation_id = i.organisation_id
                                  and om.membership_status = 'active') then 'INVESTOR'
             end as side,
             p.role = 'ORGANISER' as organiser
        from communication.meeting_participants p
        join core.companies c on c.id = ${meeting.company_id}
        join core.investor_organisations i on i.id = ${meeting.investor_organisation_id}
       where p.meeting_id = ${meetingId}`;
    return { meeting, people };
  }

  /** Where each person rebooks: the relationship, from their own side. */
  const linkFor = (meeting: Meeting, person: Person) =>
    person.side === "INVESTOR"
      ? `/relationships/company/${meeting.company_id}`
      : `/relationships/investor/${meeting.investor_organisation_id}`;

  async function tell(
    meetingId: string,
    meeting: Meeting,
    person: Person,
    title: string,
    body: string,
    key: string,
  ): Promise<void> {
    const link = linkFor(meeting, person);
    await sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
      values (${person.tenant_id}, ${person.user_id}, 'Q_MESSAGE', ${title.slice(0, 200)},
              ${body.slice(0, 1_000)}, ${link}, null, ${meetingId},
              ${`${key}:${meetingId}`.slice(0, 200)})
      on conflict (user_id, dedupe_key) do nothing`;
    if (dependencies.email !== undefined) {
      const url =
        dependencies.publicWebUrl === undefined
          ? ""
          : `\n\n${dependencies.publicWebUrl.replace(/\/+$/, "")}${link}`;
      await dependencies
        .email({
          to: person.email,
          subject: title.replace(/[\r\n]+/g, " ").slice(0, 150),
          text: `${body}${url}`,
        })
        .catch((error: unknown) => {
          logger?.warn(
            { err: error, meetingId },
            "meeting host email not sent",
          );
        });
    }
  }

  async function mark(meetingId: string, meeting: Meeting): Promise<void> {
    await dependencies
      .markNoShow({
        relationshipId: meeting.relationship_id,
        meetingId,
        actorUserId: meeting.organiser_user_id,
      })
      .catch((error: unknown) => {
        logger?.warn({ err: error, meetingId }, "no-show not recorded");
      });
  }

  return {
    noShow: async (meetingId) => {
      const found = await meetingOf(meetingId);
      if (found === null) return;
      const { meeting, people } = found;
      await mark(meetingId, meeting);
      for (const person of people) {
        await tell(
          meetingId,
          meeting,
          person,
          `Nobody joined ${meeting.purpose} before Q's wait ended`,
          "Q waited in the call as long as it is allowed to, then left. Your meeting is exactly as it was: nothing was cancelled or moved. If you want another time, open the relationship and ask Q to propose one; it only changes once the other person accepts.",
          "no-show",
        );
      }
    },

    oneSided: async (meetingId, outcome) => {
      const found = await meetingOf(meetingId);
      if (found === null) return;
      const { meeting, people } = found;
      // The absent side is not marked: not joining is not evidence (a link
      // that failed, a late train). Only a call nobody joined is a no-show.
      const present = people.filter((p) => p.side === outcome.presentSide);
      const absent = people.filter((p) => p.side === outcome.absentSide);
      const presentNames =
        present.map((p) => p.display_name).join(" and ") || "The other side";
      for (const person of absent) {
        await tell(
          meetingId,
          meeting,
          person,
          `We missed you at ${meeting.purpose}`,
          `${presentNames} waited in the call. Your meeting is unchanged. If you would like another time, open the relationship; nothing is booked or moved until you accept a proposed time.`,
          "one-sided-missed",
        );
      }
      for (const person of present) {
        await tell(
          meetingId,
          meeting,
          person,
          `Q left the call for ${meeting.purpose}`,
          outcome.rescheduleRequested
            ? "You asked for a new time. Open the relationship and propose one or more options; the other person decides, and nothing changes until they accept."
            : "The other participant did not join before Q's wait ended. Your meeting is unchanged; nothing was cancelled or rescheduled.",
          "one-sided-left",
        );
      }
    },

    proposals: async (meetingId, count) => {
      const found = await meetingOf(meetingId);
      if (found === null) return;
      const organiser = found.people.find((p) => p.organiser);
      if (organiser === undefined) return;
      await tell(
        meetingId,
        found.meeting,
        organiser,
        `${String(count)} request${count === 1 ? "" : "s"} from your call to approve`,
        "Q noted what was asked for in the call. Nothing was done; review each one and ask Q to carry out what you approve.",
        "host-proposals",
      );
    },
  };
}
