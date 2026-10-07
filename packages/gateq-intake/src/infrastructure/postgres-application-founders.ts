import type { GateqPassReason } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

/**
 * F2: a signed-in founder's own GateQ applications. Linked when they press
 * Send; read back for their GateQ page. What they see of the investor's
 * side is only what was sent to them: a reply, or a pass with its reason.
 * Never the firm's notes, labels, stars, assignee or whether it was opened.
 */
export type FounderApplication = {
  readonly applicationId: string;
  readonly fund: string;
  readonly gatewayName: string;
  readonly sentAt: string;
  readonly status: "SENT" | "REPLIED" | "PASSED";
  readonly reasonCode: GateqPassReason | null;
  readonly message: string | null;
};

export function createPostgresApplicationFounders(options: {
  readonly sql: DatabaseExecutor;
}) {
  const { sql } = options;
  return {
    /**
     * Links the founder; returns the canonical pair the application names
     * (their company and the gateway's investor organisation), or null
     * when they have no company. Network ensures the relationship.
     */
    link: async (input: {
      readonly applicationId: string;
      readonly tenantId: string;
      readonly actor: ActorContext;
    }): Promise<{
      readonly companyId: string;
      readonly investorOrganisationId: string;
    } | null> => {
      // Their own company, when they act for one; an application is never
      // turned into a company record here.
      const companies = await sql<{ id: string }[]>`
        select id from core.companies
         where organisation_id = ${input.actor.organisationId ?? null}::uuid
           and tenant_id = ${input.actor.tenantId}
         order by created_at
         limit 1`;
      await sql`
        insert into gateq.application_founders (application_id, tenant_id, founder_user_id, company_id)
        values (${input.applicationId}, ${input.tenantId}, ${input.actor.userId}, ${companies[0]?.id ?? null})
        on conflict (application_id) do nothing`;
      const pairs = await sql<
        { company_id: string; investor_organisation_id: string }[]
      >`
        select f.company_id, g.investor_organisation_id
          from gateq.application_founders f
          join gateq.applications a on a.id = f.application_id
          join gateq.gateways g on g.id = a.gateway_id
         where f.application_id = ${input.applicationId}
           and f.founder_user_id = ${input.actor.userId}
           and f.company_id is not null`;
      const pair = pairs[0];
      return pair === undefined
        ? null
        : {
            companyId: pair.company_id,
            investorOrganisationId: pair.investor_organisation_id,
          };
    },

    /** P14: the canonical relationship the application joined. */
    setRelationship: async (input: {
      readonly applicationId: string;
      readonly relationshipId: string;
    }): Promise<void> => {
      await sql`
        update gateq.application_founders
           set relationship_id = ${input.relationshipId}
         where application_id = ${input.applicationId}
           and relationship_id is null`;
    },

    /**
     * F27 repair: this founder's applications that name a company but never
     * joined a relationship (the share 500'd before the fix).
     */
    unlinkedFor: async (
      actor: ActorContext,
    ): Promise<
      readonly { readonly applicationId: string; readonly tenantId: string }[]
    > => {
      const rows = await sql<{ application_id: string; tenant_id: string }[]>`
        select application_id, tenant_id from gateq.application_founders
         where founder_user_id = ${actor.userId}
           and company_id is not null
           and relationship_id is null
         limit 20`;
      return rows.map((row) => ({
        applicationId: row.application_id,
        tenantId: row.tenant_id,
      }));
    },

    /**
     * F27 backfill: every unlinked application, with the founder's own
     * context rebuilt exactly as a request resolves it (their active
     * membership in the organisation that owns the company). No active
     * membership: skipped, never acting for someone who no longer belongs.
     */
    unlinked: async (
      limit: number,
    ): Promise<
      readonly {
        readonly applicationId: string;
        readonly tenantId: string;
        readonly actor: ActorContext;
      }[]
    > => {
      const rows = await sql<
        {
          application_id: string;
          tenant_id: string;
          user_id: string;
          membership_id: string;
          member_tenant_id: string;
          organisation_id: string;
        }[]
      >`
        select f.application_id, f.tenant_id, f.founder_user_id as user_id,
               m.id as membership_id, m.tenant_id as member_tenant_id,
               m.organisation_id
          from gateq.application_founders f
          join core.companies c on c.id = f.company_id
          join identity.organisation_memberships m
            on m.user_id = f.founder_user_id
           and m.organisation_id = c.organisation_id
           and m.membership_status = 'active'
         where f.relationship_id is null
         order by f.application_id
         limit ${limit}`;
      return rows.flatMap((row) => {
        const actor = ActorContextSchema.safeParse({
          userId: row.user_id,
          tenantId: row.member_tenant_id,
          organisationId: row.organisation_id,
          membershipId: row.membership_id,
          actorType: "HUMAN",
        });
        return actor.success
          ? [
              {
                applicationId: row.application_id,
                tenantId: row.tenant_id,
                actor: actor.data,
              },
            ]
          : [];
      });
    },

    listFor: async (
      actor: ActorContext,
    ): Promise<readonly FounderApplication[]> => {
      const rows = await sql<
        {
          application_id: string;
          fund: string | null;
          gateway_name: string;
          sent_at: Date;
          kind: "PASS" | "REPLY" | null;
          reason_code: GateqPassReason | null;
          body: string | null;
        }[]
      >`
        select f.application_id, io.display_name as fund, g.name as gateway_name,
               s.submitted_at as sent_at, m.kind, m.reason_code, m.body
          from gateq.application_founders f
          join gateq.applications a on a.id = f.application_id
          join gateq.application_submissions s on s.application_id = a.id
          join gateq.gateways g on g.id = a.gateway_id
          left join core.investor_organisations io on io.id = g.investor_organisation_id
          left join lateral (
            select kind, reason_code, body from gateq.inbox_messages im
             where im.application_id = a.id
             order by (im.kind = 'PASS') desc, im.created_at desc
             limit 1
          ) m on true
         where f.founder_user_id = ${actor.userId}
         order by s.submitted_at desc
         limit 100`;
      return rows.map((row) => ({
        applicationId: row.application_id,
        fund: row.fund ?? row.gateway_name,
        gatewayName: row.gateway_name,
        sentAt: new Date(row.sent_at).toISOString(),
        status:
          row.kind === "PASS"
            ? "PASSED"
            : row.kind === "REPLY"
              ? "REPLIED"
              : "SENT",
        reasonCode: row.reason_code,
        message: row.body,
      }));
    },
  };
}

export type ApplicationFounders = ReturnType<
  typeof createPostgresApplicationFounders
>;
