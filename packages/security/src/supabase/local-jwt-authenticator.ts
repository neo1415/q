import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

import { AuthUserIdSchema } from "../identity/ids.js";
import type { AuthenticatedPrincipal } from "../identity/principal.js";
import {
  looksLikeAccessToken,
  type AccessTokenAuthenticator,
} from "./access-token-authenticator.js";

/**
 * SUB-SECOND Phase 4: the auth hop without a call to the Auth server.
 *
 * Before: every protected request asked Supabase Auth `GET /auth/v1/user`
 * whose token it was: a median of ~208 ms, a 2-6 s tail, before any work.
 * The hosted project signs access tokens with an asymmetric key (ES256;
 * its JWKS is public), so a token's signature, issuer, audience and expiry
 * can be checked here in well under a millisecond against the cached key.
 *
 * What a signature cannot say is whether the session still exists: a
 * logout, a password change or a ban ends the session, but its access
 * token stays signed until it expires (an hour). So the session is checked
 * in the database (`auth.sessions`, `auth.users`; one indexed lookup):
 *
 *   - fresh for every state-changing request (POST, PUT, PATCH, DELETE),
 *     so nothing that writes, proposes or approves rides a revoked session;
 *   - cached per session for at most `sessionCacheMs` (15 s) for reads.
 *
 * Membership, role and grant changes are not this module's: the actor is
 * resolved from the database on every request, and cached Q context is
 * keyed by the access fingerprints (context-cache), so those take effect
 * at once. Consequential actions re-authorize at execution regardless.
 *
 * Anything this path cannot decide falls back to the Auth server: a
 * symmetric (HS256) token, a key id the JWKS does not have, or a JWKS that
 * cannot be fetched. Failing closed on a bad signature is never a fallback.
 */

export type SessionLiveness = {
  readonly isLive: (input: {
    readonly sessionId: string;
    readonly authUserId: string;
  }) => Promise<boolean>;
};

export type LocalJwtAuthenticatorOptions = {
  /** The Supabase project URL, e.g. https://<ref>.supabase.co */
  readonly url: string;
  readonly sessions: SessionLiveness;
  /** The Auth-server path, for what cannot be verified here. */
  readonly fallback: AccessTokenAuthenticator;
  /** Injected for tests; defaults to the project's JWKS, cached. */
  readonly keys?: JWTVerifyGetKey | undefined;
  readonly sessionCacheMs?: number | undefined;
  readonly now?: (() => number) | undefined;
};

export type FreshnessAwareAuthenticator = AccessTokenAuthenticator & {
  /** As `authenticate`, choosing whether a cached session check may serve. */
  readonly authenticateWith: (
    accessToken: string,
    options: { readonly freshSession: boolean },
  ) => Promise<AuthenticatedPrincipal | null>;
};

const ASYMMETRIC = ["ES256", "RS256", "EdDSA"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_CACHE_MAX = 5_000;

export function createLocalJwtAccessTokenAuthenticator(
  options: LocalJwtAuthenticatorOptions,
): FreshnessAwareAuthenticator {
  const base = options.url.replace(/\/+$/, "");
  const issuer = `${base}/auth/v1`;
  const keys =
    options.keys ??
    createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      // A rotated key is picked up on the first token that names it.
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
      timeoutDuration: 3_000,
    });
  const ttl = options.sessionCacheMs ?? 15_000;
  const now = options.now ?? Date.now;
  const liveUntil = new Map<string, number>();

  async function sessionLive(
    sessionId: string,
    authUserId: string,
    fresh: boolean,
  ): Promise<boolean> {
    const key = `${sessionId}:${authUserId}`;
    const cached = liveUntil.get(key);
    if (!fresh && cached !== undefined && cached > now()) return true;
    const live = await options.sessions.isLive({ sessionId, authUserId });
    if (live) {
      if (liveUntil.size >= SESSION_CACHE_MAX) liveUntil.clear();
      liveUntil.set(key, now() + ttl);
    } else {
      liveUntil.delete(key);
    }
    return live;
  }

  async function authenticateWith(
    accessToken: string,
    { freshSession }: { readonly freshSession: boolean },
  ): Promise<AuthenticatedPrincipal | null> {
    if (!looksLikeAccessToken(accessToken)) return null;
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(accessToken).alg;
    } catch {
      return null;
    }
    if (alg === undefined || !ASYMMETRIC.includes(alg)) {
      // A symmetric token (a local stack, a legacy project): only the
      // Auth server holds the secret.
      return options.fallback.authenticate(accessToken);
    }
    let claims: Record<string, unknown>;
    try {
      const verified = await jwtVerify(accessToken, keys, {
        issuer,
        audience: "authenticated",
        algorithms: ASYMMETRIC,
        clockTolerance: 5,
      });
      claims = verified.payload;
    } catch (error: unknown) {
      if (
        error instanceof joseErrors.JWKSNoMatchingKey ||
        error instanceof joseErrors.JWKSTimeout ||
        error instanceof joseErrors.JWKSInvalid ||
        (error instanceof Error && error.name === "TypeError")
      ) {
        // We could not get the key, not "the token is bad": ask Auth.
        return options.fallback.authenticate(accessToken);
      }
      return null; // bad signature, wrong issuer or audience, expired
    }
    const authUserId = AuthUserIdSchema.safeParse(claims["sub"]);
    const sessionId = claims["session_id"];
    if (
      !authUserId.success ||
      typeof sessionId !== "string" ||
      !UUID.test(sessionId) ||
      claims["role"] !== "authenticated"
    ) {
      return null;
    }
    const live = await sessionLive(sessionId, authUserId.data, freshSession);
    return live ? { authUserId: authUserId.data } : null;
  }

  return {
    authenticate: (accessToken) =>
      authenticateWith(accessToken, { freshSession: true }),
    authenticateWith,
  };
}
