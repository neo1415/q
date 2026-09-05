import type {
  DirectUploadAuthorization,
  PrivateDocumentStorageProvider,
  StoredObjectMetadata,
  StoredObjectRef,
  StoredObjectStream,
} from "../application/storage-port.js";
import { DocumentStorageUnavailableError } from "../domain/errors.js";

/**
 * Supabase Storage adapter for the private document bucket.
 *
 * Written against the Storage HTTP API rather than the client SDK so that
 * reads stream: validation must not buffer a whole hostile document, and
 * the SDK's download path materialises a Blob. Every call carries the
 * server's privileged credential, which exists only in this process — the
 * browser receives a scoped, single-object upload authorization and nothing
 * else (doc 15 §24).
 */

export type SupabaseStorageProviderOptions = {
  /** Project URL, e.g. https://<ref>.supabase.co — no trailing slash. */
  readonly supabaseUrl: string;
  /**
   * The privileged storage credential. Never sent to a browser, never
   * logged, never placed in a problem response.
   */
  readonly secretKey: string;
  readonly fetch?: typeof fetch | undefined;
  /** Per-call ceiling. A storage call that hangs must not hold a request. */
  readonly timeoutMs?: number | undefined;
};

/**
 * Supabase mints signed upload tokens with a fixed two-hour lifetime; it is
 * not configurable per request. Capital Q's own upload session closes well
 * before that, and finalization fails closed once it does, so a token that
 * outlives the session cannot produce a document version.
 */
const PROVIDER_UPLOAD_TTL_SECONDS = 7200;

/** Generous for a 25 MiB read over a local network, bounded all the same. */
const DEFAULT_TIMEOUT_MS = 30_000;

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Reads `exp` from our own freshly minted token; falls back to the documented TTL. */
function providerExpiryFromToken(token: string): string {
  const fallback = new Date(
    Date.now() + PROVIDER_UPLOAD_TTL_SECONDS * 1000,
  ).toISOString();
  const payload = token.split(".")[1];
  if (payload === undefined) return fallback;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const exp =
      typeof decoded === "object" && decoded !== null
        ? (decoded as { readonly exp?: unknown }).exp
        : undefined;
    return typeof exp === "number" && Number.isFinite(exp)
      ? new Date(exp * 1000).toISOString()
      : fallback;
  } catch {
    return fallback;
  }
}

export function createSupabaseDocumentStorageProvider(
  options: SupabaseStorageProviderOptions,
): PrivateDocumentStorageProvider {
  const base = `${options.supabaseUrl.replace(/\/+$/, "")}/storage/v1`;
  const call = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const credentials: Readonly<Record<string, string>> = {
    authorization: `Bearer ${options.secretKey}`,
    apikey: options.secretKey,
  };
  const objectPath = (object: StoredObjectRef): string =>
    `${encodeURIComponent(object.bucket)}/${encodeKey(object.key)}`;

  const request = async (
    path: string,
    init: RequestInit,
  ): Promise<Response> => {
    try {
      return await call(`${base}${path}`, {
        ...init,
        headers: { ...credentials, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The provider's own message may carry the URL and token; it is never
      // surfaced or logged.
      throw new DocumentStorageUnavailableError();
    }
  };

  return {
    createUploadAuthorization: async (
      input,
    ): Promise<DirectUploadAuthorization> => {
      const response = await request(
        `/object/upload/sign/${objectPath(input.object)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) throw new DocumentStorageUnavailableError();
      const body: unknown = await response.json().catch(() => null);
      const signedPath =
        typeof body === "object" && body !== null
          ? (body as { readonly url?: unknown }).url
          : undefined;
      const token =
        typeof body === "object" && body !== null
          ? (body as { readonly token?: unknown }).token
          : undefined;
      if (typeof signedPath !== "string" || typeof token !== "string") {
        throw new DocumentStorageUnavailableError();
      }
      return {
        method: "PUT",
        url: `${base}${signedPath}`,
        headers: {
          "content-type": input.contentType,
          // The token already refuses to replace an existing object; saying
          // so explicitly keeps the intent visible at the call site.
          "x-upsert": "false",
        },
        providerExpiresAt: providerExpiryFromToken(token),
      };
    },

    statObject: async (object): Promise<StoredObjectMetadata | null> => {
      const response = await request(`/object/info/${objectPath(object)}`, {
        method: "GET",
      });
      if (response.status === 400 || response.status === 404) return null;
      if (!response.ok) throw new DocumentStorageUnavailableError();
      const body: unknown = await response.json().catch(() => null);
      if (typeof body !== "object" || body === null) {
        throw new DocumentStorageUnavailableError();
      }
      const record = body as {
        readonly size?: unknown;
        readonly content_type?: unknown;
      };
      if (typeof record.size !== "number") {
        throw new DocumentStorageUnavailableError();
      }
      return {
        sizeBytes: record.size,
        declaredContentType:
          typeof record.content_type === "string" ? record.content_type : null,
      };
    },

    openObjectStream: async (object): Promise<StoredObjectStream> => {
      const response = await request(
        `/object/authenticated/${objectPath(object)}`,
        { method: "GET" },
      );
      if (!response.ok || response.body === null) {
        throw new DocumentStorageUnavailableError();
      }
      const stream: ReadableStream<Uint8Array> = response.body;
      return {
        body: {
          async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
            const reader = stream.getReader();
            try {
              for (;;) {
                const chunk: {
                  readonly done: boolean;
                  readonly value?: Uint8Array | undefined;
                } = await reader.read();
                if (chunk.done) return;
                if (chunk.value !== undefined) yield chunk.value;
              }
            } finally {
              reader.releaseLock();
            }
          },
        },
      };
    },

    deleteObject: async (object): Promise<void> => {
      const response = await request(`/object/${objectPath(object)}`, {
        method: "DELETE",
      });
      // Already gone is the state we wanted.
      if (response.ok || response.status === 400 || response.status === 404) {
        return;
      }
      throw new DocumentStorageUnavailableError();
    },
  };
}
