import type { DatabaseExecutor } from "@capital-q/database";
import {
  createPostgresInvestorMandateRepository,
  createPostgresInvestorOrganisationQueryPort,
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
} from "@capital-q/investors";
import { createPostgresMembershipRepository } from "@capital-q/organisations";
import {
  ActorContextSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

/**
 * Who a background build acts as (CQ-REC-006 Checkpoint C).
 *
 * The recommendation pipeline evaluates eligibility for an actor: the
 * disclosure evaluator answers "may this principal view this company", and
 * it answers DENY for every non-human principal. A slate belongs to an
 * investor organisation, so the worker builds it as a human member of that
 * organisation — the mandate's creator, provided they still hold an active
 * membership. That member's view is the organisation's view for
 * organisation-scoped grants; the read path re-checks every page for the
 * actual requesting actor, so a person-specific grant is never over-served.
 *
 * Nothing here is authority: the resolved context is the same shape the
 * API resolves from a session, built from the same rows.
 */

export type BuildPrincipalKey = {
  readonly tenantId: string;
  readonly investorOrganisationId: string;
  readonly mandateId: string;
};

export type BuildPrincipalResolver = {
  /** Null when the mandate, its investor or the creator's membership no longer exists. */
  readonly resolve: (key: BuildPrincipalKey) => Promise<ActorContext | null>;
};

export function createPostgresBuildPrincipalResolver(options: {
  readonly sql: DatabaseExecutor;
}): BuildPrincipalResolver {
  const { sql } = options;
  const investors = createPostgresInvestorOrganisationQueryPort({ sql });
  const mandates = createPostgresInvestorMandateRepository();
  const memberships = createPostgresMembershipRepository();
  return {
    resolve: async (key) => {
      // Queue-borne identifiers: validated here, at the boundary.
      const tenantId = TenantIdSchema.parse(key.tenantId);
      const investorOrganisationId = InvestorOrganisationIdSchema.parse(
        key.investorOrganisationId,
      );
      const investor = await investors.getCanonicalInvestorOrganisation(
        tenantId,
        investorOrganisationId,
      );
      if (investor === null) return null;
      const mandate = await mandates.findById(
        sql,
        tenantId,
        investorOrganisationId,
        InvestorMandateIdSchema.parse(key.mandateId),
      );
      if (mandate === null) return null;
      const membership = await memberships.findActiveForUser(
        sql,
        UserIdSchema.parse(mandate.createdByUserId),
        OrganisationIdSchema.parse(investor.organisationId),
      );
      if (membership === null) return null;
      return ActorContextSchema.parse({
        userId: membership.membership.userId,
        tenantId: key.tenantId,
        organisationId: investor.organisationId,
        membershipId: membership.membership.id,
        actorType: "HUMAN",
      });
    },
  };
}
