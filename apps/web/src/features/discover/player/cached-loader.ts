import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js";

import { isPlaylistUrl, mediaCacheKey, type MediaCache } from "./media-cache";

/**
 * hls.js's loader, with the pitch media cache in front of it (ADR 0063).
 *
 * Segments: cache first, then the network, and what the network returns is
 * stored. A loop, a swipe back, a revisit under a new grant, or a pitch
 * watched with the connection gone reads its bytes from the device.
 * Playlists: the network first, always (doc 20 §29); the stored copy only
 * answers when the network cannot.
 *
 * The bytes are copied before hls.js sees them: it transfers fragment
 * buffers to its worker, which detaches them.
 */

type LoaderClass = new (config: HlsConfig) => Loader<LoaderContext>;

function cachedStats(bytes: number): LoaderStats {
  const now = performance.now();
  return {
    aborted: false,
    loaded: bytes,
    retry: 0,
    total: bytes,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: now, first: now, end: now },
    parsing: { start: now, end: now },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

function bodyLength(data: unknown): number {
  if (typeof data === "string") return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return 0;
}

export function cachingLoader(
  Base: LoaderClass,
  mediaKey: string,
  cache: MediaCache,
): LoaderClass {
  return class CachingLoader implements Loader<LoaderContext> {
    context: LoaderContext | null = null;
    private readonly inner: Loader<LoaderContext>;
    private own: LoaderStats | null = null;
    private aborted = false;

    constructor(config: HlsConfig) {
      this.inner = new Base(config);
    }

    get stats(): LoaderStats {
      return this.own ?? this.inner.stats;
    }

    destroy(): void {
      this.aborted = true;
      this.inner.destroy();
    }

    abort(): void {
      this.aborted = true;
      this.inner.abort();
    }

    getCacheAge(): number | null {
      return this.inner.getCacheAge?.() ?? null;
    }

    getResponseHeader(name: string): string | null {
      return this.inner.getResponseHeader?.(name) ?? null;
    }

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      this.context = context;
      this.own = null;
      this.aborted = false;
      const key = mediaCacheKey(mediaKey, context.url);
      // Byte ranges are another shape of the same file; not ours to key.
      if (
        key === null ||
        context.rangeStart !== undefined ||
        context.rangeEnd !== undefined
      ) {
        this.inner.load(context, config, callbacks);
        return;
      }

      const fromCache = (body: ArrayBuffer | string): void => {
        if (this.aborted) return;
        const data =
          typeof body === "string" || context.responseType !== "arraybuffer"
            ? typeof body === "string"
              ? body
              : new TextDecoder().decode(body)
            : body;
        this.own = cachedStats(bodyLength(data));
        callbacks.onSuccess(
          { url: context.url, data, code: 200 },
          this.own,
          context,
          null,
        );
      };

      const store: LoaderCallbacks<LoaderContext>["onSuccess"] = (
        response,
        stats,
        ctx,
        details,
      ) => {
        const data = response.data;
        if (typeof data === "string") void cache.put(key, data);
        else if (data instanceof ArrayBuffer)
          void cache.put(key, data.slice(0));
        callbacks.onSuccess(response, stats, ctx, details);
      };

      if (isPlaylistUrl(context.url)) {
        // Network first; the stored copy is the offline answer only.
        const fallback =
          <A extends unknown[]>(original: (...args: A) => void) =>
          (...args: A): void => {
            void cache.get(key).then((hit) => {
              if (hit !== null) fromCache(hit);
              else original(...args);
            });
          };
        this.inner.load(context, config, {
          ...callbacks,
          onSuccess: store,
          onError: fallback(callbacks.onError),
          onTimeout: fallback(callbacks.onTimeout),
        });
        return;
      }

      void cache.get(key).then((hit) => {
        if (this.aborted) return;
        if (hit !== null) {
          fromCache(hit);
          return;
        }
        this.inner.load(context, config, { ...callbacks, onSuccess: store });
      });
    }
  };
}
