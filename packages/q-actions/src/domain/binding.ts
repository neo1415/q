import { createHash } from "node:crypto";

import {
  canonicalJsonStringify,
  Q_ACTION_BINDING_VERSION,
  QActionBindingEnvelopeSchema,
  QActionPayloadHashSchema,
  type QActionBindingEnvelope,
  type QActionPayloadHash,
} from "@capital-q/contracts";

/**
 * Exact-payload binding (doc 12 §31.2; doc 22 §81; CQ-Q-008 §23-§30).
 *
 * An approval authorises THIS action with THIS material payload for THESE
 * targets under THIS context — nothing similar, nothing later rewritten.
 * The envelope names every field whose change alters the consequence:
 * tenant, organisation context, run, action identity, action type and
 * version, risk class, targets and the payload itself. It omits every
 * volatile field (timestamps, request ids, summaries) so the same
 * consequence always yields the same fingerprint.
 *
 * SHA-256 over the canonical JSON text (sorted keys, no undefined, arrays
 * in order), rendered as `sha256:<hex>`. The hash is an integrity check
 * against the authoritative approval record — never authorisation on its
 * own, and never accepted from a client or a model.
 */

export function bindingEnvelope(
  input: QActionBindingEnvelope,
): QActionBindingEnvelope {
  return QActionBindingEnvelopeSchema.parse({
    ...input,
    bindingVersion: Q_ACTION_BINDING_VERSION,
  });
}

export function hashBindingEnvelope(
  envelope: QActionBindingEnvelope,
): QActionPayloadHash {
  const parsed = QActionBindingEnvelopeSchema.parse(envelope);
  const digest = createHash("sha256")
    .update(canonicalJsonStringify(parsed), "utf8")
    .digest("hex");
  return QActionPayloadHashSchema.parse(`sha256:${digest}`);
}

/** Constant-time comparison of two fingerprints; length differences are a mismatch, not a leak. */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
