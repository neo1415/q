import { createSign } from "node:crypto";

import { z } from "zod";

import { ProviderAssetIdSchema, type MediaStatus } from "../contracts/index.js";
import {
  CreateVideoUploadSessionSchema,
  PlaybackAuthorizationRequestSchema,
  VideoAssetStatusSchema,
  VideoUploadSessionSchema,
  type CreateVideoUploadSession,
  type PlaybackAuthorization,
  type PlaybackAuthorizationRequest,
  type VideoAssetStatus,
  type VideoProvider,
  type VideoUploadSession,
} from "../contracts/provider.js";
import {
  MediaProviderError,
  MediaProviderNotConfiguredError,
  type MediaProviderFailure,
} from "../domain/errors.js";

/**
 * Cloudflare Stream behind the `VideoProvider` port (CQ-MEDIA-010; doc 20
 * §5, §9–§13, §21, §31–§33).
 *
 * This is the only file in the product that knows Cloudflare's vocabulary.
 * Its status strings, error reason codes, envelope shape and URL layout are
 * read here and translated into Capital Q's own lifecycle before anything
 * leaves; nothing downstream can tell which vendor answered.
 *
 * Three things are settled by the server and never by a browser: the
 * creator reference, the duration reservation and the expiry of an upload
 * target, and whether playback must be signed. The API token is revealed
 * once, at construction, and appears in exactly one place — the
 * `Authorization` header of a request to the vendor. It is never part of a
 * returned value, an error message or a thrown cause.
 *
 * Resumable (tus) creator uploads are deliberately not claimed. Cloudflare
 * requires the byte length up front for that mode and the port does not
 * carry it, so the adapter reports `resumableUpload: false` rather than
 * promising a mode it cannot open.
 */

export const CLOUDFLARE_STREAM_PROVIDER_ID = "CLOUDFLARE_STREAM" as const;

const DEFAULT_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 15_000;
/** Cloudflare bounds a direct-upload expiry to two minutes … six hours. */
const UPLOAD_EXPIRY_MIN_SECONDS = 120;
const UPLOAD_EXPIRY_MAX_SECONDS = 6 * 3_600;
const DEFAULT_UPLOAD_EXPIRY_SECONDS = 30 * 60;
/** Tolerance for clock skew between this server and the vendor's edge. */
const NOT_BEFORE_SKEW_SECONDS = 60;

export type CloudflareStreamSigningKey = {
  /** The key id Cloudflare issued with the signing key. */
  readonly keyId: string;
  /** The RSA private key: PEM text, or the base64-encoded PEM as issued. */
  readonly pem: string;
};

export type CloudflareStreamVideoProviderOptions = {
  readonly accountId: string;
  /** A Bearer API token with Stream read/write. Revealed once, here. */
  readonly apiToken: string;
  /**
   * `customer-<code>.cloudflarestream.com`. Without it no playback URL can
   * be formed and playback authorization refuses, by name.
   */
  readonly customerSubdomain?: string | undefined;
  /**
   * When present, playback tokens are signed locally; when absent they are
   * requested from the vendor's token endpoint under the API token. Either
   * way the token is short-lived and issued per viewer.
   */
  readonly signingKey?: CloudflareStreamSigningKey | undefined;
  readonly uploadExpirySeconds?: number | undefined;
  readonly apiBaseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** Test seam. */
  readonly fetch?: typeof fetch | undefined;
  readonly now?: (() => Date) | undefined;
};

const OptionsSchema = z
  .object({
    accountId: z.string().regex(/^[0-9a-f]{32}$/, "expected an account id"),
    apiToken: z.string().min(16, "expected an API token"),
    customerSubdomain: z
      .string()
      .regex(
        /^customer-[a-z0-9]+\.cloudflarestream\.com$/,
        "expected a customer subdomain",
      )
      .optional(),
    signingKey: z
      .object({
        keyId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "expected a key id"),
        pem: z.string().min(64, "expected a private key"),
      })
      .strict()
      .optional(),
    uploadExpirySeconds: z
      .number()
      .int()
      .min(UPLOAD_EXPIRY_MIN_SECONDS)
      .max(UPLOAD_EXPIRY_MAX_SECONDS)
      .default(DEFAULT_UPLOAD_EXPIRY_SECONDS),
    apiBaseUrl: z.string().url().default(DEFAULT_API_BASE_URL),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(DEFAULT_TIMEOUT_MS),
  })
  .strict();

// ---------------------------------------------------------------------------
// The vendor's shapes. Parsed leniently — unknown keys are dropped — and
// never re-exported: they stop at this file.
// ---------------------------------------------------------------------------

const EnvelopeSchema = z.object({
  success: z.boolean(),
  errors: z
    .array(
      z.object({
        code: z.union([z.number(), z.string()]).optional(),
        message: z.string().optional(),
      }),
    )
    .default([]),
  result: z.unknown().optional(),
});

const DirectUploadResultSchema = z.object({
  uploadURL: z.string().url(),
  uid: ProviderAssetIdSchema,
});

const VideoResultSchema = z.object({
  uid: ProviderAssetIdSchema,
  status: z.object({
    state: z.string(),
    errorReasonCode: z.string().nullable().optional(),
  }),
  readyToStream: z.boolean().optional(),
  /** Seconds; the vendor sends -1 while unknown. */
  duration: z.number().optional(),
  input: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
  /** Set once bytes arrived. Its absence is what tells an upload failure apart. */
  uploaded: z.string().nullable().optional(),
});

const TokenResultSchema = z.object({ token: z.string().min(1) });

/**
 * Cloudflare's processing states, translated. `error` splits on whether
 * bytes ever arrived: with an `uploaded` timestamp the encoder failed, and
 * without one the upload did. A state this table does not know is reported
 * as a malformed answer rather than guessed into the lifecycle.
 */
export function translateCloudflareState(video: {
  readonly state: string;
  readonly uploaded: string | null | undefined;
}): MediaStatus | null {
  switch (video.state) {
    case "pendingupload":
      return "UPLOAD_PENDING";
    case "downloading":
      return "UPLOADING";
    case "queued":
    case "inprogress":
      return "PROCESSING";
    case "ready":
      return "READY";
    case "error":
      return video.uploaded === undefined || video.uploaded === null
        ? "UPLOAD_FAILED"
        : "PROCESSING_FAILED";
    default:
      return null;
  }
}

export function classifyCloudflareStatus(status: number): MediaProviderFailure {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 400 && status < 500) return "REJECTED";
  return "UNAVAILABLE";
}

/** A playback URL host on the vendor's edge. Never proxied, never stored. */
function manifestUrl(subdomain: string, tokenOrUid: string): string {
  return `https://${subdomain}/${tokenOrUid}/manifest/video.m3u8`;
}

const base64url = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

function privateKeyPem(pem: string): string {
  return pem.trimStart().startsWith("-----")
    ? pem
    : Buffer.from(pem, "base64").toString("utf8");
}

export function createCloudflareStreamVideoProvider(
  input: CloudflareStreamVideoProviderOptions,
): VideoProvider {
  const options = OptionsSchema.parse({
    accountId: input.accountId,
    apiToken: input.apiToken,
    ...(input.customerSubdomain === undefined
      ? {}
      : { customerSubdomain: input.customerSubdomain }),
    ...(input.signingKey === undefined ? {} : { signingKey: input.signingKey }),
    ...(input.uploadExpirySeconds === undefined
      ? {}
      : { uploadExpirySeconds: input.uploadExpirySeconds }),
    ...(input.apiBaseUrl === undefined ? {} : { apiBaseUrl: input.apiBaseUrl }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
  const doFetch = input.fetch ?? fetch;
  const now = input.now ?? (() => new Date());
  const streamBase = `${options.apiBaseUrl.replace(/\/$/, "")}/accounts/${options.accountId}/stream`;

  const fail = (
    operation: string,
    failure: MediaProviderFailure,
    status: number | null,
    providerCode?: string | null,
    cause?: unknown,
  ): MediaProviderError =>
    new MediaProviderError({
      provider: CLOUDFLARE_STREAM_PROVIDER_ID,
      failure,
      operation,
      status,
      providerCode,
      cause,
    });

  type Answer<T> =
    | { readonly kind: "RESULT"; readonly result: T }
    | { readonly kind: "NOT_FOUND" };

  /**
   * One vendor call. Authentication, timeout, envelope and status handling
   * live here so every operation fails the same way. 404 is handed back to
   * the caller because it means different things to different operations.
   */
  async function request<TSchema extends z.ZodType>(
    operation: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    schema: TSchema,
    body?: unknown,
  ): Promise<Answer<z.infer<TSchema>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${streamBase}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      throw fail(operation, "UNAVAILABLE", null, null, cause);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      return { kind: "NOT_FOUND" };
    }

    let payload: unknown = null;
    const text = await response.text().catch(() => "");
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    const envelope = EnvelopeSchema.safeParse(payload);
    const providerCode =
      envelope.success && envelope.data.errors[0]?.code !== undefined
        ? String(envelope.data.errors[0].code)
        : null;

    if (!response.ok) {
      throw fail(
        operation,
        classifyCloudflareStatus(response.status),
        response.status,
        providerCode,
      );
    }
    if (text.length === 0) {
      // A bare 2xx (deletion answers this way). Only an operation that
      // expects nothing back may accept it.
      const empty = schema.safeParse(undefined);
      if (!empty.success) {
        throw fail(operation, "MALFORMED_RESPONSE", response.status, null);
      }
      return { kind: "RESULT", result: empty.data };
    }
    if (!envelope.success || !envelope.data.success) {
      throw fail(
        operation,
        "MALFORMED_RESPONSE",
        response.status,
        providerCode,
      );
    }
    const result = schema.safeParse(envelope.data.result);
    if (!result.success) {
      throw fail(operation, "MALFORMED_RESPONSE", response.status, null);
    }
    return { kind: "RESULT", result: result.data };
  }

  async function createUploadSession(
    raw: CreateVideoUploadSession,
  ): Promise<VideoUploadSession> {
    const session = CreateVideoUploadSessionSchema.parse(raw);
    const expiresAt = new Date(
      now().getTime() + options.uploadExpirySeconds * 1_000,
    ).toISOString();
    const answer = await request(
      "upload",
      "POST",
      "/direct_upload",
      DirectUploadResultSchema,
      {
        // The reservation is Capital Q's number, never the browser's.
        maxDurationSeconds: session.maxDurationSeconds,
        expiry: expiresAt,
        requireSignedURLs: session.requireSignedPlayback,
        ...(session.allowedOrigin === undefined
          ? {}
          : { allowedOrigins: [new URL(session.allowedOrigin).host] }),
        // The creator reference is our asset id: the vendor's record can
        // always be traced back to ours, and nothing about a person is sent.
        creator: session.mediaAssetId,
        meta: { name: `${session.purpose} ${session.mediaAssetId}` },
      },
    );
    if (answer.kind === "NOT_FOUND") {
      throw fail("upload", "REJECTED", 404, null);
    }
    return VideoUploadSessionSchema.parse({
      providerAssetId: answer.result.uid,
      uploadMode: "DIRECT",
      uploadUrl: answer.result.uploadURL,
      expiresAt,
    });
  }

  async function getAsset(providerAssetId: string): Promise<VideoAssetStatus> {
    const uid = ProviderAssetIdSchema.parse(providerAssetId);
    const answer = await request(
      "asset status",
      "GET",
      `/${encodeURIComponent(uid)}`,
      VideoResultSchema,
    );
    if (answer.kind === "NOT_FOUND") {
      // The vendor no longer has it. For an id Capital Q issued that means
      // the upload target lapsed before bytes arrived; the lifecycle
      // refuses this move from any state where it would be a lie.
      return VideoAssetStatusSchema.parse({
        providerAssetId: uid,
        status: "EXPIRED",
        providerErrorCode: "ASSET_NOT_FOUND",
      });
    }
    const video = answer.result;
    const status = translateCloudflareState({
      state: video.status.state,
      uploaded: video.uploaded,
    });
    if (status === null) {
      throw fail("asset status", "MALFORMED_RESPONSE", 200, video.status.state);
    }
    const duration =
      video.duration !== undefined && video.duration >= 1
        ? Math.round(video.duration)
        : undefined;
    const width =
      video.input?.width !== undefined && video.input.width >= 1
        ? Math.round(video.input.width)
        : undefined;
    const height =
      video.input?.height !== undefined && video.input.height >= 1
        ? Math.round(video.input.height)
        : undefined;
    const errorCode = video.status.errorReasonCode ?? undefined;
    return VideoAssetStatusSchema.parse({
      providerAssetId: video.uid,
      status,
      ...(duration === undefined ? {} : { durationSeconds: duration }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(status === "READY"
        ? { thumbnailReference: `${video.uid}/thumbnails/thumbnail.jpg` }
        : {}),
      ...(errorCode === undefined || errorCode.length === 0
        ? {}
        : { providerErrorCode: errorCode.slice(0, 64) }),
    });
  }

  function signLocally(
    key: CloudflareStreamSigningKey,
    uid: string,
    expiresAtSeconds: number,
  ): string {
    const header = base64url(JSON.stringify({ alg: "RS256", kid: key.keyId }));
    const payload = base64url(
      JSON.stringify({
        sub: uid,
        kid: key.keyId,
        exp: expiresAtSeconds,
        nbf: Math.floor(now().getTime() / 1_000) - NOT_BEFORE_SKEW_SECONDS,
      }),
    );
    try {
      const signature = createSign("RSA-SHA256")
        .update(`${header}.${payload}`)
        .sign(privateKeyPem(key.pem));
      return `${header}.${payload}.${base64url(signature)}`;
    } catch (cause) {
      throw fail("playback", "REJECTED", null, "SIGNING_KEY_INVALID", cause);
    }
  }

  async function createPlaybackAuthorization(
    raw: PlaybackAuthorizationRequest,
  ): Promise<PlaybackAuthorization> {
    const authorization = PlaybackAuthorizationRequestSchema.parse(raw);
    const subdomain = options.customerSubdomain;
    if (subdomain === undefined) {
      throw new MediaProviderNotConfiguredError("playback", [
        "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
      ]);
    }
    const expiresAtSeconds =
      Math.floor(now().getTime() / 1_000) + authorization.ttlSeconds;
    const expiresAt = new Date(expiresAtSeconds * 1_000).toISOString();

    // PUBLIC media was uploaded without the signed-URL requirement and is
    // deliberately reachable by its identifier. Everything else gets a
    // per-viewer, short-lived token, whoever the viewer is.
    if (authorization.accessMode === "PUBLIC") {
      return {
        mediaAssetId: authorization.mediaAssetId,
        playbackUrl: manifestUrl(subdomain, authorization.providerAssetId),
        expiresAt,
      };
    }

    let token: string;
    if (options.signingKey !== undefined) {
      token = signLocally(
        options.signingKey,
        authorization.providerAssetId,
        expiresAtSeconds,
      );
    } else {
      const answer = await request(
        "playback",
        "POST",
        `/${encodeURIComponent(authorization.providerAssetId)}/token`,
        TokenResultSchema,
        { exp: expiresAtSeconds },
      );
      if (answer.kind === "NOT_FOUND") {
        throw fail("playback", "REJECTED", 404, "ASSET_NOT_FOUND");
      }
      token = answer.result.token;
    }
    return {
      mediaAssetId: authorization.mediaAssetId,
      token,
      playbackUrl: manifestUrl(subdomain, token),
      expiresAt,
    };
  }

  async function deleteAsset(providerAssetId: string): Promise<void> {
    const uid = ProviderAssetIdSchema.parse(providerAssetId);
    // Idempotent by contract: an asset the vendor no longer has is gone,
    // which is the outcome that was asked for.
    await request(
      "deletion",
      "DELETE",
      `/${encodeURIComponent(uid)}`,
      z.unknown(),
    );
  }

  return {
    id: CLOUDFLARE_STREAM_PROVIDER_ID,
    capabilities: {
      directUpload: true,
      resumableUpload: false,
      signedPlayback: options.customerSubdomain !== undefined,
      captions: false,
    },
    createUploadSession,
    getAsset,
    createPlaybackAuthorization,
    deleteAsset,
  };
}
