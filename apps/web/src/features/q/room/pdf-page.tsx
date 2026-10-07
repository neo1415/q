"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One page of a PDF, drawn on a canvas (Q room W3). The bytes come from
 * the short-lived signed URL the data room issued for this person: browser
 * <-> storage, never through the app. PDF.js loads only when a document
 * opens, on this thread ("fake worker", as the etiquette reader does), and
 * never evaluates code from the file. The page's own text comes back for
 * the read-aloud highlight. A file PDF.js cannot read falls back to the
 * browser's viewer at the same page.
 */

type PdfModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<ReturnType<PdfModule["getDocument"]>["promise"]>;

// The legacy build: the modern one draws with Map.getOrInsertComputed,
// which current Chrome and Safari releases do not have yet (a page loaded
// but never drew, Q room W3 e2e on Chromium 141).
async function pdfjs(): Promise<PdfModule> {
  await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export type PdfState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly document: PdfDocument }
  | { readonly kind: "failed" };

/** The document behind a signed URL, loaded once per URL. */
export function usePdfDocument(url: string): PdfState {
  const [state, setState] = useState<{
    readonly url: string;
    readonly state: PdfState;
  }>({ url, state: { kind: "loading" } });
  useEffect(() => {
    let live = true;
    let destroy: (() => Promise<void>) | null = null;
    void pdfjs()
      .then((lib) => {
        const task = lib.getDocument({
          url,
          enableXfa: false,
          verbosity: 0,
          // The signed URL is the whole authorisation; nothing else rides.
          withCredentials: false,
        });
        destroy = () => task.destroy();
        return task.promise;
      })
      .then((document) => {
        if (live) setState({ url, state: { kind: "ready", document } });
      })
      .catch(() => {
        if (live) setState({ url, state: { kind: "failed" } });
      });
    return () => {
      live = false;
      void destroy?.();
    };
  }, [url]);
  return state.url === url ? state.state : { kind: "loading" };
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
