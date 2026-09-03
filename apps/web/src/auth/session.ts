import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { signInPath } from "./redirect-safety";
import { createServerSupabaseClient } from "./supabase-server";

/**
 * "Who is signed in?" for the web application. One answer, server-rendered.
 *
 * The identity comes from `auth.getUser()`, which sends the session to the
 * Auth server for verification; it is never read from a decoded cookie, a
 * client store or a request parameter. What comes back is authentication
 * only: an auth subject and the provider's verified email. Organisation,
 * tenant and membership are the API's to resolve (`GET /v1/me`).
 */
export type SessionUser = {
  readonly authUserId: string;
  readonly email: string | null;
};

/** Memoised per request so a layout and its page share one verification. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error !== null || data.user === null) {
    return null;
  }

  return { authUserId: data.user.id, email: data.user.email ?? null };
});

/**
 * Require a session or redirect to sign-in. The centralised layout guard:
 * pages never write their own `if (!user) redirect(...)`.
 */
export async function requireSessionUser(
  returnTo?: string,
): Promise<SessionUser> {
  const user = await getSessionUser();

  if (user === null) {
    redirect(signInPath(returnTo));
  }

  return user;
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
