import { CorrelationIdSchema } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  createRelationshipEventAppender,
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_DEFINITIONS,
  RelationshipIdSchema,
} from "@capital-q/network";

import type {
  MeetingActivityWriter,
  MeetingDirectory,
  MeetingParticipant,
  MeetingRecord,
  NotificationRecord,
  ReminderRecord,
  ScheduleStore,
} from "./store.js";

/**
 * PostgreSQL for meetings, reminders and notifications (BIZ-008), over the
 * privileged server connection: the service has already authorised the
 * caller (party check as the actor, approval for Q's actions).
 */

type MeetingRow = {
  id: string;
  tenant_id: string;
  relationship_id: string;
  organiser_user_id: string;
  organiser_tenant_id: string;
  purpose: string;
  starts_at: Date;
  ends_at: Date;
  time_zone: string;
  status: MeetingRecord["status"];
  google_event_id: string;
  meet_link: string | null;
  q_action_id: string | null;
  idempotency_key: string;
  prep_brief_at: Date | null;
  participants:
    | {
        participant_tenant_id: string;
        user_id: string;
        role: MeetingParticipant["role"];
        display_name: string;
        email: string;
      }[]
    | null;
};

function toMeeting(row: MeetingRow): MeetingRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    relationshipId: row.relationship_id,
    organiserUserId: row.organiser_user_id,
    organiserTenantId: row.organiser_tenant_id,
    purpose: row.purpose,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    timeZone: row.time_zone,
    status: row.status,
    googleEventId: row.google_event_id,
    meetLink: row.meet_link,
    qActionId: row.q_action_id,
    idempotencyKey: row.idempotency_key,
    prepBriefAt:
      row.prep_brief_at === null ? null : new Date(row.prep_brief_at),
    participants: (row.participants ?? []).map((p) => ({
      participantTenantId: p.participant_tenant_id,
      userId: p.user_id,
      role: p.role,
      displayName: p.display_name,
      email: p.email,
    })),
  };
}

type ReminderRow = {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  relationship_id: string | null;
  meeting_id: string | null;
  title: string;
  note: string | null;
  due_at: Date;
  channel: ReminderRecord["channel"];
  status: ReminderRecord["status"];
  source: ReminderRecord["source"];
  email_sent_at: Date | null;
};

function toReminder(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerUserId: row.owner_user_id,
    relationshipId: row.relationship_id,
    meetingId: row.meeting_id,
    title: row.title,
    note: row.note,
    dueAt: new Date(row.due_at),
    channel: row.channel,
    status: row.status,
    source: row.source,
    emailSentAt:
      row.email_sent_at === null ? null : new Date(row.email_sent_at),
  };
}

const REMINDER_COLUMNS = [
  "id",
  "tenant_id",
  "owner_user_id",
  "relationship_id",
  "meeting_id",
  "title",
  "note",
  "due_at",
  "channel",
  "status",
  "source",
  "email_sent_at",
] as const;

export function createPostgresScheduleStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): ScheduleStore {
  const { sql } = options;

  const selectMeetings = (where: ReturnType<DatabaseExecutor>) => sql<
    MeetingRow[]
  >`
    select m.id, m.tenant_id, m.relationship_id, m.organiser_user_id, m.organiser_tenant_id,
           m.purpose, m.starts_at, m.ends_at, m.time_zone, m.status, m.google_event_id,
           m.meet_link, m.q_action_id, m.idempotency_key, m.prep_brief_at,
           (select json_agg(json_build_object(
                     'participant_tenant_id', p.participant_tenant_id, 'user_id', p.user_id,
                     'role', p.role, 'display_name', p.display_name, 'email', p.email)
                   order by p.role desc, p.created_at)
              from communication.meeting_participants p where p.meeting_id = m.id) as participants
      from communication.meetings m
     ${where}`;

  const findMeeting = async (meetingId: string) =>
    (await selectMeetings(sql`where m.id = ${meetingId}`)).map(toMeeting)[0] ??
    null;

  return {
    claimMeeting: async (input) =>
      options.transactions
        .run(async (tx) => {
          const inserted = await tx.sql<{ id: string }[]>`
          insert into communication.meetings
            (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose,
             starts_at, ends_at, time_zone, google_event_id, q_action_id, idempotency_key)
          values (${input.id}, ${input.tenantId}, ${input.relationshipId}, ${input.organiserUserId},
                  ${input.organiserTenantId}, ${input.purpose}, ${input.startsAt}, ${input.endsAt},
                  ${input.timeZone}, ${input.googleEventId}, ${input.qActionId}, ${input.idempotencyKey})
          on conflict do nothing
          returning id`;
          if (inserted.length === 1) {
            for (const participant of input.participants) {
              await tx.sql`
              insert into communication.meeting_participants
                (meeting_id, participant_tenant_id, user_id, role, display_name, email)
              values (${input.id}, ${participant.participantTenantId}, ${participant.userId},
                      ${participant.role}, ${participant.displayName}, ${participant.email})`;
            }
          }
          const existing = await tx.sql<{ id: string }[]>`
          select id from communication.meetings
           where idempotency_key = ${input.idempotencyKey}
              or (${input.qActionId}::uuid is not null and q_action_id = ${input.qActionId}::uuid)
           limit 1`;
          const id = existing[0]?.id;
          if (id === undefined) throw new Error("meeting claim found nothing");
          return { id, created: inserted.length === 1 };
        })
        .then(async ({ id, created }) => {
          const record = await findMeeting(id);
          if (record === null) throw new Error("claimed meeting not found");
          return { record, created };
        }),

    findMeeting,

    listMeetingsForRelationship: async (relationshipId, limit) =>
      (
        await selectMeetings(
          sql`where m.relationship_id = ${relationshipId} order by m.starts_at desc limit ${limit}`,
        )
      ).map(toMeeting),

    listMeetingsForUser: async (userId, from, limit) =>
      (
        await selectMeetings(
          sql`where m.ends_at >= ${from}
                and exists (select 1 from communication.meeting_participants p
                             where p.meeting_id = m.id and p.user_id = ${userId})
              order by m.starts_at asc limit ${limit}`,
        )
      ).map(toMeeting),

    markMeetingScheduled: async (tx, meetingId, meetLink) => {
      await tx.sql`
        update communication.meetings
           set status = 'SCHEDULED', meet_link = ${meetLink}
         where id = ${meetingId} and status in ('SCHEDULING', 'FAILED')`;
    },

    markMeetingFailed: async (meetingId) => {
      await sql`
        update communication.meetings set status = 'FAILED'
         where id = ${meetingId} and status = 'SCHEDULING'`;
    },

    moveMeeting: async (tx, meetingId, times) => {
      const rows = await tx.sql`
        update communication.meetings
           set starts_at = ${times.startsAt}, ends_at = ${times.endsAt},
               prep_brief_at = null
         where id = ${meetingId} and status = 'SCHEDULED'
           and (starts_at <> ${times.startsAt} or ends_at <> ${times.endsAt})
        returning id`;
      if (rows.length === 1) {
        // A moved call needs a fresh brief for its new time.
        await tx.sql`delete from communication.meeting_briefs where meeting_id = ${meetingId}`;
      }
      return rows.length === 1;
    },

    cancelMeeting: async (tx, meetingId) => {
      const rows = await tx.sql`
        update communication.meetings
           set status = 'CANCELLED', cancelled_at = clock_timestamp()
         where id = ${meetingId} and status <> 'CANCELLED'
        returning id`;
      return rows.length === 1;
    },

    meetingsNeedingBrief: async (now, until, limit) =>
      (
        await selectMeetings(
          sql`where m.status = 'SCHEDULED' and m.prep_brief_at is null
                and m.starts_at > ${now} and m.starts_at <= ${until}
              order by m.starts_at asc limit ${limit}`,
        )
      ).map(toMeeting),

    saveBrief: async (tx, input) => {
      await tx.sql`
        insert into communication.meeting_briefs (meeting_id, tenant_id, user_id, composer_version, body)
        values (${input.meetingId}, ${input.tenantId}, ${input.userId}, ${input.composerVersion}, ${input.body})
        on conflict (meeting_id, user_id) do nothing`;
      await tx.sql`
        update communication.meetings set prep_brief_at = clock_timestamp()
         where id = ${input.meetingId} and prep_brief_at is null`;
    },

    findBrief: async (meetingId, userId) => {
      const rows = await sql<{ body: string; created_at: Date }[]>`
        select body, created_at from communication.meeting_briefs
         where meeting_id = ${meetingId} and user_id = ${userId}`;
      const row = rows[0];
      return row === undefined
        ? null
        : { body: row.body, createdAt: new Date(row.created_at) };
    },

    createReminder: async (input) => {
      const inserted = await sql<ReminderRow[]>`
        insert into communication.reminders
          (tenant_id, owner_user_id, relationship_id, title, note, due_at, channel, source,
           q_action_id, idempotency_key)
        values (${input.tenantId}, ${input.ownerUserId}, ${input.relationshipId}, ${input.title},
                ${input.note}, ${input.dueAt}, ${input.channel}, 'PERSON', ${input.qActionId},
                ${input.idempotencyKey})
        on conflict do nothing
        returning ${sql(REMINDER_COLUMNS)}`;
      const row = inserted[0];
      if (row !== undefined) return { record: toReminder(row), created: true };
      const existing = await sql<ReminderRow[]>`
        select ${sql(REMINDER_COLUMNS)} from communication.reminders
         where (owner_user_id = ${input.ownerUserId} and idempotency_key = ${input.idempotencyKey})
            or (${input.qActionId}::uuid is not null and q_action_id = ${input.qActionId}::uuid)
         limit 1`;
      const found = existing[0];
      if (found === undefined) throw new Error("reminder claim found nothing");
      return { record: toReminder(found), created: false };
    },

    upsertMeetingReminder: async (tx, input) => {
      await tx.sql`
        insert into communication.reminders
          (tenant_id, owner_user_id, relationship_id, meeting_id, title, due_at, channel, source,
           idempotency_key)
        values (${input.tenantId}, ${input.ownerUserId}, ${input.relationshipId}, ${input.meetingId},
                ${input.title}, ${input.dueAt}, 'EMAIL', 'MEETING', ${`meeting:${input.meetingId}`})
        on conflict (meeting_id) where meeting_id is not null do update
           set due_at = excluded.due_at, title = excluded.title, status = 'PENDING',
               delivered_at = null, email_sent_at = null`;
    },

    cancelMeetingReminder: async (tx, meetingId) => {
      await tx.sql`
        update communication.reminders set status = 'CANCELLED'
         where meeting_id = ${meetingId} and status = 'PENDING'`;
    },

    listReminders: async (ownerUserId, limit) =>
      (
        await sql<ReminderRow[]>`
          select ${sql(REMINDER_COLUMNS)} from communication.reminders
           where owner_user_id = ${ownerUserId} and status in ('PENDING', 'DELIVERED')
           order by due_at asc limit ${limit}`
      ).map(toReminder),

    dismissReminder: async (ownerUserId, reminderId) => {
      const rows = await sql`
        update communication.reminders set status = 'DISMISSED'
         where id = ${reminderId} and owner_user_id = ${ownerUserId}
           and status in ('PENDING', 'DELIVERED')
        returning id`;
      return rows.length === 1;
    },

    dueReminders: async (now, limit) =>
      (
        await sql<ReminderRow[]>`
          select ${sql(REMINDER_COLUMNS)} from communication.reminders
           where (status = 'PENDING' and due_at <= ${now})
              or (status = 'DELIVERED' and channel = 'EMAIL' and email_sent_at is null
                  and due_at > ${now}::timestamptz - interval '1 hour')
           order by due_at asc limit ${limit}`
      ).map(toReminder),

    markReminderDelivered: async (tx, reminderId, at) => {
      await tx.sql`
        update communication.reminders set status = 'DELIVERED', delivered_at = ${at}
         where id = ${reminderId} and status = 'PENDING'`;
    },

    markReminderEmailed: async (reminderId, at) => {
      await sql`
        update communication.reminders set email_sent_at = ${at}
         where id = ${reminderId} and email_sent_at is null`;
    },

    notify: async (tx, input) => {
      await tx.sql`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
        values (${input.tenantId}, ${input.userId}, ${input.kind}, ${input.title}, ${input.body},
                ${input.linkPath}, ${input.reminderId}, ${input.meetingId}, ${input.dedupeKey})
        on conflict (user_id, dedupe_key) do nothing`;
    },

    listNotifications: async (userId, limit) => {
      const rows = await sql<
        {
          id: string;
          kind: NotificationRecord["kind"];
          title: string;
          body: string | null;
          link_path: string | null;
          read_at: Date | null;
          created_at: Date;
        }[]
      >`
        select id, kind, title, body, link_path, read_at, created_at
          from communication.notifications
         where user_id = ${userId}
         order by created_at desc limit ${limit}`;
      const unread = await sql<{ count: number }[]>`
        select count(*)::int as count from communication.notifications
         where user_id = ${userId} and read_at is null`;
      return {
        items: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          title: row.title,
          body: row.body,
          linkPath: row.link_path,
          readAt: row.read_at === null ? null : new Date(row.read_at),
          createdAt: new Date(row.created_at),
        })),
        unread: unread[0]?.count ?? 0,
      };
    },

    markNotificationsRead: async (userId, ids, at) => {
      if (ids.length === 0) return;
      await sql`
        update communication.notifications set read_at = ${at}
         where user_id = ${userId} and id = any(${ids}::uuid[]) and read_at is null`;
    },
  };
}

/** `meeting_*` activity through the Network appender. */
export function createNetworkMeetingActivityWriter(): MeetingActivityWriter {
  const appender = createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  });
  return {
    record: async (tx: TransactionContext, input) => {
      await appender.append(tx, {
        relationshipId: RelationshipIdSchema.parse(input.relationshipId),
        eventType: input.eventType,
        actor: { type: "HUMAN", id: input.actorUserId },
        source: { type: "MANUAL", id: input.meetingId },
        // Both sides are parties to the call itself.
        visibilityScope: "relationship_shared",
        payload: { meetingId: input.meetingId },
        correlationId: CorrelationIdSchema.parse(input.correlationId),
      });
    },
  };
}

/**
 * People on one relationship: the counterparty organisation's active
 * members with their sign-in address, one person's own name and address,
 * and the counterpart's display name. Read only after the service has
 * proved the actor is a party (or, for the worker, from a meeting row the
 * party check already produced).
 */
export function createPostgresMeetingDirectory(options: {
  readonly sql: DatabaseExecutor;
}): MeetingDirectory {
  const { sql } = options;
  return {
    relationshipTenant: async (relationshipId) =>
      (
        await sql<{ tenant_id: string }[]>`
          select tenant_id from network.relationships where id = ${relationshipId}`
      )[0]?.tenant_id ?? null,

    counterpartPeople: async ({ relationshipId, counterpart }) => {
      const rows = await sql<
        {
          user_id: string;
          tenant_id: string;
          name: string | null;
          email: string;
        }[]
      >`
        select p.id as user_id, m.tenant_id, p.display_name as name, u.email
          from network.relationships r
          join core.companies c on c.id = r.company_id
          join core.investor_organisations io on io.id = r.investor_organisation_id
          join identity.organisation_memberships m
            on m.organisation_id = case when ${counterpart} = 'COMPANY'
                                        then c.organisation_id else io.organisation_id end
           and m.membership_status = 'active'
          join identity.user_profiles p on p.id = m.user_id and p.status = 'active'
          join auth.users u on u.id = p.auth_user_id
         where r.id = ${relationshipId} and u.email is not null
         order by m.joined_at asc
         limit 10`;
      return rows.map((row) => ({
        userId: row.user_id,
        tenantId: row.tenant_id,
        name: row.name?.trim() || row.email.split("@")[0] || row.email,
        email: row.email.toLowerCase(),
      }));
    },

    person: async (userId) => {
      const rows = await sql<{ name: string | null; email: string | null }[]>`
        select p.display_name as name, u.email
          from identity.user_profiles p
          join auth.users u on u.id = p.auth_user_id
         where p.id = ${userId} and p.status = 'active'`;
      const row = rows[0];
      if (row === undefined || row.email === null) return null;
      return {
        name: row.name?.trim() || row.email.split("@")[0] || row.email,
        email: row.email.toLowerCase(),
      };
    },

    counterpartName: async ({ relationshipId, organiserTenantId }) =>
      (
        await sql<{ name: string }[]>`
          select case when c.tenant_id = ${organiserTenantId}
                      then io.display_name else c.canonical_name end as name
            from network.relationships r
            join core.companies c on c.id = r.company_id
            join core.investor_organisations io on io.id = r.investor_organisation_id
           where r.id = ${relationshipId}`
      )[0]?.name ?? null,
  };
}
