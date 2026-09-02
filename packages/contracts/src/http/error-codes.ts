import { z } from "zod";

/**
 * Capital Q's stable machine-readable error vocabulary (doc 22, 21).
 *
 * Clients branch on these codes. They never parse prose: titles and details are
 * human-facing text that may be reworded at any time, while a code is a
 * contract.
 *
 * The first twelve are the product vocabulary defined by the API architecture.
 * INVALID_REQUEST and INTERNAL_SERVER_ERROR are added as the two transport-level
 * codes needed to describe every generic HTTP failure -- they are infrastructure
 * concepts, not new business ones.
 *
 * Codes carry no dynamic content. RESOURCE_NOT_FOUND, never
 * COMPANY_abc123_NOT_FOUND: a code that varies per occurrence cannot be
 * branched on and leaks identifiers into the vocabulary.
 */
export const CAPITAL_Q_ERROR_CODES = [
  "VALIDATION_FAILED",
  "AUTHENTICATION_REQUIRED",
  "PERMISSION_DENIED",
  "RESOURCE_NOT_FOUND",
  "RESOURCE_CONFLICT",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "Q_APPROVAL_REQUIRED",
  "Q_ACTION_EXPIRED",
  "PROVIDER_UNAVAILABLE",
  "UPLOAD_NOT_READY",
  "INVALID_REQUEST",
  "INTERNAL_SERVER_ERROR",
] as const;

export type KnownErrorCode = (typeof CAPITAL_Q_ERROR_CODES)[number];

/**
 * Producer schema. A Capital Q server emits only codes it actually defines, so
 * a typo cannot escape as a new public vocabulary word.
 */
export const KnownErrorCodeSchema = z.enum(CAPITAL_Q_ERROR_CODES);

/**
 * Consumer schema. Deliberately looser than the producer schema.
 *
 * The API evolves additively: a newer server may return a code an older client
 * has never heard of. Rejecting the whole response for that reason would turn a
 * routine deployment into a client outage, so the consumer validates the code's
 * shape rather than its membership. Bounded length because an error code is a
 * short token, not a payload.
 */
export const ErrorCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "expected an UPPER_SNAKE_CASE error code")
  .max(64, "error code is longer than any code this API issues");

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

const KNOWN_CODES: ReadonlySet<string> = new Set(CAPITAL_Q_ERROR_CODES);

/**
 * Narrow a received code to the vocabulary this build knows.
 *
 * Lets a client branch on familiar codes while still rendering an unfamiliar
 * one safely, rather than treating "unknown" as "invalid".
 */
export function isKnownErrorCode(code: string): code is KnownErrorCode {
  return KNOWN_CODES.has(code);
}
