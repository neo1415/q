# Excerpt: apps/web/src/auth/session.ts lines 1-80

- Original path: `apps/web/src/auth/session.ts`
- Line range: 1-80
- Why included: Web server side: cookie session via @supabase/ssr; getClaims locally for identity, getSession access token forwarded as bearer to api/q-api.

```
    1  import "server-only";
    2
    3  import { redirect } from "next/navigation";
    4  import { cache } from "react";
    5
    6  import { signInPath } from "./redirect-safety";
    7  import { createServerSupabaseClient } from "./supabase-server";
    8
    9  /**
   10   * "Who is signed in?" for the web application. One answer, server-rendered.
   11   *
   12   * The identity comes from `auth.getClaims()`, which verifies the session's
   13   * signature against the project's published signing keys (ES256) and falls
   14   * back to the Auth server where it cannot; it is never read from an
   15   * unverified cookie, a client store or a request parameter. What comes back is authentication
   16   * only: an auth subject and the provider's verified email. Organisation,
   17   * tenant and membership are the API's to resolve (`GET /v1/me`).
   18   */
   19  export type SessionUser = {
   20    readonly authUserId: string;
   21    readonly email: string | null;
   22  };
   23
   24  /** Memoised per request so a layout and its page share one verification. */
   25  export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
   26    const supabase = await createServerSupabaseClient();
   27    // The token verified locally (getClaims), as in the proxy: the same
   28    // identity without a second Auth-server round trip per page.
   29    const { data, error } = await supabase.auth.getClaims();
   30    const sub = data?.claims.sub;
   31    if (error !== null || typeof sub !== "string") {
   32      return null;
   33    }
   34    const email = data?.claims.email;
   35    return { authUserId: sub, email: typeof email === "string" ? email : null };
   36  });
   37
   38  /**
   39   * Require a session or redirect to sign-in. The centralised layout guard:
   40   * pages never write their own `if (!user) redirect(...)`.
   41   */
   42  export async function requireSessionUser(
   43    returnTo?: string,
   44  ): Promise<SessionUser> {
   45    const user = await getSessionUser();
   46
   47    if (user === null) {
   48      redirect(signInPath(returnTo));
   49    }
   50
   51    return user;
   52  }
   53
   54  /**
   55   * The current access token, for forwarding to the Capital Q API over a
   56   * server-to-server call. Never rendered, never sent to the browser, never
   57   * stored anywhere but the HttpOnly session cookie it came from.
   58   */
   59  export async function getSessionAccessToken(): Promise<string | null> {
   60    const supabase = await createServerSupabaseClient();
   61    const { data } = await supabase.auth.getSession();
   62    return data.session?.access_token ?? null;
   63  }
```

# Excerpt: apps/web/proxy.ts lines 1-49

- Original path: `apps/web/proxy.ts`
- Line range: 1-49
- Why included: Next.js 16 proxy (middleware) matcher: session refresh and route protection.

```
    1  import type { NextRequest } from "next/server";
    2
    3  import { handleSessionProxy } from "./src/auth/session-proxy";
    4
    5  /**
    6   * Next.js request proxy: session refresh and route protection, and nothing
    7   * else. The policy lives in src/auth/route-policy.ts; the matcher below is
    8   * the same list, written out literally because Next reads it statically.
    9   */
   10  export function proxy(request: NextRequest) {
   11    return handleSessionProxy(request);
   12  }
   13
   14  export const config = {
   15    matcher: [
   16      // Exactly the root: who sees the landing (src/auth/landing-route.ts).
   17      "/",
   18      "/home/:path*",
   19      "/welcome/:path*",
   20      "/discover/:path*",
   21      "/capital/:path*",
   22      "/company/:path*",
   23      "/pitch/:path*",
   24      "/investors/:path*",
   25      "/find/:path*",
   26      "/search/:path*",
   27      "/explore/:path*",
   28      "/verification/:path*",
   29      "/profile/:path*",
   30      "/onboarding/:path*",
   31      "/relationships/:path*",
   32      "/settings/:path*",
   33      // G1/G2: an invitation's link.
   34      "/join/:path*",
   35      // AUTO (ADR 0030): Q's work.
   36      "/work/:path*",
   37      // DAILY: The Q Daily reader.
   38      "/daily/:path*",
   39      "/gateway/:path*",
   40      "/gateq/:path*",
   41      "/rehearsals/:path*",
   42      "/results/:path*",
   43      "/reviews/:path*",
   44      "/documents/:path*",
   45      "/admin/:path*",
   46      "/paused/:path*",
   47      "/auth/:path*",
   48    ],
   49  };
```
