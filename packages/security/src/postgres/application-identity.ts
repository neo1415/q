import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import { UserIdSchema, type UserId } from "../identity/ids.js";
import type { AuthenticatedPrincipal } from "../identity/principal.js";

/**
 * AuthUserId -> the canonical Person, independent of any organisation.
 *
 * This is the one place the application answers "which Capital Q person is
 * this authenticated identity?" without also asking "which organisation are
 * they acting for?". A newly registered founder with no membership has a
 * valid answer here and CONTEXT_REQUIRED from the ActorContextResolver; both
 * are correct at once, and neither is an authentication failure.
 *
 * The display name is read from the profile the auth trigger created. Email
 * is deliberately absent: the identity provider owns credentials and contact
 * identity, so callers that need an email take it from the verified provider
 * user, not from this table.
 */
export type ApplicationIdentity = {
  readonly userId: UserId;
  readonly displayName: string | null;
};

export type ApplicationIdentityLookup = {
  readonly lookup: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ApplicationIdentity | null>;
};

const RowSchema = z.object({
  id: UserIdSchema,
  display_name: z.string().nullable(),
});

export function createPostgresApplicationIdentityLookup(options: {
  readonly sql: DatabaseExecutor;
}): ApplicationIdentityLookup {
  const { sql } = options;

  return {
    lookup: async (principal) => {
      const rows = await sql`
        select p.id, p.display_name
          from identity.user_profiles p
         where p.auth_user_id = ${principal.authUserId}
           and p.status = 'active'
         limit 1`;

      if (rows.length === 0) {
        return null;
      }

      const parsed = RowSchema.safeParse(rows[0]);

      if (!parsed.success) {
        // A malformed profile row is a server integrity problem, not a
        // reason to hand back a partially trusted identity.
        return null;
      }

      return {
        userId: parsed.data.id,
        displayName: parsed.data.display_name,
      };
    },
  };
}
