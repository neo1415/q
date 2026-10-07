"use client";

import { usePathname } from "next/navigation";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  openDocumentAction,
  type MaterialResult,
  type OpenedFile,
} from "@/features/company/material/material-actions";
import { openDocumentViewer } from "@/features/documents/document-ready";

import {
  Q_MATERIAL_CLOSE_EVENT,
  Q_MATERIAL_OPEN_EVENT,
  type QMaterialDocumentRef,
} from "./client-actions";
import type { QTurn } from "./conversation";
import {
  answerNamesDocument,
  citedLines,
  documentActsOf,
  documentPosition,
  documentShouldClose,
  documentToReopen,
  type CitedLine,
} from "./room/document-room";
import { setRoomDocumentOpen, useRoomDocumentHost } from "./room/document-host";
import { preloadPdfjs } from "./room/pdf-page";
import { roomRead, useRetryWhenOnline, whenIdle } from "./room/room-read";
import { setMaterialDocument } from "./screen";
import { useWire } from "./use-wire";

type Opened = QMaterialDocumentRef & {
  readonly file: OpenedFile | null;
  /** The turn it opened at (the answer that opened it, when known). */
  readonly at: number;
  readonly path: string;
  /** The page it opened at: where it was left, or the first. */
  readonly startPage: number;
  /** The page they chose by hand, and how many turns there were then. */
  readonly manual: { readonly page: number; readonly at: number } | null;
  /** When they pressed Stop on the reading, in turns. */
  readonly stoppedAt: number | null;
  readonly pageCount: number | null;
  /** R9: the signed read failed twice; the panel offers "try again". */
  readonly failed: boolean;
};

/*
 * Q room W7: the viewers themselves (the room's document panel with its
 * pages, the full-screen sheet) load when a document is first opened, not
 * with the page. PDF.js is warmed as before, so the first page is not
 * later for it.
 */
const QRoomDocument = lazy(() =>
  import("./room/q-room-document").then((module) => ({
    default: module.QRoomDocument,
  })),
);
const FileViewer = lazy(() =>
  import("@/features/company/material/file-viewer").then((module) => ({
    default: module.FileViewer,
  })),
);

/** R9: how long after an answer naming a document PDF.js is warmed. */
const WARM_AFTER_MS = 2_500;

/** Where each document was left, for this tab: it reopens at that page. */
const lastPage = new Map<string, number>();

/** The newest Q-made document this tab knows, for "download it". */
function latestArtifactIn(turns: readonly QTurn[]): string | null {
  for (const turn of [...turns].reverse()) {
    if (turn.kind !== "Q") continue;
    for (const block of turn.blocks) {
      if (block.kind === "ARTIFACT_REFERENCE") return block.artifactId;
    }
  }
  return null;
}

/** The answer that opened this document, so its own acts apply too. */
function openingTurn(turns: readonly QTurn[], documentId: string): number {
  const id = documentId.toLowerCase();
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.kind === "PERSON") break;
    if (turn?.kind !== "Q") continue;
    const opens = turn.blocks.some(
      (block) =>
        block.kind === "UI_INTENT" &&
        block.intent.kind === "OPEN_RECORD_PAGE" &&
        block.intent.page === "DATA_ROOM_DOCUMENT" &&
        block.intent.id.toLowerCase() === id,
    );
    if (opens) return index;
  }
  return turns.length;
}

/**
 * The data-room document Q opened (R0; Q room W3). In the Q room it opens
 * in the room's centre panel, with pages, the page-cited summary and
 * reading aloud; anywhere else in the full-screen viewer. The signed,
 * view-only read is the data room's own (openDocumentAction, as on the
 * Data room tab): bytes go browser <-> storage, and the API authorises the
 * read as the person again. Asked acts ("next page", "read it to me",
 * "download it", "close it") are read from each answer once. It closes
 * when they say so, the conversation moves on, or they leave the page, and
 * reopens at the same page when the subject comes back.
 */
export function QMaterialViewer({
  turns,
  openFile = openDocumentAction,
}: {
  readonly turns: readonly QTurn[];
  /** The data room's signed read; the /dev harness serves its own. */
  readonly openFile?:
    | ((
        companyId: string,
        documentId: string,
      ) => Promise<MaterialResult<OpenedFile>>)
    | undefined;
}) {
  const pathname = usePathname();
  const host = useRoomDocumentHost();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [closed, setClosed] = useState<readonly QMaterialDocumentRef[]>([]);
  // Where the conversation and the page were, read when an open arrives.
  const turnsRef = useRef(turns);
  const pathRef = useRef(pathname);
  useEffect(() => {
    turnsRef.current = turns;
    pathRef.current = pathname;
  }, [turns, pathname]);

  // Each answer's document acts, once, from the turns that arrive while
  // this tab is open (a reload never replays an old "next page"); and the
  // person's turns, once, for a subject coming back.
  const applied = useRef<Set<string> | null>(null);
  if (applied.current === null) {
    applied.current = new Set(turns.map((turn) => turn.id));
  }

  // The signed read (R9: one retry, then "Couldn't load — try again"), with
  // PDF.js fetched alongside it rather than after it.
  const read = useCallback(
    (ref: QMaterialDocumentRef) => {
      if (host !== null) preloadPdfjs();
      roomRead(() => openFile(ref.companyId, ref.documentId)).then(
        (result) =>
          setOpened((current) =>
            current?.documentId !== ref.documentId
              ? current
              : result.ok
                ? { ...current, file: result.value, failed: false }
                : null,
          ),
        () =>
          setOpened((current) =>
            current?.documentId !== ref.documentId
              ? current
              : { ...current, failed: true },
          ),
      );
    },
    [openFile, host],
  );
  const open = useCallback(
    (ref: QMaterialDocumentRef, at: number) => {
      const id = ref.documentId.toLowerCase();
      setOpened({
        companyId: ref.companyId,
        documentId: ref.documentId,
        title: ref.title,
        file: null,
        at,
        path: pathRef.current,
        startPage: lastPage.get(id) ?? 1,
        manual: null,
        stoppedAt: null,
        pageCount: null,
        failed: false,
      });
      setClosed((current) =>
        current.filter((one) => one.documentId.toLowerCase() !== id),
      );
      // "Open it and read it to me": the opening answer's own acts apply.
      for (const turn of turnsRef.current.slice(at)) {
        applied.current?.delete(turn.id);
      }
      read(ref);
    },
    [read],
  );

  // Closing remembers the page and keeps it to reopen when the subject
  // comes back. Called while rendering too (the topic moved on), so it
  // reads the document it is given, never state.
  const closeNow = useCallback((current: Opened | null, page: number) => {
    if (current === null) return;
    lastPage.set(current.documentId.toLowerCase(), page);
    setClosed((list) => [
      ...list.filter((one) => one.documentId !== current.documentId),
      {
        companyId: current.companyId,
        documentId: current.documentId,
        title: current.title,
      },
    ]);
    setOpened(null);
  }, []);
  // Where the open document is, derived from the conversation (never an
  // act applied twice), and kept for the close event below.
  const position =
    opened === null
      ? null
      : documentPosition(
          turns,
          { page: opened.startPage, at: opened.at },
          opened.manual,
          opened.stoppedAt,
          opened.pageCount,
        );
  const page = position?.page ?? 1;
  const openedRef = useRef({ opened, page });
  useEffect(() => {
    openedRef.current = { opened, page };
  }, [opened, page]);
  const close = useCallback(
    () => closeNow(openedRef.current.opened, openedRef.current.page),
    [closeNow],
  );
  const retryRead = useCallback(() => {
    const current = openedRef.current.opened;
    if (current === null) return;
    setOpened({ ...current, failed: false });
    read(current);
  }, [read]);
  useRetryWhenOnline(opened?.failed === true, retryRead);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<QMaterialDocumentRef>).detail;
      open(detail, openingTurn(turnsRef.current, detail.documentId));
    };
    window.addEventListener(Q_MATERIAL_OPEN_EVENT, onOpen);
    window.addEventListener(Q_MATERIAL_CLOSE_EVENT, close);
    return () => {
      window.removeEventListener(Q_MATERIAL_OPEN_EVENT, onOpen);
      window.removeEventListener(Q_MATERIAL_CLOSE_EVENT, close);
    };
  }, [open, close]);

  const download = useCallback((current: Opened | null) => {
    if (current !== null) {
      if (current.file?.downloadable === true) {
        const { url } = current.file;
        void import("./artifact-download").then((module) =>
          module.downloadSignedFile(url, current.title ?? "Document"),
        );
      }
      return;
    }
    // No data-room document open: the document Q just made, if any.
    const made = latestArtifactIn(turnsRef.current);
    if (made !== null) {
      openDocumentViewer(made);
      void import("./artifact-download").then((module) =>
        module.downloadArtifact(made),
      );
    }
  }, []);

  // "Download it": a side effect, once per answer. Paging, reading and
  // closing are derived from the conversation above and below.
  // W7: acts are read from the wire's contracts; none is marked read
  // before they are in, and this looks again once they are.
  const wire = useWire();
  useEffect(() => {
    const seen = applied.current;
    if (seen === null || wire === null) return;
    for (const [index, turn] of turns.entries()) {
      if (turn.kind !== "Q" || turn.streaming || seen.has(turn.id)) continue;
      seen.add(turn.id);
      if (opened !== null && index < opened.at) continue;
      if (documentActsOf(turn).some((act) => act.act === "DOWNLOAD")) {
        download(opened);
      }
    }
  }, [turns, opened, download, wire]);

  // R9: an answer that names a document warms PDF.js while the room is
  // idle, so opening it next draws the first page without that wait. Not
  // at once: the answer's own card reads and draws first (measured: an
  // immediate warm-up put ~1.7 s on the card under Slow 4G + 4x CPU).
  const latestQ = turns.findLast((turn) => turn.kind === "Q");
  const namesDocument =
    host !== null &&
    latestQ !== undefined &&
    !latestQ.streaming &&
    answerNamesDocument(latestQ);
  useEffect(() => {
    if (!namesDocument) return;
    let cancelIdle: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      cancelIdle = whenIdle(preloadPdfjs);
    }, WARM_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      cancelIdle?.();
    };
  }, [namesDocument]);

  // The subject comes back: the document reopens where it was left.
  const lastPerson = turns.findLast(
    (turn): turn is Extract<QTurn, { kind: "PERSON" }> =>
      turn.kind === "PERSON",
  );
  useEffect(() => {
    const seen = applied.current;
    if (lastPerson === undefined || seen === null || seen.has(lastPerson.id)) {
      return;
    }
    seen.add(lastPerson.id);
    if (opened !== null) return;
    const back = documentToReopen(lastPerson.text, closed);
    if (back !== null) open(back, turns.length);
  }, [lastPerson, opened, closed, open, turns.length]);

  // On screen while open: "this" and "this page" are this document's.
  useEffect(() => {
    setMaterialDocument(
      opened === null
        ? null
        : { companyId: opened.companyId, documentId: opened.documentId },
      page,
    );
    return () => setMaterialDocument(null);
  }, [opened, page]);

  // The topic moved on, they asked to close it, or they left the page.
  const shouldClose =
    opened !== null &&
    (pathname !== opened.path ||
      documentShouldClose(
        turns.slice(opened.at),
        opened.documentId,
        opened.title,
      ));
  // Adjusted while rendering, as React advises for state derived from props.
  if (shouldClose) closeNow(opened, page);

  const inRoom = host !== null && opened !== null && !shouldClose;
  // W7: the full-screen sheet is loaded the first time it is needed.
  const [sheetUsed, setSheetUsed] = useState(false);
  if (!sheetUsed && host === null && opened !== null) setSheetUsed(true);
  useEffect(() => {
    setRoomDocumentOpen(inRoom);
    return () => setRoomDocumentOpen(false);
  }, [inRoom]);

  const summary: readonly CitedLine[] = useMemo(() => {
    if (opened === null) return [];
    for (const turn of turns.slice(opened.at).reverse()) {
      if (turn.kind !== "Q" || turn.streaming) continue;
      const lines = citedLines(turn.text);
      if (lines.length > 0) return lines;
    }
    return [];
  }, [turns, opened]);

  const setPage = useCallback((next: number) => {
    setOpened((current) =>
      current === null
        ? current
        : {
            ...current,
            manual: {
              page: Math.max(1, Math.min(current.pageCount ?? next, next)),
              at: turnsRef.current.length,
            },
          },
    );
  }, []);
  const setPageCount = useCallback((pageCount: number) => {
    setOpened((current) =>
      current === null || current.pageCount === pageCount
        ? current
        : { ...current, pageCount },
    );
  }, []);

  if (inRoom) {
    return createPortal(
      <Suspense fallback={null}>
        <QRoomDocument
          title={opened.title ?? "Document"}
          file={opened.file}
          failed={opened.failed}
          onRetry={retryRead}
          page={page}
          pageCount={opened.pageCount}
          reading={position?.reading === true}
          summary={summary}
          onPage={setPage}
          onPageCount={setPageCount}
          onStopReading={() =>
            setOpened((current) =>
              current === null
                ? current
                : { ...current, stoppedAt: turnsRef.current.length },
            )
          }
          onDownload={() => download(opened)}
          onClose={close}
        />
      </Suspense>,
      host,
    );
  }

  // The sheet stays mounted once used, so its close still animates.
  if (!sheetUsed) return null;
  return (
    <Suspense fallback={null}>
      <FileViewer
        title={opened?.title ?? "Document"}
        file={shouldClose || host !== null ? null : (opened?.file ?? null)}
        onClose={close}
      />
    </Suspense>
  );
}
