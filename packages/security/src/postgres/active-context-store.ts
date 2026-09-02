import { z } from "zod";

import type { TransactionManager } from "@capital-q/database";

import {
  MembershipIdSchema,
  type MembershipId,
  type OrganisationId,
  type UserId,
} from "../identity/ids.js";

/**
 * Persists a person's chosen default organisation context.
 *
 * The selection names either the organisation or the membership; either way
 * the row that gets stored is a membership, and only after the database has
 * confirmed that it belongs to this person and is active. The composite
 * foreign key on user_active_contexts backs the same rule at the schema.
 *
 * Server-side only. No HTTP route exposes this yet; the owning application
 * packet will, and it will pass a resolved UserId, never a client-supplied one.
 */

export type ActiveOrganisationContextSelection = {
  readonly userId: UserId;
} & (
  | { readonly organisationId: OrganisationId }
  | { readonly membershipId: MembershipId }
);

export type ActiveOrganisationContextResult =
  | {
      readonly status: "ACTIVE_CONTEXT_SET";
      readonly membershipId: MembershipId;
    }
  | { readonly status: "MEMBERSHIP_NOT_ACCESSIBLE" };

export type ActiveOrganisationContextStore = {
  readonly setActiveContext: (
    selection: ActiveOrganisationContextSelection,
  ) => Promise<ActiveOrganisationContextResult>;
};

export type PostgresActiveOrganisationContextStoreOptions = {
  readonly transactions: TransactionManager;
};

const MembershipIdRowSchema = z.object({ id: MembershipIdSchema });

export function createPostgresActiveOrganisationContextStore(
  options: PostgresActiveOrganisationContextStoreOptions,
): ActiveOrganisationContextStore {
  const { transactions } = options;

  return {
    setActiveContext: (selection) =>
      // Validation and upsert share one transaction so a revocation cannot
      // slip in between the check and the write. `for share` holds the
      // membership row against concurrent status changes until commit.
      transactions.run(async (tx) => {
        const rows =
          "membershipId" in selection
            ? await tx.sql`
                select m.id
                  from identity.organisation_memberships m
                 where m.id = ${selection.membershipId}
                   and m.user_id = ${selection.userId}
                   and m.membership_status = 'active'
                 for share`
            : await tx.sql`
                select m.id
                  from identity.organisation_memberships m
                 where m.organisation_id = ${selection.organisationId}
                   and m.user_id = ${selection.userId}
                   and m.membership_status = 'active'
                 for share`;

        const membership = MembershipIdRowSchema.safeParse(rows[0]);
        if (rows.length === 0 || !membership.success) {
          // Not found, another person's, revoked, or in a different tenant:
          // one answer for all of them.
          return { status: "MEMBERSHIP_NOT_ACCESSIBLE" };
        }

        await tx.sql`
          insert into identity.user_active_contexts (user_id, membership_id)
          values (${selection.userId}, ${membership.data.id})
          on conflict (user_id) do update
            set membership_id = excluded.membership_id,
                updated_at = now()`;

        return {
          status: "ACTIVE_CONTEXT_SET",
          membershipId: membership.data.id,
        };
      }),
  };
}
