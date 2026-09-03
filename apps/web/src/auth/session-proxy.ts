import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { loadWebServerConfig } from "@capital-q/config/web";

import { sessionCookieOptions } from "./cookie-options";
import { resolveSafeReturnPath, signInPath } from "./redirect-safety";
import { classifyRoute } from "./route-policy";

/**
 * The request-level session boundary, run by `proxy.ts` before protected and
 * authentication routes render.
 *
 * Two jobs, both required by the supported Supabase SSR pattern:
 *
 *   1. refresh -- `getUser()` verifies the session with the Auth server and,
 *      when the access token has expired, rotates it; the new cookies are
 *      written onto the outgoing response so Server Components (which cannot
 *      write cookies) always see a live session;
 *   2. protect -- a signed-out visitor to a protected route is sent to
 *      sign-in with a safe return path, and a signed-in visitor to a
 *      signed-out-only route is sent on to the application.
 *
 * The proxy decides nothing about authorization: it knows "session or no
 * session", never tenant, organisation or role.
 */
export async function handleSessionProxy(
  request: NextRequest,
): Promise<NextResponse> {
  const { auth } = loadWebServerConfig();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    auth.supabase.url,
    auth.supabase.publishableKey,
    {
      cookieOptions: sessionCookieOptions(auth),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const user = data.user;

  const { pathname, search, searchParams } = request.nextUrl;
  const access = classifyRoute(pathname);

  if (access === "protected" && user === null) {
    return redirectWithSession(
      request,
      signInPath(`${pathname}${search}`),
      response,
    );
  }

  if (access === "signed-out-only" && user !== null) {
    return redirectWithSession(
      request,
      resolveSafeReturnPath(searchParams.get("next")),
      response,
    );
  }

  if (access !== "public") {
    // Session-dependent HTML is never shared-cacheable (doc 15 §9.4).
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
}

/**
 * A redirect that still carries any refreshed session cookies. Dropping them
 * here would be the classic "random sign-out" bug the SSR pattern warns about.
 */
function redirectWithSession(
  request: NextRequest,
  path: string,
  sessionResponse: NextResponse,
): NextResponse {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of sessionResponse.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  redirect.headers.set("Cache-Control", "no-store");
  return redirect;
}
