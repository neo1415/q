import { createSign } from "node:crypto";

import { z } from "zod";

import { ProviderAssetIdSchema, type MediaStatus } from "../contracts/index.js";
import {
  CreateVideoUploadSessionSchema,
  PlaybackAuthorizationRequestSchema,
  ResumeVideoUploadSessionSchema,
  VideoAssetStatusSchema,
  VideoUploadSessionSchema,
  type CreateVideoUploadSession,
  type GeneratedCaptions,
  type GeneratedCaptionsStatus,
  type PlaybackAuthorization,
  type PlaybackAuthorizationRequest,
  type ResumeVideoUploadSession,
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
 * This file and its webhook sibling (`cloudflare-stream-webhook.ts`,
 * CQ-MEDIA-012) are the only places in the product that know Cloudflare's
 * vocabulary. Its status strings, error reason codes, envelope shape and
 * URL layout are read here and translated into Capital Q's own lifecycle
 * before anything leaves; nothing downstream can tell which vendor answered.
 *
 * Three things are settled by the server and never by a browser: the
 * creator reference, the duration reservation and the expiry of an upload
 * target, and whether playback must be signed. The API token is revealed
 * once, at construction, and appears in exactly one place — the
 * `Authorization` header of a request to the vendor. It is never part of a
 * returned value, an error message or a thrown cause.
 *
 * Two upload targets (CQ-MEDIA-011, doc 20 §10–§11). Without a byte length
 * the target is the one-shot direct creator upload: one POST of the whole
 * file. With one it is a tus direct creator upload: the server asks Stream
 * for a tus resource on its terms, and the browser PATCHes the bytes to it
 * in chunks, asking where it stands after any drop. Either way the browser
 * talks to Cloudflare and never to us, and never holds the API token.
 *
 * A tus reservation carries a digest of the request that made it
 * (`cqreservation` in the upload metadata). That is how a retried
 * reservation is recognised without Capital Q storing anything new: the
 * provider's own record says which request opened it.
 */

export const CLOUDFLARE_STREAM_PROVIDER_ID = "CLOUDFLARE_STREAM" as const;

const DEFAULT_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 15_000;
/** Cloudflare bounds a direct-upload expiry to two minutes … six hours. */
const UPLOAD_EXPIRY_MIN_SECONDS = 120;
const UPLOAD_EXPIRY_MAX_SECONDS = 6 * 3_600;
const DEFAULT_UPLOAD_EXPIRY_SECONDS = 30 * 60;
/**
 * A resumable target outlives the one-shot kind: its point is surviving a
 * slow, dropping connection. Still bounded, because Stream reserves storage
 * against `maxDurationSeconds` until the upload completes or expires.
 */
const DEFAULT_RESUMABLE_UPLOAD_EXPIRY_SECONDS = 2 * 3_600;
/** Tolerance for clock skew between this server and the vendor's edge. */
const NOT_BEFORE_SKEW_SECONDS = 60;

const TUS_VERSION = "1.0.0";
/**
 * Stream's tus rules: at least 5 MiB per PATCH unless the file is smaller,
 * a multiple of 256 KiB, at most 200 MiB. The minimum is chosen on purpose:
 * a dropped mobile connection then costs at most one chunk.
 */
export const CLOUDFLARE_TUS_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
/** Where Stream serves tus resources. Bytes are never sent anywhere else. */
const TUS_UPLOAD_ORIGIN = "https://upload.cloudflarestream.com";
/** The upload-metadata key that binds a tus asset to the request that opened it. */
const RESERVATION_METADATA_KEY = "cqreservation";

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
  /** Expiry of a resumable (tus) target; defaults to two hours. */
  readonly resumableUploadExpirySeconds?: number | undefined;
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
    resumableUploadExpirySeconds: z
      .number()
      .int()
      .min(UPLOAD_EXPIRY_MIN_SECONDS)
      .max(UPLOAD_EXPIRY_MAX_SECONDS)
      .default(DEFAULT_RESUMABLE_UPLOAD_EXPIRY_SECONDS),
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

/**
 * One Stream video as the vendor describes it — the `result` of a status
 * read and, byte for byte, the body of a webhook delivery. Both paths parse
 * it with this schema and translate it with `normalizeCloudflareVideo`, so
 * the poll and the webhook cannot disagree about what a vendor answer means.
 */
export const CloudflareVideoSchema = z.object({
  uid: ProviderAssetIdSchema,
  status: z.object({
    state: z.string().max(64),
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
  /** The creator reference Capital Q set at upload: our media asset id. */
  creator: z.string().nullable().optional(),
});
export type CloudflareVideo = z.infer<typeof CloudflareVideoSchema>;

/** The same video, with what a tus resume check reads besides. */
const ResumableVideoSchema = CloudflareVideoSchema.extend({
  meta: z.record(z.string(), z.unknown()).optional(),
  uploadExpiry: z.string().nullable().optional(),
});

const TokenResultSchema = z.object({ token: z.string().min(1) });

/**
 * Cloudflare's processing states, translated. `error` splits on whether
 * bytes ever arrived: with an `uploaded` timestamp the encoder failed, and
 * without one the upload did. A state this table does not know is reported
 * as a malformed answer rather than guessed into the lifecycle.
 *
 * Observed live (2026-09-24): a tus reservation carries `uploaded` from the
 * moment it is created, so an `error` on a tus asset always reads as a
 * processing failure. The founder's next step is the same either way —
 * replace the file — and the vendor's reason code travels with it.
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

/**
 * One vendor video, in Capital Q's words — or null for a vendor state this
 * adapter does not know, which the caller must refuse rather than guess.
 *
 * `readyToStream: false` alongside a `ready` state is read as still
 * processing: READY means the provider says the media is playable, and here
 * it says it is not. The lifecycle can always move PROCESSING → READY on the
 * next report; it can never take READY back.
 */
export function normalizeCloudflareVideo(
  video: CloudflareVideo,
): VideoAssetStatus | null {
  const translated = translateCloudflareState({
    state: video.status.state,
    uploaded: video.uploaded,
  });
  if (translated === null) {
    return null;
  }
  const status =
    translated === "READY" && video.readyToStream === false
      ? "PROCESSING"
      : translated;
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
    ...(duration === undefined || duration > 86_400
      ? {}
      : { durationSeconds: duration }),
    ...(width === undefined || width > 16_384 ? {} : { width }),
    ...(height === undefined || height > 16_384 ? {} : { height }),
    // A reference on the vendor's edge, never the vendor's full URL: the
    // host is configuration, and a stored URL would outlive a change of it.
    ...(status === "READY"
      ? { thumbnailReference: `${video.uid}/thumbnails/thumbnail.jpg` }
      : {}),
    ...(errorCode === undefined || errorCode.length === 0
      ? {}
      : { providerErrorCode: errorCode.slice(0, 64) }),
  });
}

export function classifyCloudflareStatus(status: number): MediaProviderFailure {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 400 && status < 500) return "REJECTED";
  return "UNAVAILABLE";
}

/** Playback URLs on the vendor's edge. Never proxied, never stored. */
function manifestUrl(subdomain: string, tokenOrUid: string): string {
  return `https://${subdomain}/${tokenOrUid}/manifest/video.m3u8`;
}
function posterUrl(subdomain: string, tokenOrUid: string): string {
  return `https://${subdomain}/${tokenOrUid}/thumbnails/thumbnail.jpg`;
}

const base64url = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");
/** tus `Upload-Metadata` values are standard base64 (RFC 4648 §4). */
const base64 = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64");

/**
 * The tus resource Stream issued, accepted only on its upload host and at
 * `/tus/<the video id it named>`. Anything else is refused as a malformed
 * answer rather than handed to a browser: a target elsewhere would send a
 * founder's bytes somewhere Capital Q never agreed to, and a different
 * shape would break the resume path, which addresses the same resource.
 */
function tusTarget(location: string | null, uid: string): string | null {
  if (location === null) return null;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  return url.origin === TUS_UPLOAD_ORIGIN && url.pathname === `/tus/${uid}`
    ? url.toString()
    : null;
}

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
    ...(input.resumableUploadExpirySeconds === undefined
      ? {}
      : { resumableUploadExpirySeconds: input.resumableUploadExpirySeconds }),
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
  /** The one place a request leaves for the vendor, authenticated and timed. */
  async function send(
    operation: string,
    method: "GET" | "POST" | "DELETE",
    pathAndQuery: string,
    headers: Readonly<Record<string, string>>,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      return await doFetch(`${streamBase}${pathAndQuery}`, {
        method,
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          accept: "application/json",
          ...headers,
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
  }

  async function readEnvelope(response: Response) {
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
    return { text, envelope, providerCode };
  }

  async function request<TSchema extends z.ZodType>(
    operation: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    schema: TSchema,
    body?: unknown,
  ): Promise<Answer<z.infer<TSchema>>> {
    const response = await send(operation, method, path, {}, body);

    if (response.status === 404) {
      return { kind: "NOT_FOUND" };
    }

    const { text, envelope, providerCode } = await readEnvelope(response);

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
    if (session.uploadLengthBytes !== undefined) {
      return createResumableUploadSession(session, session.uploadLengthBytes);
    }
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

  /**
   * A tus direct creator upload. The request is the vendor's documented
   * shape: `?direct_user=true`, the tus headers, the creator reference as
   * `Upload-Creator`, and every term in `Upload-Metadata` as
   * `key base64(value)` pairs. The answer has no body; the tus resource is
   * the `Location` header and the video id is `stream-media-id`.
   */
  async function createResumableUploadSession(
    session: CreateVideoUploadSession,
    uploadLengthBytes: number,
  ): Promise<VideoUploadSession> {
    const expiresAt = new Date(
      now().getTime() + options.resumableUploadExpirySeconds * 1_000,
    ).toISOString();
    const metadata = [
      // The reservation is Capital Q's number, never the browser's.
      `maxDurationSeconds ${base64(String(session.maxDurationSeconds))}`,
      `expiry ${base64(expiresAt)}`,
      `name ${base64(`${session.purpose} ${session.mediaAssetId}`)}`,
      ...(session.requireSignedPlayback ? ["requiresignedurls"] : []),
      ...(session.allowedOrigin === undefined
        ? []
        : [`allowedorigins ${base64(new URL(session.allowedOrigin).host)}`]),
      ...(session.reservationKey === undefined
        ? []
        : [`${RESERVATION_METADATA_KEY} ${base64(session.reservationKey)}`]),
    ].join(",");

    const response = await send("upload", "POST", "?direct_user=true", {
      "tus-resumable": TUS_VERSION,
      "upload-length": String(uploadLengthBytes),
      "upload-creator": session.mediaAssetId,
      "upload-metadata": metadata,
    });
    const { providerCode } = await readEnvelope(response);
    if (!response.ok) {
      throw fail(
        "upload",
        response.status === 404
          ? "REJECTED"
          : classifyCloudflareStatus(response.status),
        response.status,
        providerCode,
      );
    }
    const uid = ProviderAssetIdSchema.safeParse(
      response.headers.get("stream-media-id"),
    );
    const target = uid.success
      ? tusTarget(response.headers.get("location"), uid.data)
      : null;
    if (!uid.success || target === null) {
      throw fail("upload", "MALFORMED_RESPONSE", response.status, null);
    }
    return VideoUploadSessionSchema.parse({
      providerAssetId: uid.data,
      uploadMode: "RESUMABLE",
      uploadUrl: target,
      expiresAt,
      chunkSizeBytes: CLOUDFLARE_TUS_CHUNK_SIZE_BYTES,
    });
  }

  /**
   * The open tus target a retried reservation asked for, or null.
   *
   * Every condition is read from the vendor's own record: it names our
   * asset as creator, carries the same reservation digest, has not
   * received all its bytes, and has not lapsed. The resource address is
   * then the one Stream issued at reservation — `/tus/<video id>` on its
   * upload host, observed and asserted by `tusTarget` when it was issued —
   * so nothing about it is stored on our side.
   */
  async function resumeUploadSession(
    raw: ResumeVideoUploadSession,
  ): Promise<VideoUploadSession | null> {
    const input = ResumeVideoUploadSessionSchema.parse(raw);
    const answer = await request(
      "upload",
      "GET",
      `/${encodeURIComponent(input.providerAssetId)}`,
      ResumableVideoSchema,
    );
    if (answer.kind === "NOT_FOUND") {
      return null;
    }
    const video = answer.result;
    const expiry =
      typeof video.uploadExpiry === "string"
        ? Date.parse(video.uploadExpiry)
        : Number.NaN;
    if (
      video.uid !== input.providerAssetId ||
      video.creator !== input.mediaAssetId ||
      video.meta?.[RESERVATION_METADATA_KEY] !== input.reservationKey ||
      video.status.state !== "pendingupload" ||
      (!Number.isNaN(expiry) && expiry <= now().getTime())
    ) {
      return null;
    }
    return VideoUploadSessionSchema.parse({
      providerAssetId: video.uid,
      uploadMode: "RESUMABLE",
      uploadUrl: `${TUS_UPLOAD_ORIGIN}/tus/${encodeURIComponent(video.uid)}?tusv2=true`,
      ...(Number.isNaN(expiry)
        ? {}
        : { expiresAt: new Date(expiry).toISOString() }),
      chunkSizeBytes: CLOUDFLARE_TUS_CHUNK_SIZE_BYTES,
    });
  }

  async function getAsset(providerAssetId: string): Promise<VideoAssetStatus> {
    const uid = ProviderAssetIdSchema.parse(providerAssetId);
    const answer = await request(
      "asset status",
      "GET",
      `/${encodeURIComponent(uid)}`,
      CloudflareVideoSchema,
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
    const normalized = normalizeCloudflareVideo(answer.result);
    if (normalized === null) {
      throw fail(
        "asset status",
        "MALFORMED_RESPONSE",
        200,
        answer.result.status.state,
      );
    }
    return normalized;
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

  /**
   * Tokens minted by the vendor's `/token` endpoint, per asset and access
   * mode, reused for the first half of their life.
   *
   * That endpoint is a rate-limited API round trip meant for under ~1,000
   * tokens a day (Cloudflare, "Secure your Stream"); a feed authorises the
   * next cards on every swipe, so without a signing key every swipe waited
   * on Cloudflare and real traffic would exhaust the limit. What a token
   * grants is playback of one asset until it expires -- its claims name the
   * asset, never the viewer -- so handing the same live token to two
   * viewers the server has just authorised, each on their own request,
   * grants nothing either was not granted. Whether a viewer may watch is
   * still decided per request before this is reached. Local signing (a
   * configured key) bypasses this entirely.
   */
  const mintedTokens = new Map<
    string,
    { readonly token: string; readonly expiresAtSeconds: number }
  >();
  const MINTED_TOKEN_LIMIT = 500;

  async function mintedToken(
    providerAssetId: string,
    expiresAtSeconds: number,
    ttlSeconds: number,
  ): Promise<{ readonly token: string; readonly expiresAtSeconds: number }> {
    const nowSeconds = Math.floor(now().getTime() / 1_000);
    const held = mintedTokens.get(providerAssetId);
    if (
      held !== undefined &&
      held.expiresAtSeconds - nowSeconds > ttlSeconds / 2
    ) {
      return held;
    }
    mintedTokens.delete(providerAssetId);
    const answer = await request(
      "playback",
      "POST",
      `/${encodeURIComponent(providerAssetId)}/token`,
      TokenResultSchema,
      { exp: expiresAtSeconds },
    );
    if (answer.kind === "NOT_FOUND") {
      throw fail("playback", "REJECTED", 404, "ASSET_NOT_FOUND");
    }
    const fresh = { token: answer.result.token, expiresAtSeconds };
    if (mintedTokens.size >= MINTED_TOKEN_LIMIT) {
      // Oldest first: a Map iterates in insertion order.
      const oldest = mintedTokens.keys().next();
      if (oldest.done !== true) mintedTokens.delete(oldest.value);
    }
    mintedTokens.set(providerAssetId, fresh);
    return fresh;
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
        posterUrl: posterUrl(subdomain, authorization.providerAssetId),
        expiresAt,
      };
    }

    let token: string;
    let grantedUntil = expiresAt;
    if (options.signingKey !== undefined) {
      token = signLocally(
        options.signingKey,
        authorization.providerAssetId,
        expiresAtSeconds,
      );
    } else {
      // Only SIGNED media reaches here (PUBLIC returned above), so the
      // cache key is the asset alone.
      const minted = await mintedToken(
        authorization.providerAssetId,
        expiresAtSeconds,
        authorization.ttlSeconds,
      );
      token = minted.token;
      grantedUntil = new Date(minted.expiresAtSeconds * 1_000).toISOString();
    }
    return {
      mediaAssetId: authorization.mediaAssetId,
      token,
      playbackUrl: manifestUrl(subdomain, token),
      posterUrl: posterUrl(subdomain, token),
      expiresAt: grantedUntil,
    };
  }

  async function deleteAsset(providerAssetId: string): Promise<void> {
    const uid = ProviderAssetIdSchema.parse(providerAssetId);
    // A deleted asset's token must not outlive it in this process.
    mintedTokens.delete(uid);
    // Idempotent by contract: an asset the vendor no longer has is gone,
    // which is the outcome that was asked for.
    await request(
      "deletion",
      "DELETE",
      `/${encodeURIComponent(uid)}`,
      z.unknown(),
    );
  }

  // -------------------------------------------------------------------------
  // Generated captions (R18). Stream's AI captions are included in Stream at
  // no additional cost (Cloudflare, June 2024); videos must be under two
  // hours. POST .../captions/<lang>/generate asks; GET .../captions lists
  // each language's state; GET .../captions/<lang>/vtt is the WebVTT.
  // -------------------------------------------------------------------------

  const CaptionListSchema = z.array(
    z
      .object({
        language: z.string(),
        generated: z.boolean().optional(),
        status: z.string().optional(),
      })
      .passthrough(),
  );
  const LanguageSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

  function captionStatus(status: string | undefined): GeneratedCaptionsStatus {
    // A caption uploaded by hand has no status and is ready.
    if (status === undefined || status === "ready") return "READY";
    if (status === "inprogress") return "PENDING";
    return "FAILED";
  }

  async function getGeneratedCaptions(
    providerAssetId: string,
    language: string,
  ): Promise<GeneratedCaptions> {
    const uid = ProviderAssetIdSchema.parse(providerAssetId);
    const lang = LanguageSchema.parse(language);
    const answer = await request(
      "captions",
      "GET",
      `/${encodeURIComponent(uid)}/captions`,
      CaptionListSchema,
    );
    if (answer.kind === "NOT_FOUND") return { status: "NONE" };
    const entry = answer.result.find((c) => c.language === lang);
    if (entry === undefined) return { status: "NONE" };
    const status = captionStatus(entry.status);
    if (status !== "READY") return { status };
    const response = await send(
      "captions",
      "GET",
      `/${encodeURIComponent(uid)}/captions/${encodeURIComponent(lang)}/vtt`,
      { accept: "text/vtt" },
    );
    if (response.status === 404) return { status: "PENDING" };
    if (!response.ok) {
      throw fail(
        "captions",
        classifyCloudflareStatus(response.status),
        response.status,
      );
    }
    const vtt = await response.text();
    if (!vtt.startsWith("WEBVTT")) {
      throw fail("captions", "MALFORMED_RESPONSE", response.status);
    }
    return { status: "READY", vtt };
  }

  async function requestGeneratedCaptions(
    providerAssetId: string,
    language: string,
  ): Promise<GeneratedCaptionsStatus> {
    const uid = ProviderAssetIdSchema.parse(providerAssetId);
    const lang = LanguageSchema.parse(language);
    try {
      const answer = await request(
        "captions",
        "POST",
        `/${encodeURIComponent(uid)}/captions/${encodeURIComponent(lang)}/generate`,
        z.object({ status: z.string().optional() }).passthrough(),
      );
      if (answer.kind === "NOT_FOUND") return "FAILED";
      return captionStatus(answer.result.status);
    } catch (error) {
      // Asking twice for a language it already has or is making is not a
      // failure of this call: answer its current state instead.
      if (error instanceof MediaProviderError && error.failure === "REJECTED") {
        return (await getGeneratedCaptions(uid, lang)).status;
      }
      throw error;
    }
  }

  return {
    id: CLOUDFLARE_STREAM_PROVIDER_ID,
    capabilities: {
      directUpload: true,
      resumableUpload: true,
      signedPlayback: options.customerSubdomain !== undefined,
      captions: true,
    },
    createUploadSession,
    resumeUploadSession,
    getAsset,
    createPlaybackAuthorization,
    deleteAsset,
    requestGeneratedCaptions,
    getGeneratedCaptions,
  };
}
