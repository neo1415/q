import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * Which workspace a founder's company is created in (owner directive
 * 2026-10-16: Person ≠ Organisation ≠ Membership/Role; one person may hold
 * founder and investor memberships with no crossover; an invited teammate is
 * never treated as the founder).
 *
 * F1 creates the canonical company. The person's active organisation is
 * reused for it only when that organisation is a company workspace this
 * person may found a company in:
 *
 *   - a firm's workspace (any non-company organisation type) is never
 *     reused: an investor who also raises gets their own company workspace,
 *     and nothing of the firm becomes the company's;
 *   - a company workspace that already holds a company is reused only by its
 *     owner. A teammate invited into somebody else's company (Admin or
 *     Member) who starts the founder journey is founding a different
 *     company, so they get their own workspace, and they are never recorded
 *     as a founder of the company they were invited to.
 *
 * Organisation type describes the organisation; it is used here to choose
 * where a new record belongs, never as permission. Whether the person may
 * create a company in the reused workspace is still the company service's
 * decision.
 */
export type FounderWorkspaceFacts = {
  readonly organisationType: string;
  readonly isOwner: boolean;
  readonly holdsCompany: boolean;
};

export function founderMayReuseWorkspace(
  facts: FounderWorkspaceFacts,
): boolean {
  if (facts.organisationType !== "company") return false;
  return !facts.holdsCompany || facts.isOwner;
}

/**
 * Facts about the actor's own active membership, keyed by the server-resolved
 * context (never by anything the request named). Null when the membership is
 * not active, which the caller treats as "do not reuse".
 */
export async function readFounderWorkspaceFacts(
  sql: TransactionContext["sql"],
  context: ActorContext,
): Promise<FounderWorkspaceFacts | null> {
  if (
    context.organisationId === undefined ||
    context.membershipId === undefined
  ) {
    return null;
  }
  const rows = await sql<
    {
      organisation_type: string;
      is_owner: boolean;
      holds_company: boolean;
    }[]
  >`
    select o.organisation_type,
           exists (
             select 1
               from identity.membership_roles mr
               join permissions.roles r on r.id = mr.role_id and r.status = 'active'
              where mr.membership_id = m.id
                and r.code = 'organisation_owner'
                and mr.valid_from <= now()
                and (mr.valid_until is null or mr.valid_until > now())
           ) as is_owner,
           exists (
             select 1 from core.companies c where c.organisation_id = o.id
           ) as holds_company
      from identity.organisation_memberships m
      join identity.organisations o
        on o.id = m.organisation_id and o.tenant_id = m.tenant_id
     where m.id = ${context.membershipId}::uuid
       and m.organisation_id = ${context.organisationId}::uuid
       and m.user_id = ${context.userId}::uuid
       and m.membership_status = 'active'`;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        organisationType: row.organisation_type,
        isOwner: row.is_owner,
        holdsCompany: row.holds_company,
      };
}
