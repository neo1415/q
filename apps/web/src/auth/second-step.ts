import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveSafeReturnPath } from "./redirect-safety";

/**
 * Two-step verification at the web boundary.
 *
 * A person who has turned on an authenticator app has not finished signing
 * in until they enter its code: password, emailed link, Google and recovery
 * all end at assurance level `aal1`, and only the second step raises the
 * session to `aal2`. Until then the web app treats them as not signed in
 * for every application route (the proxy and the layout guard both ask
 * here), and the API and q-api refuse their token on their own
 * (@capital-q/security), so skipping this page reaches nothing.
 *
 * "Does this person have a verified factor?" is answered by the Auth
 * server (`GET /auth/v1/user`, with their own token), never by the session
 * cookie's copy of the user, which the browser holds and could edit. The
 * answer is cached per user for a minute in this process so an ordinary
 * navigation does not wait on the Auth server; turning the factor on or off
 * here forgets the entry at once. The level reached is the access token's
 * signed `aal` claim, which getClaims has already verified.
 */

export const SECOND_STEP_PATH = "/auth/two-step";

const LOOKUP_TTL_MS = 60_000;
const LOOKUP_MAX = 5_000;
const lookups = new Map<
  string,
  { readonly verified: boolean; readonly until: number }
>();

/** The pure rule: a verified factor and anything short of aal2. */
export function requiresSecondStep(input: {
  readonly aal: unknown;
  readonly hasVerifiedFactor: boolean;
}): boolean {
  return input.hasVerifiedFactor && input.aal !== "aal2";
}

/**
 * Whether the signed-in user has a verified second factor, from the Auth
 * server; `null` when it could not be asked (never cached).
 */
export async function hasVerifiedFactor(
  supabase: Pick<SupabaseClient, "auth">,
  authUserId: string,
  now: () => number = Date.now,
): Promise<boolean | null> {
  const cached = lookups.get(authUserId);
  if (cached !== undefined && cached.until > now()) return cached.verified;
  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user.id !== authUserId) return null;
  const verified = (data.user.factors ?? []).some(
    (factor) => factor.status === "verified",
  );
  if (lookups.size >= LOOKUP_MAX) lookups.clear();
  lookups.set(authUserId, { verified, until: now() + LOOKUP_TTL_MS });
  return verified;
}

/**
 * Whether this verified session still owes its second step. An aal2 token
 * needs no lookup. When the Auth server cannot be asked, the answer is
 * "yes": the two-step page asks again and lets an un-enrolled person
 * straight through, so a blip costs one extra page, never a skipped step.
 */
export async function secondStepRequired(
  supabase: Pick<SupabaseClient, "auth">,
  claims: { readonly sub: string; readonly aal?: unknown },
): Promise<boolean> {
  if (claims.aal === "aal2") return false;
  const verified = await hasVerifiedFactor(supabase, claims.sub);
  return verified === null
    ? true
    : requiresSecondStep({ aal: claims.aal, hasVerifiedFactor: verified });
}

/** After turning a factor on or off: the next request asks afresh. */
export function forgetFactorLookup(authUserId: string): void {
  lookups.delete(authUserId);
}

/**
 * Where the second step may return to: any safe in-app path, plus the one
 * auth page a recovery link leads to (choosing a new password), which the
 * general allow-list refuses because it never returns into /auth.
 */
export function resolveSecondStepReturn(raw: unknown): string {
  return raw === "/auth/update-password"
    ? "/auth/update-password"
    : resolveSafeReturnPath(raw);
}

export function secondStepPath(next?: string): string {
  const safe = resolveSecondStepReturn(next);
  return `${SECOND_STEP_PATH}?next=${encodeURIComponent(safe)}`;
}
