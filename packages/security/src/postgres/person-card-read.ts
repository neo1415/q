import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

const Row = z.object({
  display_name: z.string().nullable(),
  given_name: z.string().nullable(),
  family_name: z.string().nullable(),
  headline: z.string().nullable(),
  country_code: z.string().nullable(),
});

/**
 * A person's own declared basics for their Q Card (owner 2026-10-22): the
 * name they go by, their one-line headline and their country. Server-side
 * and permission-neutral: the card's owner decides what shows and to whom.
 * An inactive profile, or one with no name at all, has no card.
 */
export function createPostgresPersonCardRead(options: {
  readonly sql: DatabaseExecutor;
}) {
  return {
    read: async (
      userId: string,
    ): Promise<{
      readonly displayName: string;
      readonly headline: string | null;
      readonly countryCode: string | null;
    } | null> => {
      const [raw] = await options.sql`
        select p.display_name, p.given_name, p.family_name, p.headline,
               p.country_code
          from identity.user_profiles p
         where p.id = ${userId}
           and p.status = 'active'
         limit 1`;
      if (raw === undefined) return null;
      const row = Row.parse(raw);
      const displayName =
        row.display_name?.trim() ||
        [row.given_name, row.family_name]
          .filter((part) => part !== null && part.trim() !== "")
          .join(" ")
          .trim();
      if (displayName.length === 0) return null;
      return {
        displayName: displayName.slice(0, 200),
        headline: row.headline?.trim() || null,
        countryCode: row.country_code?.trim().toUpperCase() || null,
      };
    },
  };
}
