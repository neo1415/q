import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * Which workspace an investor's profile is created in (owner directive
 * 2026-10-16: one person may hold founder and investor memberships with no
 * crossover).
 *
 * I0 creates, or reuses, the canonical investor organisation of the active
 * organisation. That organisation is reused only when it is a firm's
 * workspace: not a company workspace and holding no canonical company. A
 * founder who also invests (active context: their company) gets their own
 * investing workspace, so their mandate never becomes the company's and the
 * company never appears as an investor.
 *
 * Organisation type describes the organisation; it chooses where a new
 * record belongs, never permission. A teammate invited to a firm still acts
 * in that firm, under whatever the investor service lets them do.
 */
export type InvestorWorkspaceFacts = {
  readonly organisationType: string;
  readonly holdsCompany: boolean;
};

export function investorMayReuseWorkspace(
  facts: InvestorWorkspaceFacts,
): boolean {
  return facts.organisationType !== "company" && !facts.holdsCompany;
}

/** Facts about the actor's own active membership; null when it is not active. */
export async function readInvestorWorkspaceFacts(
  sql: TransactionContext["sql"],
  context: ActorContext,
): Promise<InvestorWorkspaceFacts | null> {
  if (
    context.organisationId === undefined ||
    context.membershipId === undefined
  ) {
    return null;
  }
  const rows = await sql<
    { organisation_type: string; holds_company: boolean }[]
  >`
    select o.organisation_type,
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
        holdsCompany: row.holds_company,
      };
}
