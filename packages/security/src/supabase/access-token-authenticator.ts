import { createClient } from "@supabase/supabase-js";

import { AuthUserIdSchema } from "../identity/ids.js";
import type { AuthenticatedPrincipal } from "../identity/principal.js";

/**
 * Supabase-backed authentication: access token in, AuthenticatedPrincipal out.
 *
 * The token is verified by the Supabase Auth server itself (`GET /auth/v1/user`
 * with the token as bearer), never decoded and trusted locally. A forged,
 * expired, revoked or tampered token yields `null`; nothing about *why* is
 * surfaced, because the caller's only correct reaction is "not authenticated".
 *
 * Transport-neutral: the HTTP adapters in the deployables extract the bearer
 * token from a request and hand it here. Cookie-session handling for the web
 * app lives in the web app with @supabase/ssr; this authenticator is for
 * services that receive a forwarded access token.
 *
 * The client is built from the project URL and the publishable key only. A
 * publishable key cannot read another user, mint a session or bypass RLS, so
 * holding this authenticator grants nothing beyond the ability to ask "whose
 * session is this token?".
 */
export type AccessTokenAuthenticator = {
  readonly authenticate: (
    accessToken: string,
  ) => Promise<AuthenticatedPrincipal | null>;
};

export type SupabaseAccessTokenAuthenticatorOptions = {
  readonly url: string;
  readonly publishableKey: string;
  /** Injected for tests. Defaults to the global fetch. */
  readonly fetch?: typeof fetch | undefined;
};

/**
 * Cheap shape gate before any network call. A Supabase access token is a JWT:
 * three base64url segments. Bounded so an oversized header cannot be relayed
 * to the Auth server.
 */
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_ACCESS_TOKEN_LENGTH = 4096;

export function looksLikeAccessToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ACCESS_TOKEN_LENGTH &&
    ACCESS_TOKEN_PATTERN.test(value)
  );
}

export function createSupabaseAccessTokenAuthenticator(
  options: SupabaseAccessTokenAuthenticatorOptions,
): AccessTokenAuthenticator {
  const client = createClient(options.url, options.publishableKey, {
    auth: {
      // This process never owns a session: it only verifies tokens handed to
      // it. Nothing is persisted and nothing refreshes in the background.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(options.fetch === undefined
      ? {}
      : { global: { fetch: options.fetch } }),
  });

  return {
    authenticate: async (accessToken) => {
      if (!looksLikeAccessToken(accessToken)) {
        return null;
      }

      const { data, error } = await client.auth.getUser(accessToken);

      if (error !== null || data.user === null) {
        return null;
      }

      const authUserId = AuthUserIdSchema.safeParse(data.user.id);

      if (!authUserId.success) {
        return null;
      }

      return { authUserId: authUserId.data };
    },
  };
}

/**
 * Extract a bearer token from an Authorization header value, or `null`.
 *
 * Only the `Bearer` scheme is recognised (case-insensitive scheme, per RFC
 * 9110). Basic, cookies, custom schemes and bare tokens are not authentication.
 */
export function extractBearerToken(
  authorization: string | undefined,
): string | null {
  if (authorization === undefined) {
    return null;
  }

  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(authorization);

  if (match === null) {
    return null;
  }

  const token = match[1] ?? "";

  return looksLikeAccessToken(token) ? token : null;
}
