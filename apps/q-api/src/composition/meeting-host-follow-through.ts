import type { DatabaseExecutor } from "@capital-q/database";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type ActorContextResolver,
} from "@capital-q/security";

import type { MeetingHostFollowThrough } from "./meeting-host-runtime.js";

/**
 * After a call Q hosted did not take place, or with actions asked for in
 * it (MEET-HOST, founder direction 2026-10-01). Everything here goes
 * through paths the organiser already owns: the meeting is cancelled by the
 * existing cancel path (the calendar event deleted with sendUpdates=all,
 * attendees told), the relationship's history gets `meeting_no_show`, and
 * people are told by a notice and an email. Rebooking is never done here:
 * the notice takes them to the relationship, where asking Q to find a new
 * time goes through the approval-gated booking path. A Google Meet link
 * itself cannot be revoked by Capital Q; cancelling the event withdraws
 * the invite so the link is no longer promoted.
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
  /** The existing cancel path, as the organiser. */
  readonly cancel: (actor: ActorContext, meetingId: string) => Promise<boolean>;
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

  async function organiserActor(userId: string): Promise<ActorContext | null> {
    const rows = await sql<{ auth_user_id: string | null }[]>`
      select auth_user_id from identity.user_profiles where id = ${userId} limit 1`;
    const auth = AuthUserIdSchema.safeParse(rows[0]?.auth_user_id);
    if (!auth.success) return null;
    const resolution = await resolveHumanActorContext(dependencies.resolver, {
      principal: { authUserId: auth.data },
      selection: {},
    });
    return resolution.status === "RESOLVED" &&
      resolution.context.userId === userId
      ? resolution.context
      : null;
  }

  async function markAndCancel(
    meetingId: string,
    meeting: Meeting,
    cancel: boolean,
  ): Promise<void> {
    await dependencies
      .markNoShow({
        relationshipId: meeting.relationship_id,
        meetingId,
        actorUserId: meeting.organiser_user_id,
      })
      .catch((error: unknown) => {
        logger?.warn({ err: error, meetingId }, "no-show not recorded");
      });
    if (!cancel) return;
    const actor = await organiserActor(meeting.organiser_user_id).catch(
      () => null,
    );
    const cancelled =
      actor === null
        ? false
        : await dependencies.cancel(actor, meetingId).catch(() => false);
    if (!cancelled) {
      logger?.warn({ meetingId }, "no-show meeting not cancelled");
    }
  }

  return {
    noShow: async (meetingId) => {
      const found = await meetingOf(meetingId);
      if (found === null) return;
      const { meeting, people } = found;
      await markAndCancel(meetingId, meeting, true);
      for (const person of people) {
        await tell(
          meetingId,
          meeting,
          person,
          `Nobody made it to ${meeting.purpose}. Want me to find a new time?`,
          "Q waited in the call and nobody joined, so the invite has been withdrawn. Open the relationship and ask Q to find a new time; nothing is booked until you approve it.",
          "no-show",
        );
      }
    },

    oneSided: async (meetingId, outcome) => {
      const found = await meetingOf(meetingId);
      if (found === null) return;
      const { meeting, people } = found;
      await markAndCancel(meetingId, meeting, false);
      const present = people.filter((p) => p.side === outcome.presentSide);
      const absent = people.filter((p) => p.side === outcome.absentSide);
      const presentNames =
        present.map((p) => p.display_name).join(" and ") || "The other side";
      if (!outcome.reschedule) {
        for (const person of present) {
          await tell(
            meetingId,
            meeting,
            person,
            `Noted: Q won't look for a new time for ${meeting.purpose}`,
            "You told Q not to reschedule. If you change your mind, ask Q from the relationship.",
            "one-sided-never-mind",
          );
        }
        return;
      }
      for (const person of absent) {
        await tell(
          meetingId,
          meeting,
          person,
          `We missed you at ${meeting.purpose}. Want to find a new time?`,
          `${presentNames} waited in the call. Open the relationship and ask Q to find a new time; nothing is booked until it is approved.`,
          "one-sided-missed",
        );
      }
      for (const person of present) {
        await tell(
          meetingId,
          meeting,
          person,
          `Q has reached out to find a new time for ${meeting.purpose}`,
          "You'll get the invite as soon as a new time is agreed.",
          "one-sided-reaching-out",
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
