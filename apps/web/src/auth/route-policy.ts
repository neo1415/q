/**
 * Which web routes require a session, which are only for signed-out visitors,
 * and which are public. One list, consulted by the request proxy; the route
 * group layouts re-check the session server-side as defence in depth.
 *
 * Public by omission: the auth surface, the PWA manifest and service worker,
 * static assets, the developer gallery and any future public Q Card. Nothing
 * auth-locks the whole application.
 */

export const PROTECTED_PATH_PREFIXES = [
  "/home",
  "/discover",
  "/capital",
  "/profile",
  "/onboarding",
  // Setting a new password needs the recovery session the callback created.
  "/auth/update-password",
] as const;

export const SIGNED_OUT_ONLY_PATHS = [
  "/auth/sign-in",
  "/auth/sign-up",
  "/auth/forgot-password",
] as const;

export type RouteAccess = "protected" | "signed-out-only" | "public";

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function classifyRoute(pathname: string): RouteAccess {
  if (PROTECTED_PATH_PREFIXES.some((prefix) => matches(pathname, prefix))) {
    return "protected";
  }
  if (SIGNED_OUT_ONLY_PATHS.some((path) => matches(pathname, path))) {
    return "signed-out-only";
  }
  return "public";
}
