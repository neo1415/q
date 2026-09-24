import { createHmac, timingSafeEqual } from "node:crypto";

import { MediaAssetIdSchema, type MediaAssetId } from "../contracts/index.js";
import type { VideoAssetStatus } from "../contracts/provider.js";
import {
  CloudflareVideoSchema,
  normalizeCloudflareVideo,
} from "./cloudflare-stream-video-provider.js";

/**
 * Cloudflare Stream webhook deliveries (CQ-MEDIA-012; doc 20 §16–§17,
 * doc 22 §129–§135).
 *
 * A delivery is untrusted bytes until its signature says otherwise.
 * Cloudflare signs `${time}.${rawBody}` with HMAC-SHA256 under the secret
 * it returned when the webhook was registered, and sends
 *
 *     Webhook-Signature: time=<unix seconds>,sig1=<hex>
 *
 * The signature is checked over the exact bytes received — never over a
 * re-serialised parse — with a constant-time comparison, and a timestamp
 * outside the tolerance is refused so a captured delivery cannot be
 * replayed later. Only a verified body is parsed, and it is translated by
 * the same normaliser the status poll uses: the webhook adds a way to learn
 * what the provider says, not a second meaning for it.
 */

export const CLOUDFLARE_STREAM_WEBHOOK_SIGNATURE_HEADER =
  "webhook-signature" as const;

/** Five minutes either way: generous for clock skew, short for a replay. */
export const CLOUDFLARE_STREAM_WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookSignatureRefusal =
  "MISSING" | "MALFORMED" | "STALE" | "MISMATCH";

export type WebhookSignatureVerdict =
  | { readonly ok: true; readonly signedAt: Date }
  | { readonly ok: false; readonly reason: WebhookSignatureRefusal };

const TIME = /^[0-9]{1,12}$/;
const SIG1 = /^[0-9a-f]{64}$/i;

/**
 * Whether these exact bytes were signed by the holder of `secret`, recently.
 *
 * The refusal reason is for the server's log; a caller is told only that
 * the delivery was not accepted.
 */
export function verifyCloudflareStreamWebhookSignature(input: {
  readonly header: string | readonly string[] | undefined;
  readonly rawBody: Uint8Array;
  readonly secret: string;
  readonly now?: Date | undefined;
  readonly toleranceSeconds?: number | undefined;
}): WebhookSignatureVerdict {
  const header =
    typeof input.header === "string" ? input.header : input.header?.[0];
  if (header === undefined || header.trim().length === 0) {
    return { ok: false, reason: "MISSING" };
  }
  if (input.secret.length === 0) {
    // Nothing verifies against an empty key; refusing here keeps a
    // misconfiguration from becoming "anything goes".
    return { ok: false, reason: "MISMATCH" };
  }

  let time: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      return { ok: false, reason: "MALFORMED" };
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "time") {
      if (time !== undefined || !TIME.test(value)) {
        return { ok: false, reason: "MALFORMED" };
      }
      time = value;
    } else if (key === "sig1") {
      if (!SIG1.test(value)) {
        return { ok: false, reason: "MALFORMED" };
      }
      signatures.push(value.toLowerCase());
    }
    // Unknown keys are ignored: a future scheme alongside sig1 must not
    // break verification of the one this code understands.
  }
  if (time === undefined || signatures.length === 0) {
    return { ok: false, reason: "MALFORMED" };
  }

  const signedAtSeconds = Number(time);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const tolerance =
    input.toleranceSeconds ?? CLOUDFLARE_STREAM_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - signedAtSeconds) > tolerance) {
    return { ok: false, reason: "STALE" };
  }

  const expected = createHmac("sha256", input.secret)
    .update(`${time}.`)
    .update(input.rawBody)
    .digest();
  // Every candidate is compared, whether or not an earlier one matched, so
  // the time taken says nothing about which one was close.
  let matched = false;
  for (const signature of signatures) {
    const candidate = Buffer.from(signature, "hex");
    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    ) {
      matched = true;
    }
  }
  return matched
    ? { ok: true, signedAt: new Date(signedAtSeconds * 1_000) }
    : { ok: false, reason: "MISMATCH" };
}

export type CloudflareStreamWebhookReading =
  /** A delivery about one asset, in Capital Q's lifecycle vocabulary. */
  | {
      readonly kind: "REPORT";
      readonly report: VideoAssetStatus;
      /**
       * The creator reference Capital Q set at upload, when the vendor
       * echoed a well-formed one. A cross-check, never a lookup key.
       */
      readonly mediaAssetId: MediaAssetId | undefined;
    }
  /** Well-formed, but in a vendor state this adapter does not know. */
  | {
      readonly kind: "UNRECOGNISED_STATE";
      readonly providerAssetId: string;
      readonly state: string;
    }
  /** Not JSON, or not a Stream video. */
  | { readonly kind: "MALFORMED" };

/**
 * Reads a VERIFIED delivery body. Call only after the signature check: an
 * unverified body is not something to parse, let alone act on.
 */
export function readCloudflareStreamWebhook(
  rawBody: Uint8Array,
): CloudflareStreamWebhookReading {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    return { kind: "MALFORMED" };
  }
  const video = CloudflareVideoSchema.safeParse(payload);
  if (!video.success) {
    return { kind: "MALFORMED" };
  }
  let report: VideoAssetStatus | null;
  try {
    report = normalizeCloudflareVideo(video.data);
  } catch {
    // A value outside Capital Q's own bounds: not a video this record holds.
    return { kind: "MALFORMED" };
  }
  if (report === null) {
    return {
      kind: "UNRECOGNISED_STATE",
      providerAssetId: video.data.uid,
      state: video.data.status.state,
    };
  }
  const creator = MediaAssetIdSchema.safeParse(video.data.creator);
  return {
    kind: "REPORT",
    report,
    mediaAssetId: creator.success ? creator.data : undefined,
  };
}
