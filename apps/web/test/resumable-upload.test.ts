import { describe, expect, it } from "vitest";

import {
  uploadResumable,
  type TusReply,
  type TusRequest,
  type TusTransport,
} from "../src/features/pitch/resumable-upload";

/**
 * The resumable client (CQ-MEDIA-011) against a scripted tus endpoint.
 *
 * The endpoint keeps what a tus server keeps — the declared length and the
 * bytes acknowledged so far — and can be told to drop a request, lose
 * part of a chunk, go away, or fail with a status. What is proven: bytes
 * the endpoint acknowledged are never sent twice, a drop is retried from
 * the endpoint's own offset, a target that is gone is not retried, and
 * cancel stops the requests.
 */

type Fault =
  | { readonly kind: "DROP" }
  /** The connection dies after this many bytes of the chunk were stored. */
  | { readonly kind: "DROP_AFTER"; readonly stored: number }
  | { readonly kind: "STATUS"; readonly status: number }
  | { readonly kind: "HANG" };

function tusEndpoint(length: number, stored = 0) {
  const state = {
    offset: stored,
    received: new Uint8Array(length),
    requests: [] as { method: string; offset: number | null; size: number }[],
    faults: [] as (Fault | null)[],
    gone: false,
  };
  const respond = (
    status: number,
    headers: Record<string, string> = {},
  ): TusReply => ({
    kind: "RESPONSE",
    status,
    header: (name) =>
      Object.entries(headers).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      )?.[1] ?? null,
  });

  const transport: TusTransport = async (request: TusRequest) => {
    const offsetHeader = request.headers["Upload-Offset"];
    const body = request.body;
    const bytes =
      body === undefined
        ? new Uint8Array(0)
        : new Uint8Array(await body.arrayBuffer());
    state.requests.push({
      method: request.method,
      offset: offsetHeader === undefined ? null : Number(offsetHeader),
      size: bytes.length,
    });
    const fault = state.faults.shift() ?? null;
    if (request.signal.aborted) return { kind: "ABORTED" };
    if (fault?.kind === "HANG") {
      return new Promise((resolve) =>
        request.signal.addEventListener("abort", () =>
          resolve({ kind: "ABORTED" }),
        ),
      );
    }
    if (fault?.kind === "DROP") return { kind: "NETWORK" };
    if (fault?.kind === "STATUS") return respond(fault.status);
    if (state.gone) return respond(request.method === "HEAD" ? 404 : 400);

    if (request.method === "HEAD") {
      return respond(200, {
        "Upload-Offset": String(state.offset),
        "Upload-Length": String(length),
      });
    }
    if (Number(offsetHeader) !== state.offset) return respond(409);
    const keep =
      fault?.kind === "DROP_AFTER" ? bytes.subarray(0, fault.stored) : bytes;
    state.received.set(keep, state.offset);
    state.offset += keep.length;
    request.onUploadProgress?.(keep.length);
    if (fault?.kind === "DROP_AFTER") return { kind: "NETWORK" };
    return respond(204, { "Upload-Offset": String(state.offset) });
  };
  return { state, transport };
}

function file(length: number): Blob {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = i % 251;
  return new Blob([bytes]);
}

const noWait = () => Promise.resolve();

async function run(
  endpoint: ReturnType<typeof tusEndpoint>,
  blob: Blob,
  extra: Partial<Parameters<typeof uploadResumable>[0]> = {},
) {
  const progress: number[] = [];
  const retries: number[] = [];
  const outcome = await uploadResumable({
    uploadUrl: "https://upload.provider.example/tus/resource",
    file: blob,
    chunkSizeBytes: 4,
    onProgress: (fraction) => progress.push(fraction),
    onRetry: (attempt) => retries.push(attempt),
    transport: endpoint.transport,
    retryDelaysMs: [10, 20, 40],
    sleep: noWait,
    ...extra,
  });
  return { outcome, progress, retries };
}

async function contentOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("uploadResumable", () => {
  it("asks where it stands, then sends every chunk once, in order, with progress", async () => {
    const blob = file(10);
    const endpoint = tusEndpoint(10);
    const { outcome, progress } = await run(endpoint, blob);

    expect(outcome).toEqual({ kind: "DONE" });
    expect(endpoint.state.requests).toEqual([
      { method: "HEAD", offset: null, size: 0 },
      { method: "PATCH", offset: 0, size: 4 },
      { method: "PATCH", offset: 4, size: 4 },
      { method: "PATCH", offset: 8, size: 2 },
    ]);
    expect(endpoint.state.received).toEqual(await contentOf(blob));
    expect(progress.at(-1)).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it("retries a dropped chunk from the endpoint's own offset and never resends acknowledged bytes", async () => {
    const blob = file(10);
    const endpoint = tusEndpoint(10);
    // The second chunk dies after 1 of its 4 bytes were stored.
    endpoint.state.faults.push(null, null, { kind: "DROP_AFTER", stored: 1 });
    const { outcome, retries } = await run(endpoint, blob);

    expect(outcome).toEqual({ kind: "DONE" });
    expect(retries).toEqual([1]);
    expect(
      endpoint.state.requests.map((r) => `${r.method}@${String(r.offset)}`),
    ).toEqual([
      "HEAD@null",
      "PATCH@0",
      "PATCH@4",
      // Ask, rather than assume the chunk was lost.
      "HEAD@null",
      "PATCH@5",
      "PATCH@9",
    ]);
    expect(endpoint.state.received).toEqual(await contentOf(blob));
  });

  it("treats 5xx, 423 and 429 as transient, and recovers", async () => {
    const endpoint = tusEndpoint(6);
    endpoint.state.faults.push(
      { kind: "STATUS", status: 503 },
      null,
      { kind: "STATUS", status: 429 },
      null,
      { kind: "STATUS", status: 423 },
    );
    const { outcome, retries } = await run(endpoint, file(6));
    expect(outcome).toEqual({ kind: "DONE" });
    // Consecutive: no chunk landed between them, so the count climbs.
    expect(retries).toEqual([1, 2, 3]);
  });

  it("resumes an upload the endpoint already holds part of (a reload)", async () => {
    const blob = file(10);
    const endpoint = tusEndpoint(10, 8);
    endpoint.state.received.set((await contentOf(blob)).subarray(0, 8), 0);
    const { outcome, progress } = await run(endpoint, blob);
    expect(outcome).toEqual({ kind: "DONE" });
    expect(endpoint.state.requests).toEqual([
      { method: "HEAD", offset: null, size: 0 },
      { method: "PATCH", offset: 8, size: 2 },
    ]);
    expect(progress[0]).toBeCloseTo(0.8);
    expect(endpoint.state.received).toEqual(await contentOf(blob));
  });

  it("gives up as NETWORK once the retries run out, keeping what arrived", async () => {
    const endpoint = tusEndpoint(10);
    endpoint.state.faults.push(
      null,
      null,
      ...Array.from({ length: 10 }, () => ({ kind: "DROP" as const })),
    );
    const { outcome, retries } = await run(endpoint, file(10));
    expect(outcome).toEqual({ kind: "NETWORK" });
    expect(retries).toEqual([1, 2, 3]);
    expect(endpoint.state.offset).toBe(4);
  });

  it("does not retry a target that is gone (cancelled or lapsed)", async () => {
    const endpoint = tusEndpoint(10);
    endpoint.state.gone = true;
    const head = await run(endpoint, file(10));
    expect(head.outcome).toEqual({ kind: "REJECTED", status: 404 });
    expect(head.retries).toEqual([]);

    const midway = tusEndpoint(10);
    midway.state.faults.push(null, null, { kind: "STATUS", status: 400 });
    const patch = await run(midway, file(10));
    expect(patch.outcome).toEqual({ kind: "REJECTED", status: 400 });
    expect(patch.retries).toEqual([]);
  });

  it("refuses a resource declared for a different length rather than write into it", async () => {
    const endpoint = tusEndpoint(12);
    const { outcome } = await run(endpoint, file(10));
    expect(outcome).toMatchObject({ kind: "REJECTED" });
    expect(endpoint.state.requests.map((r) => r.method)).toEqual(["HEAD"]);
  });

  it("re-reads the offset on 409 instead of pushing on", async () => {
    const endpoint = tusEndpoint(8);
    endpoint.state.faults.push(null, { kind: "STATUS", status: 409 });
    const { outcome } = await run(endpoint, file(8));
    expect(outcome).toEqual({ kind: "DONE" });
    expect(endpoint.state.requests.map((r) => r.method)).toEqual([
      "HEAD",
      "PATCH",
      "HEAD",
      "PATCH",
      "PATCH",
    ]);
  });

  it("stops on cancel: the in-flight request is aborted and nothing more is sent", async () => {
    const endpoint = tusEndpoint(10);
    endpoint.state.faults.push(null, null, { kind: "HANG" });
    const controller = new AbortController();
    const pending = run(endpoint, file(10), { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const { outcome } = await pending;
    expect(outcome).toEqual({ kind: "ABORTED" });
    expect(endpoint.state.requests).toHaveLength(3);
    expect(endpoint.state.offset).toBe(4);
  });
});
