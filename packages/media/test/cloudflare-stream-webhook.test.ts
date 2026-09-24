import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CLOUDFLARE_STREAM_WEBHOOK_TOLERANCE_SECONDS,
  readCloudflareStreamWebhook,
  verifyCloudflareStreamWebhookSignature,
} from "../src/index.js";

/**
 * Cloudflare Stream webhook deliveries (CQ-MEDIA-012): the signature is
 * checked over the exact bytes, in constant time, within a bounded clock
 * skew; only then is the body read, through the same normaliser the poll
 * uses. Every fixture is synthetic — no real secret, account or video.
 */

const SECRET = "synthetic-webhook-secret-not-real-0000000000";
const UID = "f1e2d3c4b5a6978877665544332211ff";
const MEDIA_ASSET_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-09-24T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);

function sign(body: string, time: number, secret = SECRET): string {
  const sig = createHmac("sha256", secret)
    .update(`${String(time)}.${body}`)
    .digest("hex");
  return `time=${String(time)},sig1=${sig}`;
}

const readyBody = JSON.stringify({
  uid: UID,
  creator: MEDIA_ASSET_ID,
  readyToStream: true,
  status: { state: "ready", pctComplete: "100.000000" },
  duration: 87.4,
  input: { width: 1080, height: 1920 },
  thumbnail: `https://customer-abc123.cloudflarestream.com/${UID}/thumbnails/thumbnail.jpg`,
  uploaded: "2026-09-24T11:58:00.000Z",
  meta: { name: "FOUNDER_PITCH synthetic" },
  playback: {
    hls: `https://customer-abc123.cloudflarestream.com/${UID}/manifest/video.m3u8`,
  },
});

const verify = (header: string | undefined, body: string, secret = SECRET) =>
  verifyCloudflareStreamWebhookSignature({
    header,
    rawBody: Buffer.from(body, "utf8"),
    secret,
    now: NOW,
  });

describe("webhook signature", () => {
  it("accepts the exact signed bytes", () => {
    expect(verify(sign(readyBody, NOW_SECONDS), readyBody)).toEqual({
      ok: true,
      signedAt: new Date(NOW_SECONDS * 1_000),
    });
  });

  it("refuses a body changed by a single byte", () => {
    const tampered = readyBody.replace('"ready"', '"error"');
    expect(verify(sign(readyBody, NOW_SECONDS), tampered)).toEqual({
      ok: false,
      reason: "MISMATCH",
    });
  });

  it("refuses the same body re-serialised, because the bytes are the contract", () => {
    const reformatted = JSON.stringify(JSON.parse(readyBody), null, 2);
    expect(verify(sign(readyBody, NOW_SECONDS), reformatted)).toMatchObject({
      ok: false,
    });
  });

  it("refuses a signature made with another secret", () => {
    const header = sign(
      readyBody,
      NOW_SECONDS,
      "another-secret-entirely-000000",
    );
    expect(verify(header, readyBody)).toEqual({
      ok: false,
      reason: "MISMATCH",
    });
  });

  it("refuses a delivery signed outside the tolerance, in either direction", () => {
    const tolerance = CLOUDFLARE_STREAM_WEBHOOK_TOLERANCE_SECONDS;
    expect(
      verify(sign(readyBody, NOW_SECONDS - tolerance - 1), readyBody),
    ).toEqual({ ok: false, reason: "STALE" });
    expect(
      verify(sign(readyBody, NOW_SECONDS + tolerance + 1), readyBody),
    ).toEqual({ ok: false, reason: "STALE" });
    expect(verify(sign(readyBody, NOW_SECONDS - tolerance), readyBody).ok).toBe(
      true,
    );
  });

  it("refuses a replay: a correct signature on an old timestamp is still stale", () => {
    const captured = sign(readyBody, NOW_SECONDS - 3_600);
    expect(verify(captured, readyBody)).toEqual({
      ok: false,
      reason: "STALE",
    });
  });

  it("refuses a missing or empty header", () => {
    expect(verify(undefined, readyBody)).toEqual({
      ok: false,
      reason: "MISSING",
    });
    expect(verify("  ", readyBody)).toEqual({ ok: false, reason: "MISSING" });
  });

  it.each([
    ["no signature", `time=${String(NOW_SECONDS)}`],
    ["no time", `sig1=${"a".repeat(64)}`],
    ["a short signature", `time=${String(NOW_SECONDS)},sig1=abcd`],
    ["a non-numeric time", `time=soon,sig1=${"a".repeat(64)}`],
    ["two times", `time=1,time=2,sig1=${"a".repeat(64)}`],
    ["a bare token", "garbage"],
  ])("refuses a malformed header: %s", (_label, header) => {
    expect(verify(header, readyBody)).toEqual({
      ok: false,
      reason: "MALFORMED",
    });
  });

  it("accepts any one valid sig1 among several, and ignores unknown schemes", () => {
    const valid = sign(readyBody, NOW_SECONDS);
    const header = `${valid},sig1=${"0".repeat(64)},sig2=whatever`;
    expect(verify(header, readyBody).ok).toBe(true);
  });

  it("verifies nothing against an empty secret", () => {
    const header = sign(readyBody, NOW_SECONDS, "");
    expect(verify(header, readyBody, "")).toEqual({
      ok: false,
      reason: "MISMATCH",
    });
  });
});

describe("webhook body", () => {
  const read = (body: unknown) =>
    readCloudflareStreamWebhook(
      Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
    );
  const video = (overrides: Record<string, unknown>) => ({
    ...(JSON.parse(readyBody) as Record<string, unknown>),
    ...overrides,
  });

  it("normalises a ready video exactly as the status poll does", () => {
    expect(read(readyBody)).toEqual({
      kind: "REPORT",
      mediaAssetId: MEDIA_ASSET_ID,
      report: {
        providerAssetId: UID,
        status: "READY",
        durationSeconds: 87,
        width: 1080,
        height: 1920,
        thumbnailReference: `${UID}/thumbnails/thumbnail.jpg`,
      },
    });
  });

  it("reads `ready` that is not yet readyToStream as still processing", () => {
    const reading = read(video({ readyToStream: false }));
    expect(reading.kind === "REPORT" && reading.report.status).toBe(
      "PROCESSING",
    );
  });

  it("reads an encoder error as PROCESSING_FAILED with the vendor code kept", () => {
    const reading = read(
      video({
        readyToStream: false,
        status: {
          state: "error",
          errorReasonCode: "ERR_DURATION_TOO_SHORT",
          errorReasonText: "The video is too short.",
        },
      }),
    );
    expect(reading).toMatchObject({
      kind: "REPORT",
      report: {
        status: "PROCESSING_FAILED",
        providerErrorCode: "ERR_DURATION_TOO_SHORT",
      },
    });
  });

  it("does not take a creator it cannot read as a reference", () => {
    const reading = read(video({ creator: "not-a-uuid" }));
    expect(reading).toMatchObject({ kind: "REPORT", mediaAssetId: undefined });
  });

  it("names a vendor state it does not know instead of guessing", () => {
    expect(read(video({ status: { state: "live-inprogress" } }))).toEqual({
      kind: "UNRECOGNISED_STATE",
      providerAssetId: UID,
      state: "live-inprogress",
    });
  });

  it.each([
    ["not JSON", "{not json"],
    ["an array", "[]"],
    ["no uid", JSON.stringify({ status: { state: "ready" } })],
    [
      "a uid with a path in it",
      JSON.stringify({ uid: "../x", status: { state: "ready" } }),
    ],
    ["no status", JSON.stringify({ uid: UID })],
  ])("refuses a body that is %s", (_label, body) => {
    expect(read(body)).toEqual({ kind: "MALFORMED" });
  });
});
