"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ICON_SIZE,
  ICON_STROKE,
  Lock,
  Square,
  Volume2,
  X,
} from "@capital-q/ui/icons";

import { Watermark } from "@/features/company/material/file-viewer";
import type { OpenedFile } from "@/features/company/material/material-actions";
import { Q_SAID_EVENT, saidText } from "@/features/q-swarm/q-said";

import {
  sentenceSaid,
  sentencesOf,
  speakingMs,
  type CitedLine,
} from "./document-room";
import { PdfPage, usePdfDocument } from "./pdf-page";

/**
 * Q room W3 (R3, design scene 2): the data-room document Q opened, in the
 * room's centre panel. Page controls, the page-cited summary beside it
 * (above it on a phone), "Reading aloud" with the sentence being read
 * highlighted, download only where the data room allows it, and close.
 * The bytes are the data room's own signed, view-only read for this
 * person; a view-only file carries their name over every page.
 */
export function QRoomDocument({
  title,
  file,
  page,
  pageCount,
  reading,
  summary,
  onPage,
  onPageCount,
  onStopReading,
  onDownload,
  onClose,
}: {
  readonly title: string;
  readonly file: OpenedFile | null;
  readonly page: number;
  readonly pageCount: number | null;
  readonly reading: boolean;
  readonly summary: readonly CitedLine[];
  readonly onPage: (page: number) => void;
  readonly onPageCount: (count: number) => void;
  readonly onStopReading: () => void;
  readonly onDownload: () => void;
  readonly onClose: () => void;
}) {
  const [pageText, setPageText] = useState<{
    readonly page: number;
    readonly text: string;
  } | null>(null);
  const onText = useCallback(
    (at: number, text: string) => setPageText({ page: at, text }),
    [],
  );
  const sentences =
    pageText !== null && pageText.page === page ? sentencesOf(pageText.text) : [];
  const highlighted = useReadingHighlight(reading, sentences);

  const last = pageCount ?? null;
  const canBack = page > 1;
  const canForward = last === null || page < last;

  return (
    <section
      className="flex w-full flex-col overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)"
      aria-label={title}
      data-q-room-document
      data-q-section="q-room-document"
    >
      <div className="flex min-h-11 flex-none items-center gap-1 border-b border-(--cq-border-subtle) py-1 pr-1 pl-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="cq-body min-w-0 truncate font-medium text-(--cq-text-primary)">
            {title}
          </h2>
          {file !== null && !file.downloadable ? (
            <span className="cq-caption flex items-center gap-1 text-(--cq-text-secondary)">
              <Lock aria-hidden="true" size={ICON_SIZE.compact} />
              View only
            </span>
          ) : null}
        </div>
        <div
          className="flex items-center"
          role="group"
          aria-label="Pages"
          data-q-room-document-pager
        >
          <button
            type="button"
            className="cq-stage-quiet min-h-11 min-w-11 justify-center"
            aria-label="Previous page"
            disabled={!canBack}
            onClick={() => onPage(page - 1)}
            data-q-room-document-previous
          >
            <ChevronLeft
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
          <span
            className="cq-body-sm tabular-nums text-(--cq-text-secondary)"
            aria-live="polite"
            data-q-room-document-page={page}
          >
            <span className="max-sm:hidden">Page </span>
            {String(page)}
            {last === null ? null : (
              <>
                <span className="max-sm:hidden"> of </span>
                <span className="sm:hidden">/</span>
                {String(last)}
              </>
            )}
          </span>
          <button
            type="button"
            className="cq-stage-quiet min-h-11 min-w-11 justify-center"
            aria-label="Next page"
            disabled={!canForward}
            onClick={() => onPage(page + 1)}
            data-q-room-document-next
          >
            <ChevronRight
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
        </div>
        {file?.downloadable === true ? (
          <button
            type="button"
            className="cq-stage-quiet min-h-11 min-w-11 justify-center"
            aria-label={`Download ${title}`}
            onClick={onDownload}
            data-q-room-document-download
          >
            <Download
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
        ) : null}
        <button
          type="button"
          className="cq-stage-quiet min-h-11 min-w-11 justify-center"
          aria-label={`Close ${title}`}
          onClick={onClose}
          data-q-room-document-close
        >
          <X aria-hidden="true" size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} />
        </button>
      </div>

      {reading ? (
        <div
          className="flex flex-wrap items-center gap-2 px-4 pt-2"
          data-q-room-document-reading
        >
          <span className="cq-caption inline-flex items-center gap-1.5 rounded-(--cq-radius-md) bg-(--cq-accent-soft) px-2 py-1 text-(--cq-text-primary)">
            <Volume2 aria-hidden="true" size={ICON_SIZE.compact} />
            Reading aloud · page {String(page)}
          </span>
          <button
            type="button"
            className="cq-stage-quiet min-h-11"
            onClick={onStopReading}
            data-q-room-document-stop
          >
            <Square aria-hidden="true" size={ICON_SIZE.compact} />
            Stop
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-col max-sm:flex-col-reverse sm:flex-row">
        <div className="relative max-h-[62dvh] min-h-[40dvh] min-w-0 flex-1 overflow-auto bg-(--cq-surface-subtle) p-3">
          {file === null ? (
            <div
              className="mx-auto h-[50dvh] w-full max-w-[36rem] rounded bg-(--cq-surface)"
              aria-busy="true"
              data-q-room-document-loading
            />
          ) : (
            <DocumentPage
              file={file}
              page={page}
              title={title}
              onPageCount={onPageCount}
              onText={onText}
            />
          )}
          {file?.watermark == null ? null : <Watermark words={file.watermark} />}
        </div>
        {summary.length === 0 && !(reading && sentences.length > 0) ? null : (
          <aside
            className="flex flex-col gap-3 border-(--cq-border-subtle) p-4 max-sm:border-b sm:w-72 sm:flex-none sm:border-l"
            data-q-room-document-summary
          >
            {summary.length === 0 ? null : (
              <>
                <h3 className="cq-body-sm font-medium text-(--cq-text-primary)">
                  Summary
                </h3>
                <ul className="flex flex-col gap-2">
                  {summary.map((line, index) => (
                    <li key={index} className="flex gap-2">
                      <button
                        type="button"
                        className="cq-caption min-h-11 flex-none self-start rounded-(--cq-radius-sm) px-1.5 text-(--cq-accent) underline-offset-2 hover:underline"
                        onClick={() => onPage(line.pages[0] ?? 1)}
                        aria-label={`Go to page ${String(line.pages[0] ?? 1)}`}
                        data-q-room-document-cite={line.pages[0]}
                      >
                        p.{line.pages.join(", ")}
                      </button>
                      <span className="cq-body-sm text-(--cq-text-primary)">
                        {line.text}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="cq-caption text-(--cq-text-secondary)">
                  From the document only. Each line cites its page.
                </p>
              </>
            )}
            {reading && sentences.length > 0 ? (
              <div
                className="flex max-h-[30dvh] flex-col gap-1 overflow-y-auto"
                aria-label={`Page ${String(page)} text`}
                data-q-room-document-text
              >
                {sentences.map((sentence, index) => (
                  <span
                    key={index}
                    ref={(element) => {
                      if (index === highlighted && element !== null) {
                        element.scrollIntoView({ block: "nearest" });
                      }
                    }}
                    className={
                      index === highlighted
                        ? "cq-body-sm rounded-(--cq-radius-sm) bg-(--cq-accent-soft) text-(--cq-text-primary)"
                        : "cq-body-sm text-(--cq-text-secondary)"
                    }
                    aria-current={index === highlighted ? "true" : undefined}
                    data-q-room-document-sentence={index}
                  >
                    {sentence}
                  </span>
                ))}
              </div>
            ) : null}
          </aside>
        )}
      </div>
    </section>
  );
}

function DocumentPage({
  file,
  page,
  title,
  onPageCount,
  onText,
}: {
  readonly file: OpenedFile;
  readonly page: number;
  readonly title: string;
  readonly onPageCount: (count: number) => void;
  readonly onText: (page: number, text: string) => void;
}) {
  const pdf = usePdfDocument(file.url);
  const count = pdf.kind === "ready" ? pdf.document.numPages : null;
  useEffect(() => {
    if (count !== null) onPageCount(count);
  }, [count, onPageCount]);
  if (pdf.kind === "loading") {
    return (
      <div
        className="mx-auto h-[50dvh] w-full max-w-[36rem] rounded bg-(--cq-surface)"
        aria-busy="true"
        data-q-room-document-loading
      />
    );
  }
  if (pdf.kind === "failed") {
    // The browser's own viewer, at the same page.
    const tools = file.downloadable ? "" : "&toolbar=0&navpanes=0";
    return (
      <iframe
        key={page}
        src={`${file.url}#page=${String(page)}${tools}`}
        title={title}
        className="h-[60dvh] w-full"
        referrerPolicy="no-referrer"
        data-q-room-document-frame
      />
    );
  }
  return (
    <PdfPage document={pdf.document} page={page} title={title} onText={onText} />
  );
}

/**
 * Which sentence of the page Q is reading: each line Q says (cq:q-said,
 * from the voice line or as a typed answer lands) is matched to the page's
 * sentences, and a long one is walked through at speaking pace.
 */
function useReadingHighlight(
  reading: boolean,
  sentences: readonly string[],
): number | null {
  const [at, setAt] = useState<number | null>(null);
  const latest = useRef(sentences);
  useEffect(() => {
    latest.current = sentences;
  });
  useEffect(() => {
    if (!reading) return;
    const timers: number[] = [];
    let from = 0;
    const onSaid = (event: Event) => {
      const text = saidText(event);
      if (text === null) return;
      for (const timer of timers.splice(0)) window.clearTimeout(timer);
      let delay = 0;
      for (const said of sentencesOf(text)) {
        const match = sentenceSaid(latest.current, said, from);
        if (match !== null) {
          timers.push(
            window.setTimeout(() => {
              from = match;
              setAt(match);
            }, delay),
          );
        }
        delay += speakingMs(said);
      }
    };
    window.addEventListener(Q_SAID_EVENT, onSaid);
    return () => {
      window.removeEventListener(Q_SAID_EVENT, onSaid);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [reading]);
  return reading ? at : null;
}
