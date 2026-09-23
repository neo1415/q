import { generateKeyPairSync, createVerify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  classifyCloudflareStatus,
  createCloudflareStreamVideoProvider,
  createUnconfiguredVideoProvider,
  MediaAssetIdSchema,
  MediaProviderError,
  MediaProviderNotConfiguredError,
  translateCloudflareState,
  type MediaStatus,
} from "../src/index.js";

/**
 * The Cloudflare Stream adapter (CQ-MEDIA-010), against an HTTP double.
 *
 * What is proven: the server's policy is what reaches the vendor, the
 * vendor's states become Capital Q's lifecycle and nothing else, failures
 * are classified rather than relayed, and the API token appears in exactly
 * one place — the Authorization header — and in no returned value, error
 * message or cause.
 */

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "cf-synthetic-api-token-not-real-00000000";
const SUBDOMAIN = "customer-abc123.cloudflarestream.com";
const MEDIA_ASSET_ID = MediaAssetIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const UID = "f1e2d3c4b5a6978877665544332211ff";
const NOW = new Date("2026-09-23T12:00:00.000Z");

type Call = {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
};

/** An HTTP double: records every call, answers from a script. */
function httpDouble(
  answer: (call: Call) => { status: number; body?: unknown } | Error,
) {
  const calls: Call[] = [];
  const doFetch: typeof fetch = (input, init) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(
        ([key, value]) => [key.toLowerCase(), value],
      ),
    );
    const call: Call = {
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const scripted = answer(call);
    if (scripted instanceof Error) {
      return Promise.reject(scripted);
    }
    return Promise.resolve(
      new Response(
        scripted.body === undefined ? null : JSON.stringify(scripted.body),
        {
          status: scripted.status,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  };
  return { calls, fetch: doFetch };
}

const envelope = (result: unknown, errors: unknown[] = []) => ({
  success: errors.length === 0,
  errors,
  messages: [],
  result,
});

function provider(
  double: ReturnType<typeof httpDouble>,
  overrides: Partial<
    Parameters<typeof createCloudflareStreamVideoProvider>[0]
  > = {},
) {
  return createCloudflareStreamVideoProvider({
    accountId: ACCOUNT,
    apiToken: TOKEN,
    customerSubdomain: SUBDOMAIN,
    fetch: double.fetch,
    now: () => NOW,
    ...overrides,
  });
}

describe("Cloudflare state translation", () => {
  it.each<[string, string | null, MediaStatus | null]>([
    ["pendingupload", null, "UPLOAD_PENDING"],
    ["downloading", null, "UPLOADING"],
    ["queued", null, "PROCESSING"],
    ["inprogress", "2026-09-23T11:00:00Z", "PROCESSING"],
    ["ready", "2026-09-23T11:00:00Z", "READY"],
    ["error", null, "UPLOAD_FAILED"],
    ["error", "2026-09-23T11:00:00Z", "PROCESSING_FAILED"],
    ["live-inprogress", null, null],
    ["something-new", null, null],
  ])("%s (uploaded=%s) becomes %s", (state, uploaded, expected) => {
    expect(translateCloudflareState({ state, uploaded })).toBe(expected);
  });

  it.each([
    [401, "AUTHENTICATION"],
    [403, "AUTHENTICATION"],
    [429, "RATE_LIMITED"],
    [400, "REJECTED"],
    [422, "REJECTED"],
    [500, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
  ])("classifies HTTP %s as %s", (status, failure) => {
    expect(classifyCloudflareStatus(status)).toBe(failure);
  });
});

describe("createUploadSession", () => {
  it("reserves a one-time direct upload on the server's terms", async () => {
    const double = httpDouble(() => ({
      status: 200,
      body: envelope({
        uploadURL: "https://upload.cloudflarestream.com/one-time",
        uid: UID,
      }),
    }));
    const session = await provider(double, {
      uploadExpirySeconds: 600,
    }).createUploadSession({
      mediaAssetId: MEDIA_ASSET_ID,
      purpose: "FOUNDER_PITCH",
      maxDurationSeconds: 180,
      requireSignedPlayback: true,
      allowedOrigin: "https://app.capitalq.example",
    });

    expect(session).toEqual({
      providerAssetId: UID,
      uploadMode: "DIRECT",
      uploadUrl: "https://upload.cloudflarestream.com/one-time",
      expiresAt: "2026-09-23T12:10:00.000Z",
    });
    const [call] = double.calls;
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/direct_upload`,
    );
    expect(call?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(call?.body).toEqual({
      maxDurationSeconds: 180,
      expiry: "2026-09-23T12:10:00.000Z",
      requireSignedURLs: true,
      allowedOrigins: ["app.capitalq.example"],
      creator: MEDIA_ASSET_ID,
      meta: { name: `FOUNDER_PITCH ${MEDIA_ASSET_ID}` },
    });
    // The token is a request header and nothing else.
    expect(JSON.stringify(session)).not.toContain(TOKEN);
  });

  it("refuses the browser's terms: the schema is the server's", async () => {
    const double = httpDouble(() => ({ status: 200, body: envelope({}) }));
    await expect(
      provider(double).createUploadSession({
        mediaAssetId: MEDIA_ASSET_ID,
        purpose: "FOUNDER_PITCH",
        maxDurationSeconds: 999_999,
        requireSignedPlayback: true,
      }),
    ).rejects.toThrow();
    expect(double.calls).toHaveLength(0);
  });

  it("classifies a refused credential without echoing anything", async () => {
    const double = httpDouble(() => ({
      status: 401,
      body: envelope(null, [{ code: 10000, message: "Authentication error" }]),
    }));
    const failure = await provider(double)
      .createUploadSession({
        mediaAssetId: MEDIA_ASSET_ID,
        purpose: "FOUNDER_PITCH",
        maxDurationSeconds: 180,
        requireSignedPlayback: true,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MediaProviderError);
    const error = failure as MediaProviderError;
    expect(error.failure).toBe("AUTHENTICATION");
    expect(error.status).toBe(401);
    expect(error.providerCode).toBe("10000");
    expect(error.provider).toBe("CLOUDFLARE_STREAM");
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain("cloudflare");
    expect(error.message).not.toContain("401");
  });

  it("treats a network failure as the provider being unavailable", async () => {
    const double = httpDouble(() => new TypeError("fetch failed"));
    const failure = await provider(double)
      .createUploadSession({
        mediaAssetId: MEDIA_ASSET_ID,
        purpose: "FOUNDER_PITCH",
        maxDurationSeconds: 180,
        requireSignedPlayback: true,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MediaProviderError);
    expect((failure as MediaProviderError).failure).toBe("UNAVAILABLE");
    expect((failure as MediaProviderError).status).toBeNull();
  });

  it("does not accept an answer that lacks the vendor's documented shape", async () => {
    const double = httpDouble(() => ({
      status: 200,
      body: envelope({ uid: UID }),
    }));
    const failure = await provider(double)
      .createUploadSession({
        mediaAssetId: MEDIA_ASSET_ID,
        purpose: "FOUNDER_PITCH",
        maxDurationSeconds: 180,
        requireSignedPlayback: true,
      })
      .catch((error: unknown) => error);
    expect((failure as MediaProviderError).failure).toBe("MALFORMED_RESPONSE");
  });
});

describe("getAsset", () => {
  const video = (overrides: Record<string, unknown>) =>
    envelope({
      uid: UID,
      status: { state: "ready", pctComplete: "100.000000" },
      readyToStream: true,
      duration: 87.4,
      input: { width: 1080, height: 1920 },
      thumbnail: `https://${SUBDOMAIN}/${UID}/thumbnails/thumbnail.jpg`,
      uploaded: "2026-09-23T11:00:00.000Z",
      requireSignedURLs: true,
      ...overrides,
    });

  it("normalises a ready video into Capital Q's lifecycle and metadata", async () => {
    const double = httpDouble(() => ({ status: 200, body: video({}) }));
    const status = await provider(double).getAsset(UID);
    expect(status).toEqual({
      providerAssetId: UID,
      status: "READY",
      durationSeconds: 87,
      width: 1080,
      height: 1920,
      thumbnailReference: `${UID}/thumbnails/thumbnail.jpg`,
    });
    expect(double.calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/${UID}`,
    );
    expect(JSON.stringify(status)).not.toContain("ready");
  });

  it("leaves unknown facts unknown rather than inventing them", async () => {
    const double = httpDouble(() => ({
      status: 200,
      body: video({
        status: { state: "inprogress" },
        readyToStream: false,
        duration: -1,
        input: { width: -1, height: -1 },
        thumbnail: "",
      }),
    }));
    expect(await provider(double).getAsset(UID)).toEqual({
      providerAssetId: UID,
      status: "PROCESSING",
    });
  });

  it("reports an encoding failure with the vendor's code kept private", async () => {
    const double = httpDouble(() => ({
      status: 200,
      body: video({
        status: {
          state: "error",
          errorReasonCode: "ERR_NON_VIDEO",
          errorReasonText: "The file is not a video.",
        },
        readyToStream: false,
      }),
    }));
    expect(await provider(double).getAsset(UID)).toEqual({
      providerAssetId: UID,
      status: "PROCESSING_FAILED",
      durationSeconds: 87,
      width: 1080,
      height: 1920,
      providerErrorCode: "ERR_NON_VIDEO",
    });
  });

  it("reports an upload that never delivered bytes as failed, not processing", async () => {
    const double = httpDouble(() => ({
      status: 200,
      body: video({
        status: { state: "error", errorReasonCode: "ERR_UNKNOWN" },
        uploaded: null,
        readyToStream: false,
      }),
    }));
    expect((await provider(double).getAsset(UID)).status).toBe("UPLOAD_FAILED");
  });

  it("reads a vendor 404 as an upload target that lapsed", async () => {
    const double = httpDouble(() => ({
      status: 404,
      body: envelope(null, [{ code: 10003, message: "not found" }]),
    }));
    expect(await provider(double).getAsset(UID)).toEqual({
      providerAssetId: UID,
      status: "EXPIRED",
      providerErrorCode: "ASSET_NOT_FOUND",
    });
  });

  it("refuses to guess a lifecycle state for a vendor state it does not know", async () => {
    const double = httpDouble(() => ({
      status: 200,
      body: video({ status: { state: "live-inprogress" } }),
    }));
    const failure = await provider(double)
      .getAsset(UID)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MediaProviderError);
    expect((failure as MediaProviderError).failure).toBe("MALFORMED_RESPONSE");
    expect((failure as MediaProviderError).providerCode).toBe(
      "live-inprogress",
    );
  });
});

describe("createPlaybackAuthorization", () => {
  const request = {
    mediaAssetId: MEDIA_ASSET_ID,
    providerAssetId: UID,
    accessMode: "AUTHORISED" as const,
    ttlSeconds: 600,
  };

  it("refuses by name when no playback host is configured", async () => {
    const double = httpDouble(() => ({ status: 200, body: envelope({}) }));
    const p = provider(double, { customerSubdomain: undefined });
    expect(p.capabilities.signedPlayback).toBe(false);
    const failure = await p
      .createPlaybackAuthorization(request)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MediaProviderNotConfiguredError);
    expect((failure as MediaProviderNotConfiguredError).missing).toEqual([
      "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
    ]);
    expect(double.calls).toHaveLength(0);
  });

  it("asks the vendor for a short-lived token when no signing key is held", async () => {
    const double = httpDouble(() => ({
      status: 200,
      body: envelope({ token: "eyJ.synthetic.token" }),
    }));
    const authorization =
      await provider(double).createPlaybackAuthorization(request);
    expect(authorization).toEqual({
      mediaAssetId: MEDIA_ASSET_ID,
      token: "eyJ.synthetic.token",
      playbackUrl: `https://${SUBDOMAIN}/eyJ.synthetic.token/manifest/video.m3u8`,
      posterUrl: `https://${SUBDOMAIN}/eyJ.synthetic.token/thumbnails/thumbnail.jpg`,
      expiresAt: "2026-09-23T12:10:00.000Z",
    });
    expect(double.calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/${UID}/token`,
    );
    expect(double.calls[0]?.body).toEqual({ exp: 1_790_165_400 });
    expect(JSON.stringify(authorization)).not.toContain(TOKEN);
  });

  it("signs locally with the held key and never calls the vendor", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const double = httpDouble(() => new Error("must not be called"));
    const p = provider(double, {
      signingKey: {
        keyId: "keyid0000000000001",
        // As Cloudflare issues it: the PEM, base64-encoded.
        pem: Buffer.from(pem).toString("base64"),
      },
    });
    const authorization = await p.createPlaybackAuthorization(request);
    expect(double.calls).toHaveLength(0);
    const token = authorization.token ?? "";
    const [header, payload, signature] = token.split(".");
    expect(
      JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
    ).toEqual({ alg: "RS256", kid: "keyid0000000000001" });
    expect(
      JSON.parse(Buffer.from(payload ?? "", "base64url").toString()),
    ).toEqual({
      sub: UID,
      kid: "keyid0000000000001",
      exp: 1_790_165_400,
      nbf: 1_790_164_800 - 60,
    });
    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature ?? "", "base64url"));
    expect(verified).toBe(true);
    expect(authorization.playbackUrl).toBe(
      `https://${SUBDOMAIN}/${token}/manifest/video.m3u8`,
    );
  });

  it("issues no token for PUBLIC media and addresses it by identifier", async () => {
    const double = httpDouble(() => new Error("must not be called"));
    const authorization = await provider(double).createPlaybackAuthorization({
      ...request,
      accessMode: "PUBLIC",
    });
    expect(authorization).toEqual({
      mediaAssetId: MEDIA_ASSET_ID,
      playbackUrl: `https://${SUBDOMAIN}/${UID}/manifest/video.m3u8`,
      posterUrl: `https://${SUBDOMAIN}/${UID}/thumbnails/thumbnail.jpg`,
      expiresAt: "2026-09-23T12:10:00.000Z",
    });
  });
});

describe("deleteAsset", () => {
  it("is idempotent: an asset the vendor no longer has is deleted", async () => {
    const double = httpDouble(() => ({ status: 404 }));
    await expect(provider(double).deleteAsset(UID)).resolves.toBeUndefined();
    expect(double.calls[0]?.method).toBe("DELETE");
  });

  it("accepts a bare 2xx and still classifies a refusal", async () => {
    const ok = httpDouble(() => ({ status: 200 }));
    await expect(provider(ok).deleteAsset(UID)).resolves.toBeUndefined();
    const limited = httpDouble(() => ({ status: 429 }));
    const failure = await provider(limited)
      .deleteAsset(UID)
      .catch((error: unknown) => error);
    expect((failure as MediaProviderError).failure).toBe("RATE_LIMITED");
  });
});

describe("the unconfigured provider", () => {
  it("refuses every call by naming what is missing, and claims nothing", async () => {
    const p = createUnconfiguredVideoProvider({
      missing: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_STREAM_API_TOKEN"],
    });
    expect(p.id).toBe("UNCONFIGURED");
    expect(p.capabilities).toEqual({
      directUpload: false,
      resumableUpload: false,
      signedPlayback: false,
      captions: false,
    });
    for (const attempt of [
      () =>
        p.createUploadSession({
          mediaAssetId: MEDIA_ASSET_ID,
          purpose: "FOUNDER_PITCH",
          maxDurationSeconds: 180,
          requireSignedPlayback: true,
        }),
      () => p.getAsset(UID),
      () =>
        p.createPlaybackAuthorization({
          mediaAssetId: MEDIA_ASSET_ID,
          providerAssetId: UID,
          accessMode: "AUTHORISED",
          ttlSeconds: 600,
        }),
      () => p.deleteAsset(UID),
    ]) {
      const failure = await attempt().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(MediaProviderNotConfiguredError);
      const error = failure as MediaProviderNotConfiguredError;
      expect(error.code).toBe("MEDIA_PROVIDER_NOT_CONFIGURED");
      expect(error.message).toContain("CLOUDFLARE_ACCOUNT_ID");
      expect(error.message).toContain("CLOUDFLARE_STREAM_API_TOKEN");
    }
  });
});

describe("construction", () => {
  it("refuses an account id or token that is not one, naming neither", () => {
    expect(() =>
      createCloudflareStreamVideoProvider({
        accountId: "not-an-account",
        apiToken: TOKEN,
      }),
    ).toThrow(/account id/);
    expect(() =>
      createCloudflareStreamVideoProvider({ accountId: ACCOUNT, apiToken: "" }),
    ).toThrow(/API token/);
  });
});
