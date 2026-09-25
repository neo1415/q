import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import { UserIdSchema, type UserId } from "../identity/ids.js";
import {
  effectivePersonChanges,
  PersonProfileNotFoundError,
  PersonProfileVersionConflictError,
  type PersonProfile,
  type PersonProfileStore,
} from "../identity/person-profile.js";

/**
 * `identity.user_profiles` as the person's own editable profile (BIZ-002).
 *
 * The write is one conditional UPDATE on (id, version, active): it applies
 * only to the version the caller read, and increments it. Nothing is held
 * open between the read and the write, so a concurrent edit makes this one
 * miss the row rather than overwrite it; the miss is then classified as an
 * idempotent replay (the requested values already hold) or a conflict.
 */

const TimestampSchema = z
  .union([z.date(), z.string()])
  .transform((value) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );

const RowSchema = z.object({
  id: UserIdSchema,
  display_name: z.string().nullable(),
  headline: z.string().nullable(),
  version: z.number().int().min(1),
  updated_at: TimestampSchema,
});

function toProfile(row: unknown): PersonProfile {
  const parsed = RowSchema.parse(row);
  return {
    userId: parsed.id,
    displayName: parsed.display_name,
    headline: parsed.headline,
    version: parsed.version,
    updatedAt: parsed.updated_at,
  };
}

export function createPostgresPersonProfileStore(options: {
  readonly sql: DatabaseExecutor;
}): PersonProfileStore {
  const { sql } = options;

  const read = async (userId: UserId): Promise<PersonProfile | null> => {
    const [row] = await sql`
      select p.id, p.display_name, p.headline, p.version, p.updated_at
        from identity.user_profiles p
       where p.id = ${userId}
         and p.status = 'active'
       limit 1`;
    return row === undefined ? null : toProfile(row);
  };

  return {
    read,
    update: async ({ userId, expectedVersion, changes }) => {
      const current = await read(userId);
      if (current === null) {
        throw new PersonProfileNotFoundError();
      }
      const effective = effectivePersonChanges(current, changes);
      // Nothing to change: either nothing differs at all, or this is a
      // replay of a change that already landed. Either way the requested
      // state holds and no version is spent on it.
      if (Object.keys(effective).length === 0) {
        return current;
      }
      if (current.version !== expectedVersion) {
        throw new PersonProfileVersionConflictError(current.version);
      }
      const setName = effective.displayName !== undefined;
      const setHeadline = effective.headline !== undefined;
      const [row] = await sql`
        update identity.user_profiles
           set display_name = case when ${setName}::boolean
                                   then ${effective.displayName ?? null}::text
                                   else display_name end,
               headline = case when ${setHeadline}::boolean
                               then ${effective.headline ?? null}::text
                               else headline end,
               version = version + 1,
               updated_at = now()
         where id = ${userId}
           and version = ${expectedVersion}
           and status = 'active'
        returning id, display_name, headline, version, updated_at`;
      if (row !== undefined) {
        return toProfile(row);
      }
      // Lost a race between the read and the write: classify again
      // against what is there now.
      const after = await read(userId);
      if (after === null) {
        throw new PersonProfileNotFoundError();
      }
      if (Object.keys(effectivePersonChanges(after, changes)).length === 0) {
        return after;
      }
      throw new PersonProfileVersionConflictError(after.version);
    },
  };
}
