"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ICON_SIZE,
  ICON_STROKE,
  Upload,
} from "@capital-q/ui/icons";

import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "../../onboarding-kit/material-actions";
import type { QTurn } from "../conversation";
import { setRoomDeck } from "../screen";

import {
  fillDeckPlaceholderAction,
  readDeckAction,
  type DeckState,
  type FillResult,
} from "./deck-actions";
import {
  boxStyle,
  deckDrawingOf,
  deckRevisionKey,
  isSlidePicture,
  uploadTarget,
  type DeckDrawing,
  type DeckPlaceholder,
} from "./deck-room";
import { documentPosition } from "./document-room";
import { RoomLoadFailed } from "./room-load-failed";
import {
  roomRead,
  UPLOAD_DROPPED,
  uploadResuming,
  useRetryWhenOnline,
} from "./room-read";

/**
 * Q room W5 (R8): a document Q made, as a DECK surface in the room.
 *
 * The slides are the Q API's own drawing (one layout for the screen and
 * the files), shown large with page thumbnails beside them. A space Q
 * could not fill is marked on the slide; a picture dropped on it, or
 * chosen with the floating Upload button, goes through the ordinary
 * upload path into their data room and then onto the slide as a new
 * version. Paging follows Q's document acts ("next slide", an edit's
 * slide) and their own taps; a new version keeps the slide on screen.
 */

export type DeckLoaders = {
  readonly read: (artifactId: string) => Promise<DeckState>;
  readonly slides: (
    artifactId: string,
    version: number,
  ) => Promise<DeckDrawing | null>;
  /**
   * Their file into their data room (the ordinary upload path): the new
   * document's id, null when refused; throws when the connection drops.
   */
  readonly upload: (
    file: File,
    companyId: string | null,
  ) => Promise<string | null>;
  readonly fill: (input: {
    readonly artifactId: string;
    readonly version: number;
    readonly slide: number;
    readonly documentId: string;
  }) => Promise<FillResult>;
};

/**
 * The deck's drawing; null when the document has no slides (an answer).
 * R9: anything else that goes wrong throws, so the room retries once and
 * then offers "try again" instead of calling the deck slide-less.
 */
async function fetchSlides(
  artifactId: string,
  version: number,
): Promise<DeckDrawing | null> {
  const response = await fetch(
    `/api/q-artifact/${encodeURIComponent(artifactId)}/slides?version=${String(version)}`,
    { cache: "no-store" },
  );
  if (response.status === 409 || response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Slides read failed (${String(response.status)}).`);
  }
  return deckDrawingOf(await response.json());
}

async function uploadToDataRoom(
  file: File,
  companyId: string | null,
): Promise<string | null> {
  const target = await materialUploadTargetAction({
    ...(companyId === null ? {} : { companyId }),
    documentType: isSlidePicture(file) ? "PRODUCT" : "UNCLASSIFIED",
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });
  if (!target.ok) return null;
  // R9: a dropped connection throws (the caller resumes once back
  // online); a refused upload is null.
  const put = await fetch(target.value.url, {
    method: target.value.method,
    headers: target.value.headers,
    body: file,
  });
  if (!put.ok) return null;
  const done = await materialUploadCompleteAction(target.value.uploadSessionId);
  return done.ok ? done.value.documentId : null;
}

export const DEFAULT_DECK_LOADERS: DeckLoaders = {
  read: readDeckAction,
  slides: fetchSlides,
  upload: uploadToDataRoom,
  fill: fillDeckPlaceholderAction,
};

const POLL_MS = 2_500;
const FILL_TRIES = 8;

export function QRoomDeck({
  artifactId,
  title,
  turns,
  openedAt,
  loaders = DEFAULT_DECK_LOADERS,
}: {
  readonly artifactId: string;
  readonly title: string;
  readonly turns: readonly QTurn[];
  /** The turn index the room opened it at (its acts count from there). */
  readonly openedAt: number;
  readonly loaders?: DeckLoaders | undefined;
}) {
  const [state, setState] = useState<DeckState | null>(null);
  const [drawing, setDrawing] = useState<{
    readonly version: number;
    readonly drawn: DeckDrawing | null;
    readonly failed: boolean;
  } | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [slideTries, setSlideTries] = useState(0);
  /** R9: a file whose upload the connection dropped, to try again. */
  const [unsent, setUnsent] = useState<{
    readonly file: File;
    readonly slide: number | null;
  } | null>(null);
  const [manual, setManual] = useState<{
    readonly page: number;
    readonly at: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropOn, setDropOn] = useState<number | null>(null);
  const [reads, setReads] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const pendingSlide = useRef<number | null>(null);

  const revision = deckRevisionKey(turns, artifactId);
  const status = state?.ok === true ? state.status : null;
  const version = state?.ok === true ? state.version : null;

  // Read the document: on open, when the conversation filed a version of
  // it, after a drop, and every few seconds while it is being made.
  // R9: each read retries once, then the surface offers "try again".
  useEffect(() => {
    let live = true;
    roomRead(() => loaders.read(artifactId)).then(
      (next) => {
        if (!live) return;
        setReadFailed(false);
        setState(next);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [artifactId, loaders, revision, reads]);
  useEffect(() => {
    if (status !== "PREPARING") return;
    const timer = window.setTimeout(() => setReads((n) => n + 1), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [status, state]);
  useEffect(() => {
    if (version === null) return;
    let live = true;
    roomRead(() => loaders.slides(artifactId, version)).then(
      (drawn) => {
        if (live) setDrawing({ version, drawn, failed: false });
      },
      () => {
        if (live) setDrawing({ version, drawn: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [artifactId, version, loaders, slideTries]);

  const drawingNow =
    drawing !== null && drawing.version === version ? drawing : null;
  const drawn = drawingNow?.drawn ?? null;
  const slidesFailed = drawingNow?.failed === true;
  // Not read yet, or a read that failed while it was being made.
  const failed = readFailed && (state === null || status === "PREPARING");
  const retry = useCallback(() => {
    if (slidesFailed) {
      setDrawing(null);
      setSlideTries((n) => n + 1);
    }
    if (readFailed) {
      setReadFailed(false);
      setReads((n) => n + 1);
    }
  }, [slidesFailed, readFailed]);
  useRetryWhenOnline(failed || slidesFailed, retry);
  // Each slide drawn once as an image URL, not on every render (R9).
  const pictures = useMemo(
    () =>
      (drawn?.slides ?? []).map(
        (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      ),
    [drawn],
  );
  const count = drawn?.slides.length ?? 0;
  const position = documentPosition(
    turns,
    { page: 1, at: openedAt },
    manual,
    null,
    count === 0 ? null : count,
  );
  const page = position.page;
  const index = page - 1;

  // What Q sees: this deck, on this slide, at this version.
  useEffect(() => {
    if (count === 0) return;
    setRoomDeck({ artifactId, slide: page, version });
    return () => setRoomDeck(null);
  }, [artifactId, page, version, count]);

  const go = useCallback(
    (next: number) => {
      setManual({ page: Math.max(1, Math.min(count, next)), at: turns.length });
    },
    [count, turns.length],
  );

  const placeholders = useMemo(() => drawn?.placeholders ?? [], [drawn]);

  const place = useCallback(
    async (file: File, slide: number | null) => {
      if (state?.ok !== true) return;
      setBusy(true);
      setUnsent(null);
      setNotice(`Uploading ${file.name}…`);
      const documentId = await uploadResuming(
        () => loaders.upload(file, state.companyId),
        () =>
          setNotice(
            "Connection lost. The upload resumes when you're back online.",
          ),
      );
      if (documentId === UPLOAD_DROPPED) {
        // R9: never a silent hang: say so, keep the file, offer a retry.
        setNotice(`${file.name} didn't upload: the connection dropped.`);
        setUnsent({ file, slide });
        setBusy(false);
        return;
      }
      if (documentId === null) {
        setNotice("That file couldn't be uploaded. Try again.");
        setBusy(false);
        return;
      }
      if (slide === null || !isSlidePicture(file) || version === null) {
        setNotice(
          isSlidePicture(file)
            ? "Added to your data room."
            : "Added to your data room. Once Q has read it, ask Q to update the deck from it.",
        );
        setBusy(false);
        return;
      }
      for (let attempt = 0; attempt < FILL_TRIES; attempt += 1) {
        const filled = await loaders
          .fill({ artifactId, version, slide: slide + 1, documentId })
          .catch((): FillResult => ({
            ok: false,
            retry: false,
            message:
              "Your file is in your data room, but it couldn't be placed: the connection dropped. Ask Q to place it.",
          }));
        if (filled.ok) {
          setNotice(`Placed on slide ${String(slide + 1)}.`);
          setManual({ page: slide + 1, at: turns.length });
          setReads((n) => n + 1);
          setBusy(false);
          return;
        }
        setNotice(filled.message);
        if (!filled.retry) break;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      setBusy(false);
    },
    [artifactId, loaders, state, turns.length, version],
  );

  const chooseFor = (slide: number | null) => {
    pendingSlide.current = slide;
    input.current?.click();
  };

  if (failed) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-(--cq-radius-md) bg-(--cq-surface-subtle)">
        <RoomLoadFailed onRetry={retry} className="items-center" />
      </div>
    );
  }
  if (state === null) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" data-q-room-loading>
        <div className="aspect-video w-full rounded-(--cq-radius-md) bg-(--cq-surface-subtle)" />
      </div>
    );
  }
  if (!state.ok) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">{state.message}</p>
    );
  }
  if (state.status === "PREPARING") {
    return (
      <div
        className="flex flex-col gap-3"
        data-q-deck-preparing
        aria-live="polite"
      >
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {state.progress ?? "Q is making it."}
        </p>
        <div className="aspect-video w-full rounded-(--cq-radius-md) bg-(--cq-surface-subtle)" />
      </div>
    );
  }
  if (state.status === "FAILED") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)" data-q-deck-failed>
        This document could not be finished. Ask Q to try again.
      </p>
    );
  }

  if (slidesFailed) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-(--cq-radius-md) bg-(--cq-surface-subtle)">
        <RoomLoadFailed onRetry={retry} className="items-center" />
      </div>
    );
  }
  // Read, being drawn: the slide's shape holds until its picture lands.
  if (drawingNow === null && version !== null) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" data-q-room-loading>
        <div className="aspect-video w-full rounded-(--cq-radius-md) bg-(--cq-surface-subtle)" />
      </div>
    );
  }

  const slidePicture = pictures[index];
  const here = placeholders.filter((box) => box.slide === index);
  const target = uploadTarget(placeholders, index);
  const isDeck = state.type === "PITCH_DECK" || count > 0;

  return (
    <div className="relative flex flex-col gap-3" data-q-deck={artifactId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="cq-body-sm text-(--cq-text-secondary)" data-q-deck-meta>
          {count === 0
            ? `Version ${String(version ?? 1)}`
            : `Version ${String(version ?? 1)} · ${String(count)} slides`}
          {placeholders.length === 0
            ? ""
            : ` · ${String(placeholders.length)} to fill`}
        </p>
        <div className="flex items-center gap-1">
          {count > 1 ? (
            <>
              <button
                type="button"
                className="cq-stage-quiet min-h-11 min-w-11 justify-center"
                aria-label="Previous slide"
                disabled={page <= 1}
                onClick={() => go(page - 1)}
                data-q-deck-previous
              >
                <ChevronLeft
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              </button>
              <span
                className="cq-body-sm tabular-nums text-(--cq-text-secondary)"
                data-q-deck-page
              >
                {page} / {count}
              </span>
              <button
                type="button"
                className="cq-stage-quiet min-h-11 min-w-11 justify-center"
                aria-label="Next slide"
                disabled={page >= count}
                onClick={() => go(page + 1)}
                data-q-deck-next
              >
                <ChevronRight
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              </button>
            </>
          ) : null}
          <a
            className="cq-stage-quiet min-h-11"
            href={`/api/q-artifact/${encodeURIComponent(artifactId)}/pdf`}
            data-q-deck-download
          >
            <Download
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            PDF
          </a>
          {isDeck ? (
            <a
              className="cq-stage-quiet min-h-11"
              href={`/api/q-artifact/${encodeURIComponent(artifactId)}/pptx`}
            >
              PowerPoint
            </a>
          ) : null}
        </div>
      </div>

      {count === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {title} is a document without slides. Download it as a PDF.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10.75rem]">
          <div
            className="relative aspect-video w-full overflow-hidden rounded-(--cq-radius-md) border border-(--cq-border-subtle)"
            data-q-deck-slide={page}
          >
            {slidePicture === undefined ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- an SVG the Q API drew; an optimiser would proxy it
              <img
                src={slidePicture}
                alt={`Slide ${String(page)} of ${title}`}
                width={960}
                height={540}
                decoding="async"
                className="size-full"
              />
            )}
            {(drawn?.pictures ?? [])
              .filter((picture) => picture.slide === index)
              .map((picture) => (
                // eslint-disable-next-line @next/next/no-img-element -- a stock CDN or a short-lived signed URL; never through this app
                <img
                  key={`${picture.url}:${String(picture.x)}`}
                  src={picture.url}
                  alt={picture.alt}
                  referrerPolicy="no-referrer"
                  className={`absolute ${picture.fit === "contain" ? "object-contain" : "object-cover"}`}
                  style={boxStyle(picture)}
                />
              ))}
            {here.map((box) => (
              <PlaceholderTarget
                key={`${String(box.slide)}:${box.kind}`}
                box={box}
                active={dropOn === box.slide}
                busy={busy}
                onChoose={() =>
                  chooseFor(box.kind === "IMAGE" ? box.slide : null)
                }
                onDragState={(on) => setDropOn(on ? box.slide : null)}
                onDrop={(file) => {
                  setDropOn(null);
                  void place(file, box.kind === "IMAGE" ? box.slide : null);
                }}
              />
            ))}
          </div>
          <ol
            className="grid grid-cols-5 content-start gap-2 md:max-h-[27.5rem] md:grid-cols-2 md:overflow-y-auto"
            aria-label="Slides"
            data-q-deck-thumbs
          >
            {pictures.map((picture, at) => {
              const toFill = placeholders.some((box) => box.slide === at);
              return (
                <li key={`thumb-${String(at)}`}>
                  <button
                    type="button"
                    className={`relative block w-full overflow-hidden rounded-(--cq-radius-sm) border-2 ${
                      at === index
                        ? "border-(--cq-accent)"
                        : "border-transparent"
                    }`}
                    aria-label={`Slide ${String(at + 1)}${toFill ? ", has a space to fill" : ""}`}
                    aria-current={at === index ? "true" : undefined}
                    onClick={() => go(at + 1)}
                    data-q-deck-thumb={at + 1}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- an SVG the Q API drew */}
                    {/* R9: tile-sized, decoded off the critical path, and
                        the ones scrolled out of the strip only when near. */}
                    <img
                      src={picture}
                      alt=""
                      width={160}
                      height={90}
                      decoding="async"
                      loading={at < 4 ? "eager" : "lazy"}
                      className="block aspect-video h-auto w-full"
                    />
                    {toFill ? (
                      <span className="cq-caption absolute top-1 right-1 rounded-sm bg-(--cq-surface-raised) px-1 text-(--cq-text-primary)">
                        To fill
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="cq-body-sm min-h-5 text-(--cq-text-secondary)"
          aria-live="polite"
          data-q-deck-notice
        >
          {notice ?? ""}
        </p>
        {unsent === null ? null : (
          <button
            type="button"
            className="cq-stage-quiet min-h-11"
            onClick={() => void place(unsent.file, unsent.slide)}
            disabled={busy}
            data-q-deck-upload-retry
          >
            Try again
          </button>
        )}
        <button
          type="button"
          className="cq-stage-primary min-h-12 w-full justify-center rounded-full px-5 shadow-(--cq-shadow-overlay) md:w-auto"
          onClick={() => chooseFor(target)}
          disabled={busy}
          data-q-deck-upload
        >
          <Upload
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          {target === null ? "Upload" : `Upload to slide ${String(target + 1)}`}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept="image/png,image/jpeg,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void place(file, pendingSlide.current);
        }}
        data-q-deck-file
      />
    </div>
  );
}

function PlaceholderTarget({
  box,
  active,
  busy,
  onChoose,
  onDragState,
  onDrop,
}: {
  readonly box: DeckPlaceholder;
  readonly active: boolean;
  readonly busy: boolean;
  readonly onChoose: () => void;
  readonly onDragState: (on: boolean) => void;
  readonly onDrop: (file: File) => void;
}) {
  return (
    <button
      type="button"
      className={`absolute flex items-center justify-center rounded-(--cq-radius-sm) border-2 border-dashed p-2 text-center transition-colors ${
        active
          ? "border-(--cq-accent) bg-(--cq-accent-soft)"
          : "border-(--cq-border-strong) bg-transparent hover:bg-(--cq-accent-soft)"
      }`}
      style={boxStyle(box)}
      aria-label={
        box.kind === "IMAGE"
          ? `${box.label}. Drop a picture here, or choose one`
          : `${box.label}. Upload a file to your data room`
      }
      disabled={busy}
      onClick={onChoose}
      onDragOver={(event) => {
        event.preventDefault();
        onDragState(true);
      }}
      onDragLeave={() => onDragState(false)}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file !== undefined) onDrop(file);
        else onDragState(false);
      }}
      data-q-deck-placeholder={box.kind}
    >
      <span className="sr-only">{box.label}</span>
    </button>
  );
}
