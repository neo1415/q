import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";

import type {
  InboxActivityKind,
  InboxFolder,
  InboxRepository,
  InboxRow,
} from "../inbox/ports.js";

/**
 * F4's store: the gateq.inbox_* tables, read and written by the privileged
 * server role only after GateQ has authorised the gateway (the service
 * does that first, every time). Every query names the gateway and tenant
 * the authority resolved; nothing here takes either from a request.
 */

type Row = {
  application_id: string;
  submitted_at: Date;
  snapshot: unknown;
  qualification: unknown;
  folder: string | null;
  assignee_user_id: string | null;
  starred: boolean | null;
  read_at: Date | null;
  labels: string[] | null;
  answered: boolean;
};

const folderOf = (value: string | null): InboxFolder =>
  value === "ARCHIVED" || value === "PASSED" ? value : "INBOX";

function toRow(row: Row): InboxRow {
  return {
    applicationId: row.application_id,
    submittedAt: new Date(row.submitted_at).toISOString(),
    snapshot: row.snapshot,
    qualification: row.qualification,
    folder: folderOf(row.folder),
    assigneeUserId: row.assignee_user_id,
    starred: row.starred === true,
    readAt: row.read_at === null ? null : new Date(row.read_at).toISOString(),
    labels: row.labels ?? [],
    answered: row.answered,
  };
}

export function createPostgresInboxRepository(options: {
  readonly sql: DatabaseExecutor;
}): InboxRepository {
  const { sql } = options;

  const select = (input: {
    tenantId: string;
    gatewayId: string;
    userId: string;
    applicationId?: string | undefined;
  }) => sql<Row[]>`
    select s.application_id, s.submitted_at, s.snapshot, s.qualification,
           i.folder, i.assignee_user_id, u.starred, u.read_at,
           (select coalesce(array_agg(l.name order by l.name), '{}')
              from gateq.inbox_item_labels il
              join gateq.inbox_labels l on l.id = il.label_id
             where il.application_id = s.application_id) as labels,
           exists (select 1 from gateq.inbox_messages m
                    where m.application_id = s.application_id) as answered
      from gateq.application_submissions s
      join gateq.applications a on a.id = s.application_id
      left join gateq.inbox_items i on i.application_id = s.application_id
      left join gateq.inbox_user_state u
             on u.application_id = s.application_id and u.user_id = ${input.userId}
     where a.gateway_id = ${input.gatewayId}
       and s.tenant_id = ${input.tenantId}
       ${input.applicationId === undefined ? sql`` : sql`and s.application_id = ${input.applicationId}`}
     order by s.submitted_at desc
     limit 500`;

  const ensureItems = async (
    exec: DatabaseExecutor,
    input: {
      tenantId: string;
      gatewayId: string;
      applicationIds: readonly string[];
    },
  ) => {
    for (const applicationId of input.applicationIds) {
      await exec`
        insert into gateq.inbox_items (application_id, tenant_id, gateway_id)
        values (${applicationId}, ${input.tenantId}, ${input.gatewayId})
        on conflict (application_id) do nothing`;
    }
  };

  return {
    list: async (input) => (await select(input)).map(toRow),

    one: async (input) => {
      const rows = await select(input);
      const row = rows[0];
      return row === undefined ? null : toRow(row);
    },

    submittedAmong: async (input) => {
      if (input.applicationIds.length === 0) return [];
      const rows = await sql<{ application_id: string }[]>`
        select s.application_id
          from gateq.application_submissions s
          join gateq.applications a on a.id = s.application_id
         where a.gateway_id = ${input.gatewayId}
           and s.tenant_id = ${input.tenantId}
           and s.application_id = any(${input.applicationIds as string[]}::uuid[])`;
      return rows.map((row) => row.application_id);
    },

    replyWithinDays: async (gatewayId) => {
      const rows = await sql<{ reply_within_days: number | null }[]>`
        select reply_within_days from gateq.inbox_settings where gateway_id = ${gatewayId}`;
      return rows[0]?.reply_within_days ?? null;
    },

    setReplyWithinDays: async (tx, input) => {
      await tx.sql`
        insert into gateq.inbox_settings (gateway_id, tenant_id, reply_within_days, updated_by_user_id)
        values (${input.gatewayId}, ${input.tenantId}, ${input.replyWithinDays}, ${input.userId})
        on conflict (gateway_id) do update
          set reply_within_days = excluded.reply_within_days,
              updated_by_user_id = excluded.updated_by_user_id,
              updated_at = now()`;
    },

    members: async (input) => {
      const rows = await sql<{ user_id: string; name: string | null }[]>`
        select m.user_id,
               coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as name
          from identity.organisation_memberships m
          join identity.user_profiles p on p.id = m.user_id
         where m.organisation_id = ${input.organisationId}
           and m.tenant_id = ${input.tenantId}
           and m.membership_status = 'active'
         order by name nulls last
         limit 200`;
      return rows.map((row) => ({
        userId: row.user_id,
        name: row.name ?? "A colleague",
      }));
    },

    labels: async (gatewayId) => {
      const rows = await sql<{ name: string }[]>`
        select name from gateq.inbox_labels where gateway_id = ${gatewayId} order by lower(name) limit 100`;
      return rows.map((row) => row.name);
    },

    setFolder: async (tx, input) => {
      await ensureItems(tx.sql, input);
      await tx.sql`
        update gateq.inbox_items
           set folder = ${input.folder}, updated_at = now()
         where gateway_id = ${input.gatewayId}
           and application_id = any(${input.applicationIds as string[]}::uuid[])`;
    },

    setAssignee: async (tx, input) => {
      await ensureItems(tx.sql, input);
      await tx.sql`
        update gateq.inbox_items
           set assignee_user_id = ${input.assigneeUserId}, updated_at = now()
         where gateway_id = ${input.gatewayId}
           and application_id = any(${input.applicationIds as string[]}::uuid[])`;
    },

    setStar: async (input) => {
      for (const applicationId of input.applicationIds) {
        await sql`
          insert into gateq.inbox_user_state (application_id, user_id, tenant_id, starred)
          values (${applicationId}, ${input.userId}, ${input.tenantId}, ${input.starred})
          on conflict (application_id, user_id) do update set starred = excluded.starred`;
      }
    },

    markRead: async (input) => {
      await sql`
        insert into gateq.inbox_user_state (application_id, user_id, tenant_id, read_at)
        values (${input.applicationId}, ${input.userId}, ${input.tenantId}, ${input.at})
        on conflict (application_id, user_id) do update
          set read_at = coalesce(gateq.inbox_user_state.read_at, excluded.read_at)`;
    },

    setLabel: async (tx, input) => {
      if (input.on) {
        await tx.sql`
          insert into gateq.inbox_labels (tenant_id, gateway_id, name, created_by_user_id)
          values (${input.tenantId}, ${input.gatewayId}, ${input.label}, ${input.userId})
          on conflict (gateway_id, lower(btrim(name))) do nothing`;
      }
      const labels = await tx.sql<{ id: string }[]>`
        select id from gateq.inbox_labels
         where gateway_id = ${input.gatewayId} and lower(btrim(name)) = lower(btrim(${input.label}))`;
      const labelId = labels[0]?.id;
      if (labelId === undefined) return;
      for (const applicationId of input.applicationIds) {
        if (input.on) {
          await tx.sql`
            insert into gateq.inbox_item_labels (application_id, label_id, tenant_id)
            values (${applicationId}, ${labelId}, ${input.tenantId})
            on conflict do nothing`;
        } else {
          await tx.sql`
            delete from gateq.inbox_item_labels
             where application_id = ${applicationId} and label_id = ${labelId}`;
        }
      }
    },

    addNote: async (tx, input) => {
      const rows = await tx.sql<{ id: string }[]>`
        insert into gateq.inbox_notes (application_id, tenant_id, author_user_id, body, client_request_id)
        values (${input.applicationId}, ${input.tenantId}, ${input.authorUserId}, ${input.body}, ${input.clientRequestId})
        on conflict (application_id, client_request_id) do nothing
        returning id`;
      return { deduplicated: rows.length === 0 };
    },

    notes: async (applicationId) => {
      const rows = await sql<
        {
          id: string;
          author_user_id: string;
          name: string | null;
          body: string;
          created_at: Date;
        }[]
      >`
        select n.id, n.author_user_id, p.display_name as name, n.body, n.created_at
          from gateq.inbox_notes n
          left join identity.user_profiles p on p.id = n.author_user_id
         where n.application_id = ${applicationId}
         order by n.created_at
         limit 200`;
      return rows.map((row) => ({
        id: row.id,
        authorUserId: row.author_user_id,
        authorName: row.name ?? "A colleague",
        body: row.body,
        createdAt: new Date(row.created_at).toISOString(),
      }));
    },

    addMessage: async (tx, input) => {
      const rows = await tx.sql<{ id: string }[]>`
        insert into gateq.inbox_messages
          (application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id)
        values (${input.applicationId}, ${input.tenantId}, ${input.kind}, ${input.reasonCode},
                ${input.body}, ${input.bodySha256}, ${input.approvedByUserId}, ${input.clientRequestId})
        on conflict (application_id, client_request_id) do nothing
        returning id`;
      return { deduplicated: rows.length === 0 };
    },

    messages: async (applicationId) => {
      const rows = await sql<
        {
          kind: "PASS" | "REPLY";
          reason_code: string | null;
          body: string;
          created_at: Date;
        }[]
      >`
        select kind, reason_code, body, created_at from gateq.inbox_messages
         where application_id = ${applicationId} order by created_at limit 50`;
      return rows.map((row) => ({
        kind: row.kind,
        reasonCode: row.reason_code,
        body: row.body,
        createdAt: new Date(row.created_at).toISOString(),
      }));
    },

    record: async (tx, activity) => {
      await tx.sql`
        insert into gateq.inbox_activity (application_id, tenant_id, actor_user_id, kind, detail)
        values (${activity.applicationId}, ${activity.tenantId}, ${activity.actorUserId},
                ${activity.kind}, ${jsonbParam(tx.sql, activity.detail)})`;
    },

    recordNow: async (activity) => {
      await sql`
        insert into gateq.inbox_activity (application_id, tenant_id, actor_user_id, kind, detail)
        values (${activity.applicationId}, ${activity.tenantId}, ${activity.actorUserId},
                ${activity.kind}, ${jsonbParam(sql, activity.detail)})`;
    },

    activity: async (applicationId) => {
      const rows = await sql<
        {
          kind: InboxActivityKind;
          detail: Record<string, unknown>;
          name: string | null;
          created_at: Date;
        }[]
      >`
        select a.kind, a.detail, p.display_name as name, a.created_at
          from gateq.inbox_activity a
          left join identity.user_profiles p on p.id = a.actor_user_id
         where a.application_id = ${applicationId}
         order by a.created_at
         limit 200`;
      return rows.map((row) => ({
        kind: row.kind,
        detail: row.detail,
        actorName: row.name,
        createdAt: new Date(row.created_at).toISOString(),
      }));
    },
  };
}
