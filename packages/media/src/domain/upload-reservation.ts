import { createHash } from "node:crypto";

import { DEFAULT_PITCH_DURATION_POLICY } from "../contracts/index.js";

/**
 * The terms of a resumable pitch upload (CQ-MEDIA-011; doc 20 §11, §13).
 */

/**
 * Bytes per second of pitch video no real recording exceeds (a 4K phone
 * clip runs near 6 MB/s). Times the hard maximum duration it bounds what a
 * founder may reserve, so nobody holds a multi-gigabyte target open against
 * Capital Q's provider account. The duration reservation remains the rule
 * the provider enforces; this is the server's own ceiling on the length.
 */
const MAX_PITCH_BYTES_PER_SECOND = 8 * 1024 * 1024;

export const MAX_PITCH_UPLOAD_BYTES =
  DEFAULT_PITCH_DURATION_POLICY.hardMaxSeconds * MAX_PITCH_BYTES_PER_SECOND;

/**
 * The digest that binds a resumable reservation to the request that made
 * it: which asset, how many bytes, and the client's idempotency key. Only
 * this digest leaves the server (it rides on the provider's asset record);
 * the key itself is never stored or forwarded. A retry with the same key
 * and the same length produces the same digest; the same key with a
 * different file does not, and is refused like any second reservation.
 */
export function uploadReservationKey(input: {
  readonly mediaAssetId: string;
  readonly uploadLengthBytes: number;
  readonly idempotencyKey: string;
}): string {
  return createHash("sha256")
    .update(
      `media.upload_session:${input.mediaAssetId}:${String(input.uploadLengthBytes)}:${input.idempotencyKey}`,
      "utf8",
    )
    .digest("hex");
}
