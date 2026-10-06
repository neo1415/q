import { z } from "zod";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import { OrganisationTypeSchema } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { TEAM_ROLE_CODES } from "../domain/team.js";
import {
  membershipCreatedEvent,
  membershipEndedEvent,
  membershipRoleChangedEvent,
} from "../events/index.js";
import type {
  InvitationRecord,
  JoinRequestRecord,
  MyOrganisationRecord,
  OwnershipOfferRecord,
  TeamJournal,
  TeamMemberRecord,
  TeamOrganisationRecord,
  TeamStore,
} from "../application/team-ports.js";

/**
 * Postgres adapters for the team use cases (G1/G2), on the privileged
 * server connection. RLS on these tables is the browser's boundary; the
 * application's is the service, which only ever passes the actor's own
 * organisation. Every statement names the organisation (and, where a row
 * is reached by its own id, filters by it too), so a guessed id from
 * another organisation is simply not found.
 */

const OrganisationRow = z.object({
  id: z.string(),
  tenant_id: z.string(),
  organisation_type: OrganisationTypeSchema,
  display_name: z.string(),
  status: z.enum(["active", "suspended", "closed"]),
});

const MemberRow = z.object({
  membership_id: z.string(),
  user_id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  title: z.string().nullable(),
  role_codes: z.array(z.string()),
  joined_at: z.string(),
});

const InvitationRow = z.object({
  id: z.string(),
  tenant_id: z.string(),
  organisation_id: z.string(),
  email: z.string(),
  role_code: z.string(),
  message: z.string().nullable(),
  status: z.enum(["pending", "accepted", "revoked"]),
  invited_by_user_id: z.string(),
  invited_by_name: z.string().nullable(),
  sent_count: z.number(),
  last_sent_at: z.coerce.date(),
  expires_at: z.coerce.date(),
  accepted_membership_id: z.string().nullable(),
});

const JoinRequestRow = z.object({
  id: z.string(),
  tenant_id: z.string(),
  organisation_id: z.string(),
  user_id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  message: z.string().nullable(),
  status: z.enum(["pending", "approved", "declined", "withdrawn"]),
  created_at: z.string(),
});

const OfferRow = z.object({
  id: z.string(),
  tenant_id: z.string(),
  organisation_id: z.string(),
  from_membership_id: z.string(),
  to_membership_id: z.string(),
  status: z.enum(["pending", "accepted", "declined", "cancelled"]),
  created_at: z.string(),
});

const MyOrganisationRow = z.object({
  organisation_id: z.string(),
  name: z.string(),
  organisation_type: OrganisationTypeSchema,
  role_codes: z.array(z.string()),
  member_count: z.coerce.number(),
  active: z.boolean(),
  company_id: z.string().nullable(),
});

const IdRow = z.object({ id: z.string() });

function toOrganisation(row: unknown): TeamOrganisationRecord {
  const r = OrganisationRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    type: r.organisation_type,
    name: r.display_name,
    status: r.status,
  };
}

function toInvitation(row: unknown): InvitationRecord {
  const r = InvitationRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organisationId: r.organisation_id,
    email: r.email,
    roleCode: r.role_code,
    message: r.message,
    status: r.status,
    invitedByUserId: r.invited_by_user_id,
    invitedByName: r.invited_by_name,
    sentCount: r.sent_count,
    lastSentAt: r.last_sent_at,
    expiresAt: r.expires_at,
    acceptedMembershipId: r.accepted_membership_id,
  };
}

function toJoinRequest(row: unknown): JoinRequestRecord {
  const r = JoinRequestRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organisationId: r.organisation_id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
  };
}

function toOffer(row: unknown): OwnershipOfferRecord {
  const r = OfferRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organisationId: r.organisation_id,
    fromMembershipId: r.from_membership_id,
    toMembershipId: r.to_membership_id,
    status: r.status,
    createdAt: r.created_at,
  };
}

export function createPostgresTeamStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): TeamStore<TransactionContext> {
  const { sql: root, transactions } = options;

  return {
    transaction: (work) => transactions.run(work),

    lockOrganisation: async (tx, organisationId) => {
      const rows = await tx.sql`
        select id, tenant_id, organisation_type, display_name, status
          from identity.organisations
         where id = ${organisationId}
         for update`;
      return rows.length === 0 ? null : toOrganisation(rows[0]);
    },

    organisation: async (tx, organisationId) => {
      const rows = await tx.sql`
        select id, tenant_id, organisation_type, display_name, status
          from identity.organisations
         where id = ${organisationId}`;
      return rows.length === 0 ? null : toOrganisation(rows[0]);
    },

    members: async (tx, organisationId) => {
      const rows = await tx.sql`
        select m.id as membership_id, m.user_id,
               coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as name,
               u.email::text as email,
               m.primary_business_title as title,
               to_char(m.joined_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as joined_at,
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
           and m.membership_status = 'active'
         order by m.joined_at, m.id
         limit 500`;
      return rows.map((row): TeamMemberRecord => {
        const r = MemberRow.parse(row);
        return {
          membershipId: r.membership_id,
          userId: r.user_id,
          name: r.name,
          email: r.email,
          title: r.title,
          roleCodes: r.role_codes,
          joinedAt: r.joined_at,
        };
      });
    },

    person: async (tx, userId) => {
      // Only a confirmed address counts: an unconfirmed sign-up must never
      // accept an invitation sent to someone else's inbox.
      const rows = await tx.sql`
        select coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as name,
               case when u.email_confirmed_at is not null then u.email::text end as email
          from identity.user_profiles p
          left join auth.users u on u.id = p.auth_user_id
         where p.id = ${userId} and p.status = 'active'`;
      const parsed = z
        .object({ name: z.string().nullable(), email: z.string().nullable() })
        .safeParse(rows[0]);
      return parsed.success ? parsed.data : { name: null, email: null };
    },

    pendingInvitations: async (tx, organisationId) => {
      const rows = await tx.sql`
        select i.id, i.tenant_id, i.organisation_id, i.email, i.role_code, i.message,
               i.status, i.invited_by_user_id, i.sent_count, i.last_sent_at, i.expires_at,
               i.accepted_membership_id,
               coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as invited_by_name
          from identity.organisation_invitations i
          join identity.user_profiles p on p.id = i.invited_by_user_id
         where i.organisation_id = ${organisationId} and i.status = 'pending'
         order by i.last_sent_at desc
         limit 200`;
      return rows.map(toInvitation);
    },

    invitation: async (tx, organisationId, invitationId) => {
      const rows = await tx.sql`
        select i.id, i.tenant_id, i.organisation_id, i.email, i.role_code, i.message,
               i.status, i.invited_by_user_id, i.sent_count, i.last_sent_at, i.expires_at,
               i.accepted_membership_id,
               coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as invited_by_name
          from identity.organisation_invitations i
          join identity.user_profiles p on p.id = i.invited_by_user_id
         where i.organisation_id = ${organisationId} and i.id = ${invitationId}
         for update of i`;
      return rows.length === 0 ? null : toInvitation(rows[0]);
    },

    invitationByTokenHash: async (tx, tokenHash) => {
      const rows = await tx.sql`
        select i.id, i.tenant_id, i.organisation_id, i.email, i.role_code, i.message,
               i.status, i.invited_by_user_id, i.sent_count, i.last_sent_at, i.expires_at,
               i.accepted_membership_id,
               coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as invited_by_name
          from identity.organisation_invitations i
          join identity.user_profiles p on p.id = i.invited_by_user_id
         where i.token_hash = ${tokenHash}
         for update of i`;
      return rows.length === 0 ? null : toInvitation(rows[0]);
    },

    insertInvitation: async (tx, input) => {
      const rows = await tx.sql`
        insert into identity.organisation_invitations
          (tenant_id, organisation_id, email, role_code, message, token_hash,
           invited_by_user_id, expires_at)
        values (${input.tenantId}, ${input.organisationId}, ${input.email},
                ${input.roleCode}, ${input.message}, ${input.tokenHash},
                ${input.invitedByUserId}, ${input.expiresAt})
        returning id`;
      return IdRow.parse(rows[0]).id;
    },

    rotateInvitation: async (tx, invitationId, input) => {
      await tx.sql`
        update identity.organisation_invitations
           set token_hash = ${input.tokenHash},
               expires_at = ${input.expiresAt},
               sent_count = least(sent_count + 1, 20),
               last_sent_at = now()
         where id = ${invitationId} and status = 'pending'`;
    },

    decideInvitation: async (tx, invitationId, input) => {
      await tx.sql`
        update identity.organisation_invitations
           set status = ${input.status},
               decided_at = now(),
               decided_by_user_id = ${input.decidedByUserId},
               accepted_membership_id = ${input.membershipId}
         where id = ${invitationId} and status = 'pending'`;
    },

    insertMembership: async (tx, input) => {
      const rows = await tx.sql`
        insert into identity.organisation_memberships
          (tenant_id, organisation_id, user_id, membership_status, joined_at, invited_by_user_id)
        values (${input.tenantId}, ${input.organisationId}, ${input.userId}, 'active', now(),
                ${input.invitedByUserId})
        returning id`;
      return IdRow.parse(rows[0]).id;
    },

    setRoles: async (tx, membershipId, roleCodes) => {
      const managed = [...TEAM_ROLE_CODES];
      const wanted = [...roleCodes];
      // End the team roles not wanted (validity ends; rows stay as history).
      await tx.sql`
        update identity.membership_roles mr
           set valid_until = now()
          from permissions.roles r
         where r.id = mr.role_id
           and mr.membership_id = ${membershipId}
           and r.code = any(${managed}::text[])
           and not (r.code = any(${wanted}::text[]))
           and mr.valid_from < now()
           and (mr.valid_until is null or mr.valid_until > now())`;
      // Assign the wanted ones not already current.
      await tx.sql`
        insert into identity.membership_roles (membership_id, role_id)
        select ${membershipId}, r.id
          from permissions.roles r
         where r.code = any(${wanted}::text[])
           and r.status = 'active'
           and not exists (
             select 1 from identity.membership_roles mr
              where mr.membership_id = ${membershipId}
                and mr.role_id = r.id
                and mr.valid_from <= now()
                and (mr.valid_until is null or mr.valid_until > now()))`;
    },

    endMembership: async (tx, membershipId, status) => {
      await tx.sql`
        update identity.organisation_memberships
           set membership_status = ${status}, left_at = now()
         where id = ${membershipId} and membership_status = 'active'`;
      await tx.sql`
        update identity.membership_roles mr
           set valid_until = now()
          from permissions.roles r
         where r.id = mr.role_id
           and mr.membership_id = ${membershipId}
           and r.code = any(${[...TEAM_ROLE_CODES]}::text[])
           and mr.valid_from < now()
           and (mr.valid_until is null or mr.valid_until > now())`;
    },

    activeContextOf: async (tx, userId) => {
      const rows = await tx.sql`
        select membership_id as id from identity.user_active_contexts where user_id = ${userId}`;
      return rows.length === 0 ? null : IdRow.parse(rows[0]).id;
    },

    setActiveContext: async (tx, userId, membershipId) => {
      await tx.sql`
        insert into identity.user_active_contexts (user_id, membership_id)
        values (${userId}, ${membershipId})
        on conflict (user_id) do update
          set membership_id = excluded.membership_id, updated_at = now()`;
    },

    anotherActiveMembership: async (tx, userId, exceptOrganisationId) => {
      const rows = await tx.sql`
        select m.id as membership_id, m.organisation_id
          from identity.organisation_memberships m
          join identity.organisations o on o.id = m.organisation_id and o.status = 'active'
         where m.user_id = ${userId}
           and m.membership_status = 'active'
           and m.organisation_id <> ${exceptOrganisationId}
         order by m.joined_at, m.id
         limit 1`;
      const parsed = z
        .object({ membership_id: z.string(), organisation_id: z.string() })
        .safeParse(rows[0]);
      return parsed.success
        ? {
            membershipId: parsed.data.membership_id,
            organisationId: parsed.data.organisation_id,
          }
        : null;
    },

    pendingJoinRequests: async (tx, organisationId) => {
      const rows = await tx.sql`
        select j.id, j.tenant_id, j.organisation_id, j.user_id, j.message, j.status,
               coalesce(nullif(btrim(p.display_name), ''),
                        nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as name,
               u.email::text as email,
               to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
          from identity.organisation_join_requests j
          join identity.user_profiles p on p.id = j.user_id
          left join auth.users u on u.id = p.auth_user_id
         where j.organisation_id = ${organisationId} and j.status = 'pending'
         order by j.created_at
         limit 100`;
      return rows.map(toJoinRequest);
    },

    joinRequest: async (tx, organisationId, requestId) => {
      const rows = await tx.sql`
        select j.id, j.tenant_id, j.organisation_id, j.user_id, j.message, j.status,
               null::text as name, null::text as email,
               to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
          from identity.organisation_join_requests j
         where j.organisation_id = ${organisationId} and j.id = ${requestId}
         for update`;
      return rows.length === 0 ? null : toJoinRequest(rows[0]);
    },

    insertJoinRequest: async (tx, input) => {
      const rows = await tx.sql`
        insert into identity.organisation_join_requests
          (tenant_id, organisation_id, user_id, message)
        values (${input.tenantId}, ${input.organisationId}, ${input.userId}, ${input.message})
        on conflict (organisation_id, user_id) where status = 'pending' do nothing
        returning id`;
      return rows.length === 0 ? null : IdRow.parse(rows[0]).id;
    },

    decideJoinRequest: async (tx, requestId, input) => {
      await tx.sql`
        update identity.organisation_join_requests
           set status = ${input.status}, decided_at = now(),
               decided_by_user_id = ${input.decidedByUserId},
               membership_id = ${input.membershipId}
         where id = ${requestId} and status = 'pending'`;
    },

    pendingOffers: async (tx, organisationId) => {
      const rows = await tx.sql`
        select id, tenant_id, organisation_id, from_membership_id, to_membership_id, status,
               to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
          from identity.organisation_ownership_offers
         where organisation_id = ${organisationId} and status = 'pending'
         order by created_at
         limit 50`;
      return rows.map(toOffer);
    },

    offer: async (tx, organisationId, offerId) => {
      const rows = await tx.sql`
        select id, tenant_id, organisation_id, from_membership_id, to_membership_id, status,
               to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
          from identity.organisation_ownership_offers
         where organisation_id = ${organisationId} and id = ${offerId}
         for update`;
      return rows.length === 0 ? null : toOffer(rows[0]);
    },

    insertOffer: async (tx, input) => {
      const rows = await tx.sql`
        insert into identity.organisation_ownership_offers
          (tenant_id, organisation_id, from_membership_id, to_membership_id)
        values (${input.tenantId}, ${input.organisationId}, ${input.fromMembershipId},
                ${input.toMembershipId})
        on conflict (organisation_id, to_membership_id) where status = 'pending'
          do update set from_membership_id = excluded.from_membership_id
        returning id`;
      return IdRow.parse(rows[0]).id;
    },

    decideOffer: async (tx, offerId, status) => {
      await tx.sql`
        update identity.organisation_ownership_offers
           set status = ${status}, decided_at = now()
         where id = ${offerId} and status = 'pending'`;
    },

    myOrganisations: async (userId) => {
      const rows = await root`
        select o.id as organisation_id, o.display_name as name, o.organisation_type,
               coalesce(
                 (select array_agg(r.code order by r.code)
                    from identity.membership_roles mr
                    join permissions.roles r on r.id = mr.role_id and r.status = 'active'
                   where mr.membership_id = m.id
                     and mr.valid_from <= now()
                     and (mr.valid_until is null or mr.valid_until > now())),
                 '{}'::text[]) as role_codes,
               (select count(*) from identity.organisation_memberships x
                 where x.organisation_id = o.id and x.membership_status = 'active') as member_count,
               exists (select 1 from identity.user_active_contexts c
                        where c.user_id = m.user_id and c.membership_id = m.id) as active,
               -- F11: the one canonical company this organisation is (an id
               -- only; the company context still authorises every read).
               (select co.id from core.companies co
                 where co.organisation_id = o.id and co.tenant_id = o.tenant_id
                 order by co.created_at limit 1) as company_id
          from identity.organisation_memberships m
          join identity.organisations o
            on o.id = m.organisation_id and o.tenant_id = m.tenant_id and o.status = 'active'
         where m.user_id = ${userId}
           and m.membership_status = 'active'
         order by m.joined_at, m.id
         limit 50`;
      return rows.map((row): MyOrganisationRecord => {
        const r = MyOrganisationRow.parse(row);
        return {
          organisationId: r.organisation_id,
          name: r.name,
          type: r.organisation_type,
          roleCodes: r.role_codes,
          memberCount: r.member_count,
          active: r.active,
          companyId: r.company_id,
        };
      });
    },
  };
}

/**
 * Audit for every team change (who, under whose authority), and a domain
 * event through the outbox when a membership begins, ends or changes role.
 * Both in the caller's transaction, so they commit with the change.
 */
export function createPostgresTeamJournal(options: {
  readonly audit: MaterialActionAuditWriter;
  readonly outbox: OutboxWriter;
}): TeamJournal<TransactionContext> {
  return {
    record: async (tx, entry) => {
      await options.audit.record(tx, {
        auditEventId: createAuditEventId(),
        tenantId: TenantIdSchema.parse(entry.tenantId),
        actorType: "HUMAN",
        actorId: UserIdSchema.parse(entry.actorUserId),
        authorityUserId: UserIdSchema.parse(entry.actorUserId),
        organisationId: OrganisationIdSchema.parse(entry.organisationId),
        actionType: AuditActionTypeSchema.parse(`team.${entry.action}`),
        resourceType: AuditResourceTypeSchema.parse(entry.resourceType),
        resourceId: entry.resourceId,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: { ...entry.metadata },
        correlationId: entry.correlationId,
      });
      const membership = entry.membership;
      if (membership === undefined) return;
      const envelope = {
        tenantId: entry.tenantId,
        organisationId: entry.organisationId,
        actorUserId: entry.actorUserId,
        correlationId: entry.correlationId,
      };
      if (membership.change === "CREATED") {
        await options.outbox.enqueue(
          tx,
          membershipCreatedEvent({
            ...envelope,
            membershipId: membership.membershipId,
            userId: membership.userId,
          }),
        );
      } else if (membership.change === "ENDED") {
        await options.outbox.enqueue(
          tx,
          membershipEndedEvent({
            ...envelope,
            membershipId: membership.membershipId,
            userId: membership.userId,
            status: membership.status ?? "left",
            handedOverToUserId: membership.handedOverToUserId ?? null,
          }),
        );
      } else {
        await options.outbox.enqueue(
          tx,
          membershipRoleChangedEvent({
            ...envelope,
            membershipId: membership.membershipId,
            userId: membership.userId,
            role: membership.role ?? "MEMBER",
          }),
        );
      }
    },
  };
}
