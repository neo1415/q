import type { WebAuthConfig } from "@capital-q/config/web";

/**
 * Session cookie attributes (doc 15 §9.2).
 *
 * HttpOnly is on: every authentication call in Capital Q runs on the server
 * (server actions, route handlers, the request proxy), so no browser script
 * ever needs to read the session, and script injection cannot exfiltrate it.
 * SameSite=Lax is what lets an emailed callback link land with the PKCE
 * verifier cookie present while still blocking cross-site POSTs. Secure is on
 * everywhere except the plain-http local stack.
 */
export function sessionCookieOptions(auth: WebAuthConfig): {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: auth.secureCookies,
    path: "/",
  };
}
