import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import { STAGE_WORDS } from "../domain/activity.js";
import {
  resourceKey,
  type ActivityPerson,
  type ActivityRecord,
  type MemberRecord,
  type OrganisationAdminStore,
  type ResolvedResource,
  type RoleSpan,
  type SentInvitation,
  type TouchedRelationship,
} from "../application/organisation-admin-ports.js";

/**
 * Postgres reads behind the organisation-admin service. Server-side only,
 * through the privileged API connection: audit.material_actions has no
 * client grants and stays that way. Every statement is bounded by the
 * organisation (and tenant) the service passed from the actor context.
 *
 * The feed's effective action type is, for a Q-executed action, the action
 * Q carried out (metadata.actionType, format-checked); privacy filters and
 * kind filters apply to it in SQL, so a page never shrinks after the fetch
 * and the keyset cursor stays stable.
 */

const ACTION_FORMAT = "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$";

const ActivityRow = z.object({
  key: z.string(),
  event_id: z.string(),
  occurred_at: z.string(),
  actor_type: z.enum(["human", "q", "capital_q_system", "connected_system"]),
  actor_id: z.string().nullable(),
  authority_user_id: z.string().nullable(),
  action_type: z.string(),
  effective_type: z.string(),
  resource_type: z.string(),
  resource_id: z.string(),
  outcome: z.enum(["SUCCEEDED", "FAILED", "DENIED"]),
  role_from: z.string().nullable(),
  role_to: z.string().nullable(),
});

const PersonRow = z.object({
  user_id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

const MemberRow = z.object({
  membership_id: z.string(),
  user_id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(["active", "left", "revoked"]),
  joined_at: z.string(),
  left_at: z.string().nullable(),
  role_codes: z.array(z.string()),
});

export function createPostgresOrganisationAdminStore(options: {
  readonly sql: DatabaseExecutor;
}): OrganisationAdminStore {
  const { sql } = options;

  return {
    activity: async (filter) => {
      const rows = await sql`
        with shown as (
          select a.id, a.event_id, a.occurred_at, a.actor_type, a.actor_id,
                 a.authority_user_id, a.action_type, a.resource_type,
                 a.resource_id, a.outcome, a.metadata,
                 case
                   when a.action_type = any(${[...filter.qExecutedTypes]}::text[])
                    and a.metadata->>'actionType' ~ ${ACTION_FORMAT}
                   then a.metadata->>'actionType'
                   else a.action_type
                 end as effective_type
            from audit.material_actions a
           where a.organisation_id = ${filter.organisationId}
             and a.tenant_id = ${filter.tenantId}
             and (${filter.userId ?? null}::uuid is null
                  or a.actor_id = ${filter.userId ?? null}::uuid
                  or a.authority_user_id = ${filter.userId ?? null}::uuid)
             and (${filter.from ?? null}::timestamptz is null
                  or a.occurred_at >= ${filter.from ?? null}::timestamptz)
             and (${filter.to ?? null}::timestamptz is null
                  or a.occurred_at < ${filter.to ?? null}::timestamptz)
             and (${filter.before?.at ?? null}::timestamptz is null
                  or a.occurred_at < ${filter.before?.at ?? null}::timestamptz
                  or (a.occurred_at = ${filter.before?.at ?? null}::timestamptz
                      and a.id < ${filter.before?.key ?? null}::bigint))
        )
        select s.id::text as key, s.event_id::text as event_id,
               to_char(s.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as occurred_at,
               s.actor_type, s.actor_id::text as actor_id,
               s.authority_user_id::text as authority_user_id,
               s.action_type, s.effective_type, s.resource_type, s.resource_id,
               s.outcome,
               case when s.action_type = 'team.membership.role_changed'
                    then s.metadata->>'from' end as role_from,
               case when s.action_type = 'team.membership.role_changed'
                    then s.metadata->>'to' end as role_to
          from shown s
         where not (s.effective_type like any(${[...filter.privatePatterns]}::text[]))
           and (s.action_type = any(${[...filter.qExecutedTypes]}::text[])
                or not (s.action_type like any(${[...filter.privatePatterns]}::text[])))
           and (cardinality(${[...filter.include]}::text[]) = 0
                or s.effective_type like any(${[...filter.include]}::text[]))
           and not (s.effective_type like any(${[...filter.exclude]}::text[]))
         order by s.occurred_at desc, s.id desc
         limit ${filter.limit}`;
      return rows.map((raw): ActivityRecord => {
        const r = ActivityRow.parse(raw);
        return {
          key: r.key,
          eventId: r.event_id,
          occurredAt: r.occurred_at,
          actorType: r.actor_type,
          actorId: r.actor_id,
          authorityUserId: r.authority_user_id,
          actionType: r.action_type,
          effectiveActionType: r.effective_type,
          resourceType: r.resource_type,
          resourceId: r.resource_id,
          outcome: r.outcome,
          roleFrom: r.role_from,
          roleTo: r.role_to,
        };
      });
    },

    people: async (organisationId, userIds) => {
      if (userIds.length === 0) return new Map();
      // Only people who are or were members of THIS organisation.
      const rows = await sql`
        select distinct on (p.id) p.id::text as user_id,
               coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as name,
               u.email::text as email
          from identity.organisation_memberships m
          join identity.user_profiles p on p.id = m.user_id
          left join auth.users u on u.id = p.auth_user_id
         where m.organisation_id = ${organisationId}
           and m.user_id = any(${[...userIds]}::uuid[])
         order by p.id`;
      return new Map(
        rows.map((raw): [string, ActivityPerson] => {
          const r = PersonRow.parse(raw);
          return [
            r.user_id,
            { userId: r.user_id, name: r.name, email: r.email },
          ];
        }),
      );
    },

    resources: async ({
      tenantId,
      organisationId,
      refs,
      relationshipsVisible,
    }) => {
      const out = new Map<string, ResolvedResource>();
      const ids = (type: string) => [
        ...new Set(
          refs
            .filter((ref) => ref.type === type)
            .map((ref) => ref.id)
            .filter((id) => z.uuid().safeParse(id).success),
        ),
      ];

      const memberships = ids("membership");
      if (memberships.length > 0) {
        const rows = await sql<
          { id: string; name: string | null; email: string | null }[]
        >`
          select m.id::text as id,
                 coalesce(nullif(btrim(p.display_name), ''),
                          nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as name,
                 u.email::text as email
            from identity.organisation_memberships m
            join identity.user_profiles p on p.id = m.user_id
            left join auth.users u on u.id = p.auth_user_id
           where m.organisation_id = ${organisationId}
             and m.id = any(${memberships}::uuid[])`;
        for (const row of rows) {
          const label = row.name ?? row.email?.split("@")[0] ?? "a team member";
          out.set(resourceKey({ type: "membership", id: row.id }), {
            label: label.slice(0, 260),
            link: "/settings/team",
          });
        }
      }

      const invitations = ids("invitation");
      if (invitations.length > 0) {
        // The team page already shows an admin their invitations' emails.
        const rows = await sql<{ id: string; email: string }[]>`
          select id::text as id, email
            from identity.organisation_invitations
           where organisation_id = ${organisationId}
             and id = any(${invitations}::uuid[])`;
        for (const row of rows) {
          out.set(resourceKey({ type: "invitation", id: row.id }), {
            label: `Invitation to ${row.email}`.slice(0, 260),
            link: "/settings/team",
          });
        }
      }

      for (const type of ["join_request", "ownership_offer"] as const) {
        for (const id of ids(type)) {
          out.set(resourceKey({ type, id }), {
            label:
              type === "join_request"
                ? "A request to join"
                : "An ownership offer",
            link: "/settings/team",
          });
        }
      }

      if (ids("organisation").includes(organisationId)) {
        const rows = await sql<{ name: string }[]>`
          select display_name as name from identity.organisations
           where id = ${organisationId}`;
        const name = rows[0]?.name;
        if (name !== undefined) {
          out.set(resourceKey({ type: "organisation", id: organisationId }), {
            label: name.slice(0, 260),
            link: "/settings",
          });
        }
      }

      const companies = ids("company");
      if (companies.length > 0) {
        // Our own company by name; another company only through one of our
        // own relationships, and only when the admin sees the pipeline.
        const rows = await sql<{ id: string; name: string; own: boolean }[]>`
          select c.id::text as id, c.canonical_name as name,
                 (c.organisation_id = ${organisationId} and c.tenant_id = ${tenantId}) as own
            from core.companies c
           where c.id = any(${companies}::uuid[])
             and ((c.organisation_id = ${organisationId} and c.tenant_id = ${tenantId})
                  or (${relationshipsVisible}::boolean and exists (
                        select 1
                          from network.relationships r
                          join core.investor_organisations io
                            on io.id = r.investor_organisation_id
                         where r.company_id = c.id
                           and io.organisation_id = ${organisationId})))`;
        for (const row of rows) {
          out.set(resourceKey({ type: "company", id: row.id }), {
            label: row.name.slice(0, 260),
            link: row.own
              ? `/company/${row.id}`
              : `/relationships/company/${row.id}`,
          });
        }
      }

      const investors = ids("investor_organisation");
      if (investors.length > 0) {
        const rows = await sql<{ id: string; name: string; own: boolean }[]>`
          select io.id::text as id, io.display_name as name,
                 (io.organisation_id = ${organisationId}) as own
            from core.investor_organisations io
           where io.id = any(${investors}::uuid[])
             and (io.organisation_id = ${organisationId}
                  or (${relationshipsVisible}::boolean and exists (
                        select 1
                          from network.relationships r
                          join core.companies c on c.id = r.company_id
                         where r.investor_organisation_id = io.id
                           and c.organisation_id = ${organisationId}
                           and c.tenant_id = ${tenantId})))`;
        for (const row of rows) {
          out.set(resourceKey({ type: "investor_organisation", id: row.id }), {
            label: row.name.slice(0, 260),
            link: row.own ? null : `/relationships/investor/${row.id}`,
          });
        }
      }

      if (!relationshipsVisible) return out;

      // Relationships, their events and notes: only where this organisation
      // is a party, labelled by the counterpart, linked to our side's page.
      const relationshipIds = ids("relationship");
      const eventIds = ids("relationship_event");
      const noteIds = ids("relationship_note");
      if (relationshipIds.length + eventIds.length + noteIds.length === 0) {
        return out;
      }
      const rows = await sql<
        {
          type: string;
          id: string;
          counterpart: string | null;
          side: "COMPANY" | "INVESTOR";
          company_id: string;
          investor_organisation_id: string;
          event_type: string | null;
          note_body: string | null;
          superseded_body: string | null;
        }[]
      >`
        with mine as (
          select r.id, r.company_id, r.investor_organisation_id,
                 case when c.organisation_id = ${organisationId} and c.tenant_id = ${tenantId}
                      then 'COMPANY' else 'INVESTOR' end as side,
                 case when c.organisation_id = ${organisationId} and c.tenant_id = ${tenantId}
                      then io.display_name else c.canonical_name end as counterpart
            from network.relationships r
            join core.companies c on c.id = r.company_id
            join core.investor_organisations io on io.id = r.investor_organisation_id
           where (c.organisation_id = ${organisationId} and c.tenant_id = ${tenantId})
              or io.organisation_id = ${organisationId}
        )
        select 'relationship' as type, m.id::text as id, m.counterpart, m.side,
               m.company_id::text as company_id,
               m.investor_organisation_id::text as investor_organisation_id,
               null::text as event_type, null::text as note_body, null::text as superseded_body
          from mine m
         where m.id = any(${relationshipIds}::uuid[])
        union all
        select 'relationship_event', e.id::text, m.counterpart, m.side,
               m.company_id::text, m.investor_organisation_id::text,
               e.event_type, null, null
          from network.relationship_events e
          join mine m on m.id = e.relationship_id
         where e.id = any(${eventIds}::uuid[])
           and e.visibility_scope <> 'personal_private'
        union all
        select 'relationship_note', n.id::text, m.counterpart, m.side,
               m.company_id::text, m.investor_organisation_id::text,
               null, n.body, prev.body
          from network.relationship_notes n
          join mine m on m.id = n.relationship_id
          left join network.relationship_notes prev
            on prev.id = n.supersedes_note_id
           and prev.organisation_id = n.organisation_id
         where n.id = any(${noteIds}::uuid[])
           and n.organisation_id = ${organisationId}
           and n.tenant_id = ${tenantId}`;
      const excerpt = (text: string | null) =>
        text === null
          ? null
          : text.replace(/\s+/g, " ").trim().slice(0, 140) +
            (text.length > 140 ? "…" : "");
      for (const row of rows) {
        const link =
          row.side === "COMPANY"
            ? `/relationships/investor/${row.investor_organisation_id}`
            : `/relationships/company/${row.company_id}`;
        const label =
          row.counterpart === null
            ? "a relationship"
            : `Relationship with ${row.counterpart}`.slice(0, 260);
        let change: ResolvedResource["change"] = null;
        if (row.type === "relationship_event" && row.event_type !== null) {
          const stage = STAGE_WORDS[row.event_type];
          change = stage === undefined ? null : { before: null, after: stage };
        }
        if (row.type === "relationship_note" && row.superseded_body !== null) {
          // A correction: the superseded note stays as history; both are
          // this organisation's own notes on its own side.
          change = {
            before: excerpt(row.superseded_body),
            after: excerpt(row.note_body),
          };
        }
        out.set(resourceKey({ type: row.type, id: row.id }), {
          label,
          link,
          change,
        });
      }
      return out;
    },

    member: async (organisationId, userId) => {
      const rows = await sql`
        select m.id::text as membership_id, m.user_id::text as user_id,
               coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as name,
               u.email::text as email,
               m.membership_status as status,
               to_char(m.joined_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as joined_at,
               to_char(m.left_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as left_at,
               coalesce(
                 (select array_agg(r.code order by r.code)
                    from identity.membership_roles mr
                    join permissions.roles r on r.id = mr.role_id and r.status = 'active'
                   where mr.membership_id = m.id
                     and mr.valid_from <= now()
                     and (mr.valid_until is null or mr.valid_until > now())),
                 '{}'::text[]) as role_codes
          from identity.organisation_memberships m
          join identity.user_profiles p on p.id = m.user_id
          left join auth.users u on u.id = p.auth_user_id
         where m.organisation_id = ${organisationId}
           and m.user_id = ${userId}
         order by (m.membership_status = 'active') desc, m.joined_at desc, m.id
         limit 1`;
      if (rows.length === 0) return null;
      const r = MemberRow.parse(rows[0]);
      const member: MemberRecord = {
        membershipId: r.membership_id,
        userId: r.user_id,
        name: r.name,
        email: r.email,
        status: r.status,
        joinedAt: r.joined_at,
        leftAt: r.left_at,
        roleCodes: r.role_codes,
      };
      return member;
    },

    roleHistory: async (membershipId) => {
      const rows = await sql<
        { role_code: string; valid_from: string; valid_until: string | null }[]
      >`
        select r.code as role_code,
               to_char(mr.valid_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as valid_from,
               to_char(mr.valid_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as valid_until
          from identity.membership_roles mr
          join permissions.roles r on r.id = mr.role_id
         where mr.membership_id = ${membershipId}
         order by mr.valid_from desc, r.code
         limit 200`;
      return rows.map((row): RoleSpan => ({
        roleCode: row.role_code,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
      }));
    },

    invitationsSent: async (organisationId, userId) => {
      const rows = await sql<
        {
          id: string;
          email: string;
          role_code: string;
          status: SentInvitation["status"];
          sent_at: string;
          expires_at: string;
        }[]
      >`
        select id::text as id, email, role_code, status,
               to_char(last_sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sent_at,
               to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as expires_at
          from identity.organisation_invitations
         where organisation_id = ${organisationId}
           and invited_by_user_id = ${userId}
         order by last_sent_at desc, id
         limit 200`;
      return rows.map((row): SentInvitation => ({
        invitationId: row.id,
        email: row.email,
        roleCode: row.role_code,
        status: row.status,
        sentAt: row.sent_at,
        expiresAt: row.expires_at,
      }));
    },

    memberActivity: async (input) => {
      const rows = await sql<
        { effective_type: string; count: number; last_at: string | null }[]
      >`
        with shown as (
          select a.occurred_at, a.action_type,
                 case
                   when a.action_type = any(${[...input.qExecutedTypes]}::text[])
                    and a.metadata->>'actionType' ~ ${ACTION_FORMAT}
                   then a.metadata->>'actionType'
                   else a.action_type
                 end as effective_type
            from audit.material_actions a
           where a.organisation_id = ${input.organisationId}
             and a.tenant_id = ${input.tenantId}
             and (a.actor_id = ${input.userId} or a.authority_user_id = ${input.userId})
        ), visible as (
          select * from shown s
           where not (s.effective_type like any(${[...input.privatePatterns]}::text[]))
             and (s.action_type = any(${[...input.qExecutedTypes]}::text[])
                  or not (s.action_type like any(${[...input.privatePatterns]}::text[])))
        )
        select v.effective_type, count(*)::int as count, null::text as last_at
          from visible v
         where v.occurred_at >= ${input.since}::timestamptz
         group by v.effective_type
        union all
        select '', 0, to_char(max(v.occurred_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          from visible v`;
      let lastActiveAt: string | null = null;
      const counts: { effectiveActionType: string; count: number }[] = [];
      for (const row of rows) {
        if (row.effective_type === "") lastActiveAt = row.last_at;
        else
          counts.push({
            effectiveActionType: row.effective_type,
            count: row.count,
          });
      }
      return { lastActiveAt, counts };
    },

    relationshipsTouched: async ({ tenantId, organisationId, userId }) => {
      const rows = await sql<
        {
          relationship_id: string;
          company_id: string;
          investor_organisation_id: string;
          side: "COMPANY" | "INVESTOR";
          counterpart: string | null;
          last_at: string;
          events: number;
          notes: number;
        }[]
      >`
        with mine as (
          select r.id, r.company_id, r.investor_organisation_id,
                 case when c.organisation_id = ${organisationId} and c.tenant_id = ${tenantId}
                      then 'COMPANY' else 'INVESTOR' end as side,
                 case when c.organisation_id = ${organisationId} and c.tenant_id = ${tenantId}
                      then io.display_name else c.canonical_name end as counterpart
            from network.relationships r
            join core.companies c on c.id = r.company_id
            join core.investor_organisations io on io.id = r.investor_organisation_id
           where (c.organisation_id = ${organisationId} and c.tenant_id = ${tenantId})
              or io.organisation_id = ${organisationId}
        ), touches as (
          -- Events they acted in for this side. Never a personal_private
          -- event: what someone privately discovered stays theirs.
          select e.relationship_id, e.occurred_at as at, 1 as event, 0 as note
            from network.relationship_events e
            join mine m on m.id = e.relationship_id
           where e.actor_type = 'HUMAN'
             and e.actor_id = ${userId}
             and e.visibility_scope <> 'personal_private'
          union all
          select n.relationship_id, n.created_at, 0, 1
            from network.relationship_notes n
            join mine m on m.id = n.relationship_id
           where n.organisation_id = ${organisationId}
             and n.tenant_id = ${tenantId}
             and n.author_user_id = ${userId}
        )
        select m.id::text as relationship_id, m.company_id::text as company_id,
               m.investor_organisation_id::text as investor_organisation_id,
               m.side, m.counterpart,
               to_char(max(t.at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_at,
               sum(t.event)::int as events, sum(t.note)::int as notes
          from touches t
          join mine m on m.id = t.relationship_id
         group by m.id, m.company_id, m.investor_organisation_id, m.side, m.counterpart
         order by max(t.at) desc, m.id
         limit 100`;
      return rows.map((row): TouchedRelationship => ({
        relationshipId: row.relationship_id,
        companyId: row.company_id,
        investorOrganisationId: row.investor_organisation_id,
        side: row.side,
        counterpartName: row.counterpart,
        lastTouchedAt: row.last_at,
        events: row.events,
        notes: row.notes,
      }));
    },
  };
}
