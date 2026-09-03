import type { NextRequest } from "next/server";

import { handleSessionProxy } from "./src/auth/session-proxy";

/**
 * Next.js request proxy: session refresh and route protection, and nothing
 * else. The policy lives in src/auth/route-policy.ts; the matcher below is
 * the same list, written out literally because Next reads it statically.
 */
export function proxy(request: NextRequest) {
  return handleSessionProxy(request);
}

export const config = {
  matcher: [
    "/home/:path*",
    "/discover/:path*",
    "/capital/:path*",
    "/profile/:path*",
    "/onboarding/:path*",
    "/auth/:path*",
  ],
};
