/**
 * Return-destination safety for the sign-in flow.
 *
 * A `next` parameter is attacker-influenced input: it arrives in a link the
 * user was sent. The only destinations Capital Q will ever send someone to
 * after authentication are its own relative paths. Anything else -- an
 * absolute URL, a protocol-relative URL, a scheme, a backslash trick, an
 * encoded separator -- falls back to Home. Silently, because there is nothing
 * useful to tell the user about it.
 */

export const DEFAULT_RETURN_PATH = "/home";

const MAX_LENGTH = 2048;

// Whitespace, control characters, backslashes and `@` never appear in a
// path Capital Q generates; a browser may treat `\` as `/` and `\t` as
// nothing, and `@` is how userinfo smuggles a host into a URL.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
const FORBIDDEN_CHARACTERS = /[\s\u0000-\u001f\u007f\\@]/;

// Encoded slashes, backslashes, NUL and line breaks: rejected outright rather
// than decoded, so double-encoding cannot smuggle a separator past the check.
const FORBIDDEN_ENCODINGS = /%(2f|5c|00|0a|0d)/i;

// A sentinel origin that cannot be reached: if resolving the candidate against
// it yields any other origin, the candidate was not relative.
const SENTINEL_ORIGIN = "https://capital-q.invalid";

export function resolveSafeReturnPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) {
    return DEFAULT_RETURN_PATH;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_RETURN_PATH;
  }
  if (FORBIDDEN_CHARACTERS.test(raw) || FORBIDDEN_ENCODINGS.test(raw)) {
    return DEFAULT_RETURN_PATH;
  }

  let url: URL;
  try {
    url = new URL(raw, SENTINEL_ORIGIN);
  } catch {
    return DEFAULT_RETURN_PATH;
  }

  if (
    url.origin !== SENTINEL_ORIGIN ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return DEFAULT_RETURN_PATH;
  }

  // Never bounce back into the authentication surface itself.
  if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) {
    return DEFAULT_RETURN_PATH;
  }

  const path = `${url.pathname}${url.search}`;

  if (!path.startsWith("/") || path.startsWith("//")) {
    return DEFAULT_RETURN_PATH;
  }

  return path;
}

/** The sign-in URL that returns to `returnTo` afterwards, when it is safe. */
export function signInPath(returnTo?: string): string {
  const safe = resolveSafeReturnPath(returnTo);
  return safe === DEFAULT_RETURN_PATH
    ? "/auth/sign-in"
    : `/auth/sign-in?next=${encodeURIComponent(safe)}`;
}
