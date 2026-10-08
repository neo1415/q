# Excerpt: packages/security/src/supabase/access-token-authenticator.ts lines 1-114

- Original path: `packages/security/src/supabase/access-token-authenticator.ts`
- Line range: 1-114
- Why included: Every protected request verifies the token with a network round trip to Supabase Auth (getUser), no cache.

```
    1  import { createClient } from "@supabase/supabase-js";
    2
    3  import { AuthUserIdSchema } from "../identity/ids.js";
    4  import type { AuthenticatedPrincipal } from "../identity/principal.js";
    5
    6  /**
    7   * Supabase-backed authentication: access token in, AuthenticatedPrincipal out.
    8   *
    9   * The token is verified by the Supabase Auth server itself (`GET /auth/v1/user`
   10   * with the token as bearer), never decoded and trusted locally. A forged,
   11   * expired, revoked or tampered token yields `null`; nothing about *why* is
   12   * surfaced, because the caller's only correct reaction is "not authenticated".
   13   *
   14   * Transport-neutral: the HTTP adapters in the deployables extract the bearer
   15   * token from a request and hand it here. Cookie-session handling for the web
   16   * app lives in the web app with @supabase/ssr; this authenticator is for
   17   * services that receive a forwarded access token.
   18   *
   19   * The client is built from the project URL and the publishable key only. A
   20   * publishable key cannot read another user, mint a session or bypass RLS, so
   21   * holding this authenticator grants nothing beyond the ability to ask "whose
   22   * session is this token?".
   23   */
   24  export type AccessTokenAuthenticator = {
   25    readonly authenticate: (
   26      accessToken: string,
   27    ) => Promise<AuthenticatedPrincipal | null>;
   28  };
   29
   30  export type SupabaseAccessTokenAuthenticatorOptions = {
   31    readonly url: string;
   32    readonly publishableKey: string;
   33    /** Injected for tests. Defaults to the global fetch. */
   34    readonly fetch?: typeof fetch | undefined;
   35  };
   36
   37  /**
   38   * Cheap shape gate before any network call. A Supabase access token is a JWT:
   39   * three base64url segments. Bounded so an oversized header cannot be relayed
   40   * to the Auth server.
   41   */
   42  const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
   43  const MAX_ACCESS_TOKEN_LENGTH = 4096;
   44
   45  export function looksLikeAccessToken(value: string): boolean {
   46    return (
   47      value.length > 0 &&
   48      value.length <= MAX_ACCESS_TOKEN_LENGTH &&
   49      ACCESS_TOKEN_PATTERN.test(value)
   50    );
   51  }
   52
   53  export function createSupabaseAccessTokenAuthenticator(
   54    options: SupabaseAccessTokenAuthenticatorOptions,
   55  ): AccessTokenAuthenticator {
   56    const client = createClient(options.url, options.publishableKey, {
   57      auth: {
   58        // This process never owns a session: it only verifies tokens handed to
   59        // it. Nothing is persisted and nothing refreshes in the background.
   60        persistSession: false,
   61        autoRefreshToken: false,
   62        detectSessionInUrl: false,
   63      },
   64      ...(options.fetch === undefined
   65        ? {}
   66        : { global: { fetch: options.fetch } }),
   67    });
   68
   69    return {
   70      authenticate: async (accessToken) => {
   71        if (!looksLikeAccessToken(accessToken)) {
   72          return null;
   73        }
   74
   75        const { data, error } = await client.auth.getUser(accessToken);
   76
   77        if (error !== null || data.user === null) {
   78          return null;
   79        }
   80
   81        const authUserId = AuthUserIdSchema.safeParse(data.user.id);
   82
   83        if (!authUserId.success) {
   84          return null;
   85        }
   86
   87        return { authUserId: authUserId.data };
   88      },
   89    };
   90  }
   91
   92  /**
   93   * Extract a bearer token from an Authorization header value, or `null`.
   94   *
   95   * Only the `Bearer` scheme is recognised (case-insensitive scheme, per RFC
   96   * 9110). Basic, cookies, custom schemes and bare tokens are not authentication.
   97   */
   98  export function extractBearerToken(
   99    authorization: string | undefined,
  100  ): string | null {
  101    if (authorization === undefined) {
  102      return null;
  103    }
  104
  105    const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(authorization);
  106
  107    if (match === null) {
  108      return null;
  109    }
  110
  111    const token = match[1] ?? "";
  112
  113    return looksLikeAccessToken(token) ? token : null;
  114  }
```
