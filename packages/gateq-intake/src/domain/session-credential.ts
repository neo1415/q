import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { SessionTokenSchema, type SessionToken } from "../contracts/index.js";

/**
 * The guest credential (CQ-GATE-002 §11).
 *
 * A public applicant has no account, and must not be given a fake one — no
 * Supabase user, no membership, no service identity. What they get instead
 * is 256 bits of randomness that names exactly one application at exactly
 * one gateway and carries no capability whatsoever.
 *
 * Only the hash is stored. A database copy of a bearer token is a database
 * copy of the ability to impersonate the person holding it, and there is no
 * feature that needs one: verification is a hash comparison, and a lost
 * credential is replaced rather than recovered.
 *
 * It is a bearer credential rather than a cookie because a gateway embedded
 * on somebody else's website is a third-party context. A product that works
 * only where third-party cookies do is already broken in Safari and will be
 * broken everywhere.
 */

/** 32 bytes, base64url, so the token is 43 characters after the prefix. */
export function issueSessionToken(): SessionToken {
  return SessionTokenSchema.parse(
    `gqs_${randomBytes(32).toString("base64url")}`,
  );
}

/** sha256, hex. The only form that is ever written down. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Compare a presented credential against a stored verifier in constant
 * time. Both sides are fixed-length hex, so the comparison leaks nothing
 * through its duration — which matters because an attacker controls one
 * side and can retry.
 */
export function sessionTokenMatches(
  presented: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashSessionToken(presented), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/**
 * The applicant's opaque handle for their own application.
 *
 * Separate from the credential on purpose: this one appears in a resume
 * link and may be written down, and it grants nothing at all. Knowing an
 * application reference lets you name an application; the session
 * credential is what lets you act on one.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function generateApplicationReference(): string {
  const bytes = randomBytes(16);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let i = 0; i < 26; i += 1) {
    out = ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return `ga_${out}`;
}

/** How long a guest may be away and still pick up where they left off. */
export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
