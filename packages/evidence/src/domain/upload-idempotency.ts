import { createHash } from "node:crypto";

/**
 * Durable idempotency for upload-session creation. The key is namespaced to
 * this command so a key reused across commands cannot collide, and the
 * request fingerprint is canonical, so a replay with different content is a
 * conflict rather than a second session over a second storage object.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashDocumentUploadIdempotencyKey(key: string): string {
  return sha256Hex(`evidence.document_upload_session.create:${key}`);
}

/** Primitives only: a fingerprint never carries an object it cannot compare. */
export type UploadRequestFingerprint = Readonly<
  Record<string, string | number | boolean | undefined>
>;

export function hashCreateDocumentUploadSessionRequest(
  input: UploadRequestFingerprint,
): string {
  const canonical: Record<string, string> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (value !== undefined) {
      canonical[key] = String(value);
    }
  }
  return sha256Hex(JSON.stringify(canonical));
}
