import type { GateqPassReason } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

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
    link: async (input: {
      readonly applicationId: string;
      readonly tenantId: string;
      readonly actor: ActorContext;
    }): Promise<void> => {
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
