import { z } from "zod";

/**
 * Constrained audit metadata: small, flat, structured references.
 *
 * Allowed: an object of scalars (string, number, boolean, null) or short
 * arrays of scalars. Bounded keys, key syntax, string length, array length
 * and serialized size. Nothing nested: an audit record points at things
 * (ids, hashes, modes); it never carries the things themselves.
 *
 * Keys that name credentials, prompts, documents or raw traffic are
 * rejected outright rather than silently stripped -- a domain that tries to
 * audit a token has a design problem, not a formatting problem, and the
 * failure must be visible. Pass references and hashes instead.
 */

export const AUDIT_METADATA_MAX_BYTES = 8_192;
export const AUDIT_METADATA_MAX_KEYS = 32;
export const AUDIT_METADATA_MAX_STRING = 512;
export const AUDIT_METADATA_MAX_ARRAY = 32;

/**
 * Any key whose normalised form (lowercase, alphanumerics only) contains one
 * of these terms is refused. Broad on purpose: `promptId` is refused too;
 * name the reference `runId` or `actionId` instead.
 */
export const FORBIDDEN_METADATA_TERMS = [
  "password",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "privatekey",
  "signedurl",
  "documentbody",
  "documenttext",
  "prompt",
  "rawrequest",
  "rawresponse",
  "filecontents",
] as const;

export function isForbiddenMetadataKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return FORBIDDEN_METADATA_TERMS.some((term) => normalised.includes(term));
}

const ScalarSchema = z.union([
  z.string().max(AUDIT_METADATA_MAX_STRING),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const ValueSchema = z.union([
  ScalarSchema,
  z.array(ScalarSchema).max(AUDIT_METADATA_MAX_ARRAY),
]);

const KeySchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
    "expected an identifier-like metadata key",
  );

export const AuditMetadataSchema = z
  .record(KeySchema, ValueSchema)
  .superRefine((value, context) => {
    const keys = Object.keys(value);
    if (keys.length > AUDIT_METADATA_MAX_KEYS) {
      context.addIssue({
        code: "custom",
        message: `at most ${String(AUDIT_METADATA_MAX_KEYS)} metadata keys`,
      });
    }
    for (const key of keys) {
      if (isForbiddenMetadataKey(key)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message:
            "metadata key names sensitive content; pass a reference or hash instead",
        });
      }
    }
    if (
      Buffer.byteLength(JSON.stringify(value), "utf8") >
      AUDIT_METADATA_MAX_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: `metadata exceeds ${String(AUDIT_METADATA_MAX_BYTES)} bytes when serialized`,
      });
    }
  });

export type AuditMetadata = z.infer<typeof AuditMetadataSchema>;
