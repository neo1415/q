"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isNetworkFailure } from "@/pwa/resilient";

import { roomRead, useRetryWhenOnline } from "./room-read";

/**
 * One page of a PDF, drawn on a canvas (Q room W3). The bytes come from
 * the short-lived signed URL the data room issued for this person: browser
 * <-> storage, never through the app. PDF.js loads only when a document
 * opens or an answer names one (R9), on this thread ("fake worker", as the etiquette reader does), and
 * never evaluates code from the file. The page's own text comes back for
 * the read-aloud highlight. A file PDF.js cannot read falls back to the
 * browser's viewer at the same page.
 */

type PdfModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<ReturnType<PdfModule["getDocument"]>["promise"]>;

// The legacy build: the modern one draws with Map.getOrInsertComputed,
// which current Chrome and Safari releases do not have yet (a page loaded
// but never drew, Q room W3 e2e on Chromium 141).
// R9: one load per tab, started as early as a document is in view (an
// answer naming one, or the signed read starting) and shared by every
// viewer; a failed load (a dropped connection) is forgotten, so the next
// open tries again instead of reusing the failure.
let loading: Promise<PdfModule> | null = null;

function pdfjs(): Promise<PdfModule> {
  loading ??= import("pdfjs-dist/legacy/build/pdf.worker.min.mjs")
    .then(() => import("pdfjs-dist/legacy/build/pdf.mjs"))
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** Warm PDF.js and its worker module ahead of a document opening. */
export function preloadPdfjs(): void {
  void pdfjs().catch(() => undefined);
}

export type PdfState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly document: PdfDocument }
  /** The file is there but PDF.js can't read it: the browser's viewer. */
  | { readonly kind: "failed" }
  /** R9: the network failed twice: "Couldn't load — try again". */
  | { readonly kind: "unreachable" };

/** pdf.js names for "the file never arrived", as against "unreadable". */
const UNREACHED = new Set([
  "ResponseException",
  "UnexpectedResponseException",
  "MissingPDFException",
  "ReadTimeoutError",
]);

function unreachable(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  return UNREACHED.has(error.name) || isNetworkFailure(error);
}

/**
 * The document behind a signed URL, loaded once per URL. Only the bytes
 * the first page needs are fetched before it draws (range reads, no
 * auto-fetch of the rest). R9: one retry; a network failure ends in
 * "unreachable" with `retry`, a file PDF.js can't read in "failed".
 */
export function usePdfDocument(url: string): {
  readonly state: PdfState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<{
    readonly url: string;
    readonly tries: number;
    readonly state: PdfState;
  }>({ url, tries: 0, state: { kind: "loading" } });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    let destroy: (() => Promise<void>) | null = null;
    roomRead(
      async () => {
        const lib = await pdfjs();
        await destroy?.();
        const task = lib.getDocument({
          url,
          enableXfa: false,
          verbosity: 0,
          // The signed URL is the whole authorisation; nothing else rides.
          withCredentials: false,
          // First page first: read ranges as pages need them.
          disableAutoFetch: true,
          rangeChunkSize: 65_536,
        });
        destroy = () => task.destroy();
        return task.promise;
      },
      { timeoutMs: 45_000 },
    ).then(
      (document) => {
        if (live) {
          setState({ url, tries, state: { kind: "ready", document } });
        }
      },
      (error: unknown) => {
        if (!live) return;
        setState({
          url,
          tries,
          state: { kind: unreachable(error) ? "unreachable" : "failed" },
        });
      },
    );
    return () => {
      live = false;
      void destroy?.();
    };
  }, [url, tries]);
  const retry = useCallback(() => setTries((n) => n + 1), []);
  const now: PdfState =
    state.url === url && state.tries === tries
      ? state.state
      : { kind: "loading" };
  useRetryWhenOnline(now.kind === "unreachable", retry);
  return { state: now, retry };
}

export function PdfPage({
  document,
  page,
  title,
  onText,
}: {
  readonly document: PdfDocument;
  readonly page: number;
  readonly title: string;
  readonly onText: (page: number, text: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const textOut = useRef(onText);
  useEffect(() => {
    textOut.current = onText;
  });

  useEffect(() => {
    let live = true;
    let cancel: (() => void) | null = null;
    void (async () => {
      try {
        const at = Math.max(1, Math.min(document.numPages, page));
        const pdfPage = await document.getPage(at);
        if (!live || canvas.current === null) return;
        const width = box.current?.clientWidth ?? 640;
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const scale = Math.max(0.5, Math.min(2.5, width / unscaled.width));
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const viewport = pdfPage.getViewport({ scale: scale * ratio });
        const target = canvas.current;
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        target.style.width = `${String(Math.floor(viewport.width / ratio))}px`;
        target.style.height = `${String(Math.floor(viewport.height / ratio))}px`;
        const task = pdfPage.render({ canvas: target, viewport });
        cancel = () => task.cancel();
        await task.promise;
        const content = await pdfPage.getTextContent();
        if (!live) return;
        textOut.current(
          at,
          content.items
            .map((item) =>
              "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
            )
            .join(""),
        );
        // The next page is drawn ahead, so "next page" is instant.
        if (at < document.numPages) void document.getPage(at + 1);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      cancel?.();
    };
  }, [document, page]);

  return (
    <div
      ref={box}
      className="flex w-full justify-center"
      data-q-pdf-page={page}
    >
      {failed ? (
        <p className="cq-body-sm p-4 text-(--cq-text-secondary)">
          This page couldn&apos;t be drawn.
        </p>
      ) : (
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${title}, page ${String(page)}`}
          className="max-w-full bg-(--cq-surface-raised)"
        />
      )}
    </div>
  );
}
