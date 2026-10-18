import type { UploadOutcome } from "./upload-bytes";

/**
 * The bytes, browser → provider, resumably (CQ-MEDIA-011; doc 20 §11).
 *
 * The server reserved a tus 1.0.0 resource on the provider's edge and
 * handed over its address. This file speaks the part of tus a client needs
 * once the resource exists — HEAD to learn how many bytes the provider
 * already holds, PATCH the next chunk at exactly that offset — and nothing
 * else. Creation happened server side, on the server's terms; termination
 * is the server's too (cancel releases the provider asset), so neither
 * lives here. There is no Capital Q URL in this file: the bytes go from
 * this browser to the provider and nowhere else.
 *
 * Why not a library: tus-js-client would bring creation, termination,
 * fingerprint storage and Node stream support this flow deliberately does
 * not use, plus its own dependencies. What is needed is two requests and a
 * retry rule, and every line of it is tested against a scripted endpoint.
 *
 * The retry rule. A dropped connection, a stalled request, a 5xx, 423 or
 * 429 is transient: wait (1s, 2s, 4s … 30s), ask the provider where it
 * stands, and carry on from there — bytes it already acknowledged are
 * never sent again. Any other 4xx is an answer, not a blip: the target is
 * gone (cancelled, expired) or the request was wrong, and retrying would
 * only hide that. A chunk that lands resets the count, so a long upload
 * over a bad connection is limited by how long each outage lasts, not by
 * how many there are.
 */

export type TusRequest = {
  readonly method: "HEAD" | "PATCH";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Blob | undefined;
  /** Bytes of `body` sent so far. */
  readonly onUploadProgress?: ((loadedBytes: number) => void) | undefined;
  readonly signal: AbortSignal;
};

export type TusReply =
  | {
      readonly kind: "RESPONSE";
      readonly status: number;
      readonly header: (name: string) => string | null;
    }
  | { readonly kind: "NETWORK" }
  | { readonly kind: "ABORTED" };

export type TusTransport = (request: TusRequest) => Promise<TusReply>;

export const TUS_VERSION = "1.0.0";

/** How long a request may send nothing before it is treated as dropped. */
export const STALL_TIMEOUT_MS = 60_000;

/** Waits between consecutive failures. Exhausted means "interrupted". */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [
  1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000,
];

export type ResumableUploadInput = {
  /** The tus resource the server reserved. */
  readonly uploadUrl: string;
  readonly file: Blob;
  /** From the server's session: the provider's chunk rule. */
  readonly chunkSizeBytes: number;
  readonly onProgress: (fraction: number) => void;
  /** Called before each wait; `attempt` counts consecutive failures. */
  readonly onRetry?: ((attempt: number, delayMs: number) => void) | undefined;
  /** Called when bytes move again after a retry. */
  readonly onRecovered?: (() => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Test seams. */
  readonly transport?: TusTransport | undefined;
  readonly retryDelaysMs?: readonly number[] | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
};

function retryable(status: number): boolean {
  return status >= 500 || status === 423 || status === 429;
}

function offsetFrom(reply: TusReply): number | null {
  if (reply.kind !== "RESPONSE") return null;
  const raw = reply.header("Upload-Offset");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function uploadResumable(
  input: ResumableUploadInput,
): Promise<UploadOutcome> {
  const transport = input.transport ?? xhrTusTransport;
  const delays = input.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = input.sleep ?? defaultSleep;
  const signal = input.signal ?? new AbortController().signal;
  const size = input.file.size;
  const chunk = Math.max(1, input.chunkSizeBytes);
  const report = (bytes: number) =>
    input.onProgress(size === 0 ? 1 : Math.min(1, bytes / size));

  let failures = 0;
  // Unknown until the provider says. Always asked first: after a reload or
  // a drop, the provider's count is the only one that matters.
  let offset: number | null = null;

  const backOff = async (): Promise<boolean> => {
    failures += 1;
    const delay = delays[failures - 1];
    if (delay === undefined) return false;
    input.onRetry?.(failures, delay);
    await sleep(delay, signal);
    return true;
  };
  const progressed = () => {
    if (failures > 0) input.onRecovered?.();
    failures = 0;
  };

  for (;;) {
    if (signal.aborted) return { kind: "ABORTED" };

    if (offset === null) {
      const reply = await transport({
        method: "HEAD",
        url: input.uploadUrl,
        headers: { "Tus-Resumable": TUS_VERSION },
        signal,
      });
      if (reply.kind === "ABORTED") return { kind: "ABORTED" };
      if (reply.kind === "NETWORK" || retryable(reply.status)) {
        if (!(await backOff())) return { kind: "NETWORK" };
        continue;
      }
      if (reply.status < 200 || reply.status >= 300) {
        return { kind: "REJECTED", status: reply.status };
      }
      const known = offsetFrom(reply);
      const length = reply.header("Upload-Length");
      if (
        known === null ||
        known > size ||
        (length !== null && Number(length) !== size)
      ) {
        // Not this file's resource, or an answer that is not tus: sending
        // bytes into it would be guessing.
        return { kind: "REJECTED", status: reply.status };
      }
      offset = known;
      report(offset);
    }

    if (offset >= size) {
      input.onProgress(1);
      return { kind: "DONE" };
    }

    const start = offset;
    const end = Math.min(start + chunk, size);
    const reply = await transport({
      method: "PATCH",
      url: input.uploadUrl,
      headers: {
        "Tus-Resumable": TUS_VERSION,
        "Upload-Offset": String(start),
        "Content-Type": "application/offset+octet-stream",
      },
      body: input.file.slice(start, end),
      onUploadProgress: (loaded) =>
        report(start + Math.min(loaded, end - start)),
      signal,
    });
    if (reply.kind === "ABORTED") return { kind: "ABORTED" };
    if (reply.kind === "NETWORK" || retryable(reply.status)) {
      // Some of the chunk may have landed. Ask rather than assume.
      offset = null;
      if (!(await backOff())) return { kind: "NETWORK" };
      continue;
    }
    if (reply.status === 409) {
      // Our offset and the provider's disagree: re-read theirs.
      offset = null;
      if (!(await backOff())) return { kind: "NETWORK" };
      continue;
    }
    if (reply.status < 200 || reply.status >= 300) {
      return { kind: "REJECTED", status: reply.status };
    }
    const next = offsetFrom(reply);
    if (next === null || next <= start || next > size) {
      offset = null;
      if (!(await backOff())) return { kind: "NETWORK" };
      continue;
    }
    offset = next;
    progressed();
    report(offset);
  }
}

/**
 * The browser transport. XMLHttpRequest because it still is the only way
 * a browser reports upload progress; a request that sends nothing for
 * STALL_TIMEOUT_MS is aborted and reported as a dropped connection, since
 * a hung mobile socket otherwise never errors at all.
 */
export const xhrTusTransport: TusTransport = (request) =>
  new Promise((resolve) => {
    if (request.signal.aborted) {
      resolve({ kind: "ABORTED" });
      return;
    }
    const xhr = new XMLHttpRequest();
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, STALL_TIMEOUT_MS);
    };
    const onAbort = () => xhr.abort();
    const settle = (reply: TusReply) => {
      clearTimeout(stallTimer);
      request.signal.removeEventListener("abort", onAbort);
      resolve(reply);
    };

    xhr.open(request.method, request.url);
    for (const [name, value] of Object.entries(request.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.addEventListener("progress", (event) => {
      armStall();
      request.onUploadProgress?.(event.loaded);
    });
    xhr.addEventListener("load", () =>
      settle({
        kind: "RESPONSE",
        status: xhr.status,
        header: (name) => xhr.getResponseHeader(name),
      }),
    );
    xhr.addEventListener("error", () => settle({ kind: "NETWORK" }));
    xhr.addEventListener("timeout", () => settle({ kind: "NETWORK" }));
    xhr.addEventListener("abort", () =>
      settle(stalled ? { kind: "NETWORK" } : { kind: "ABORTED" }),
    );
    request.signal.addEventListener("abort", onAbort, { once: true });
    armStall();
    xhr.send(request.body ?? null);
  });
