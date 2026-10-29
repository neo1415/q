import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { signInPath } from "./redirect-safety";
import {
  hasVerifiedFactor,
  secondStepPath,
  secondStepRequired,
} from "./second-step";
import { createServerSupabaseClient } from "./supabase-server";

/**
 * "Who is signed in?" for the web application. One answer, server-rendered.
 *
 * The identity comes from `auth.getClaims()`, which verifies the session's
 * signature against the project's published signing keys (ES256) and falls
 * back to the Auth server where it cannot; it is never read from an
 * unverified cookie, a client store or a request parameter. What comes back is authentication
 * only: an auth subject and the provider's verified email. Organisation,
 * tenant and membership are the API's to resolve (`GET /v1/me`).
 */
export type SessionUser = {
  readonly authUserId: string;
  readonly email: string | null;
};

type SessionRead = {
  readonly user: SessionUser;
  /** Passed the first step, owes the authenticator code (second-step.ts). */
  readonly owesSecondStep: boolean;
};

/** Memoised per request so a layout and its page share one verification. */
const readSession = cache(async (): Promise<SessionRead | null> => {
  const supabase = await createServerSupabaseClient();
  // The token verified locally (getClaims), as in the proxy: the same
  // identity without a second Auth-server round trip per page.
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims.sub;
  if (error !== null || typeof sub !== "string") {
    return null;
  }
  const email = data?.claims.email;
  return {
    user: { authUserId: sub, email: typeof email === "string" ? email : null },
    owesSecondStep: await secondStepRequired(supabase, {
      sub,
      aal: data?.claims.aal,
    }),
  };
});

/**
 * The signed-in person, or `null`. A session that still owes its two-step
 * code is `null` here: it is not signed in for anything the app renders.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await readSession();
  return session === null || session.owesSecondStep ? null : session.user;
});

/** The person on the two-step page: first step passed, code still owed. */
export async function getSecondStepUser(): Promise<SessionUser | null> {
  const session = await readSession();
  return session !== null && session.owesSecondStep ? session.user : null;
}

/**
 * Whether the signed-in person has two-step verification on (Settings),
 * from the Auth server (cached as in second-step.ts); `null` if unknown.
 */
export async function twoStepEnabled(): Promise<boolean | null> {
  const user = await getSessionUser();
  if (user === null) return null;
  return hasVerifiedFactor(await createServerSupabaseClient(), user.authUserId);
}

/**
 * Require a session or redirect to sign-in (or to the two-step page, for a
 * session that owes its code). The centralised layout guard: pages never
 * write their own `if (!user) redirect(...)`.
 */
export async function requireSessionUser(
  returnTo?: string,
): Promise<SessionUser> {
  const session = await readSession();

  if (session === null) {
    redirect(signInPath(returnTo));
  }
  if (session.owesSecondStep) {
    redirect(secondStepPath(returnTo));
  }

  return session.user;
}

/**
 * The current access token, for forwarding to the Capital Q API over a
 * server-to-server call. Never rendered, never sent to the browser, never
 * stored anywhere but the HttpOnly session cookie it came from.
 */
export async function getSessionAccessToken(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
