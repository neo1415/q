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
 * Who a background build acts as (CQ-REC-006 Checkpoint C; audited in
 * CQ-REC-007R D).
 *
 * The recommendation pipeline evaluates eligibility for an actor: the
 * disclosure evaluator answers "may this principal view this company", and
 * it answers DENY for every non-human principal. A slate belongs to an
 * investor organisation, so the worker builds it as a human member of that
 * organisation. The read path re-evaluates REC-001 for the actual
 * requesting actor on every page and withholds rather than substitutes, so
 * a grant this principal holds and the reader does not is never served on.
 *
 * Nothing here is authority: the resolved context is the same shape the
 * API resolves from a session, built from the same rows.
 *
 * WHICH member, and why it is not simply the mandate's creator any more.
 * It was, and that made one person a single point of failure for their
 * whole organisation: when their membership ended `resolve` returned null,
 * the refresh handler dead-lettered the job PERMANENTLY with
 * NO_BUILD_PRINCIPAL, and that mandate's slate never rebuilt again while
 * other active members sat there able to build it. People leave
 * organisations; this was not a hypothetical. The creator is still
 * preferred, because they are the member whose view the slate has been
 * built through all along and keeping it steady avoids a pointless change
 * of contents. Failing that, the longest-standing active member is used,
 * ordered by (joined_at, id) so the same rows always give the same answer.
 *
 * What this does NOT fix, and is not the place to: a `specifically_shared`
 * grant can name a USER or a MEMBERSHIP, so one member's view can be
 * strictly wider than another's, and a slate keyed by organisation is
 * therefore assembled through one person's eyes. Nobody is over-served --
 * the read-time guard sees to that -- but the slate can hold items most of
 * the organisation will never be shown, and which member built it can
 * change what it contains. "What is an organisation's view of a shared
 * artefact" is a permissions-contract question that cannot be answered
 * inside the recommendation context, and it is owned by
 * CQ-PERM-ORG-VIEW-001, which blocks Wave 7.
 */

/** Enough to find a member; an organisation with more than this has one in here. */
const MEMBER_SCAN_LIMIT = 50;

/** Just enough of a membership to act as one. */
export type BuildMembership = {
  readonly membership: { readonly userId: string; readonly id: string };
};

/**
 * The rule, on its own so it can be stated and tested without a database.
 *
 * Prefer the creator: the slate has been built through their view all
 * along, and changing principal changes what it may contain. Otherwise the
 * first of the active members, which the query returns oldest-first, so
 * the same rows always give the same answer. Nobody active at all is the
 * one honest null.
 */
export function chooseBuildMembership<T extends BuildMembership>(
  creator: T | null,
  activeMembers: readonly T[],
): T | null {
  return creator ?? activeMembers[0] ?? null;
}

export type BuildPrincipalKey = {
  readonly tenantId: string;
  readonly investorOrganisationId: string;
  readonly mandateId: string;
};

export type BuildPrincipalResolver = {
  /**
   * Null when the mandate or its investor no longer exists, or when the
   * organisation has no active member at all -- which is the only case
   * where there is genuinely nobody to build as.
   */
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

      const organisationId = OrganisationIdSchema.parse(
        investor.organisationId,
      );
      const creator = await memberships.findActiveForUser(
        sql,
        UserIdSchema.parse(mandate.createdByUserId),
        organisationId,
      );
      const membership = chooseBuildMembership(
        creator,
        creator === null
          ? await memberships.listActiveForOrganisation(
              sql,
              organisationId,
              MEMBER_SCAN_LIMIT,
            )
          : [],
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
