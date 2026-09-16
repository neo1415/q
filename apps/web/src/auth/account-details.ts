import "server-only";

import { z } from "zod";

import { createServerSupabaseClient } from "./supabase-server";

/**
 * What somebody told us about themselves when they created the account.
 *
 * It lives on the account rather than in Capital Q because it is the only
 * thing that survives a confirmation email and a return trip: a profile
 * row exists by then, but the trigger that made it reads nothing a person
 * supplied, which is the right rule and not one to weaken. So the name and
 * the organisation wait here until the first authenticated page can copy
 * them where they belong, through the ordinary API, under the person's own
 * session.
 *
 * Treated as what it is: text a person typed. It is validated, bounded and
 * used to greet somebody and to look them up. It is never authority for
 * anything.
 */

const Details = z.object({
  display_name: z.string().trim().min(1).max(80).optional().catch(undefined),
  organisation_name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .catch(undefined),
});

export type AccountDetails = {
  readonly displayName: string | null;
  readonly organisationName: string | null;
};

const NOTHING: AccountDetails = { displayName: null, organisationName: null };

export async function accountDetails(): Promise<AccountDetails> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    if (error !== null || data.user === null) {
      return NOTHING;
    }
    const parsed = Details.safeParse(data.user.user_metadata ?? {});
    if (!parsed.success) {
      return NOTHING;
    }
    return {
      displayName: parsed.data.display_name ?? null,
      organisationName: parsed.data.organisation_name ?? null,
    };
  } catch {
    // Somebody whose details we cannot read is somebody we greet without
    // them. It is never a reason to fail the page.
    return NOTHING;
  }
}
