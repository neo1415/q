"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FileViewer } from "@/features/company/material/file-viewer";
import {
  openDocumentAction,
  type MaterialResult,
  type OpenedFile,
} from "@/features/company/material/material-actions";
import { openDocumentViewer } from "@/features/documents/document-ready";

import { downloadArtifact, downloadSignedFile } from "./artifact-download";
import {
  Q_MATERIAL_CLOSE_EVENT,
  Q_MATERIAL_OPEN_EVENT,
  type QMaterialDocumentRef,
} from "./client-actions";
import type { QTurn } from "./conversation";
import {
  citedLines,
  documentActsOf,
  documentPosition,
  documentShouldClose,
  documentToReopen,
  type CitedLine,
} from "./room/document-room";
import { setRoomDocumentOpen, useRoomDocumentHost } from "./room/document-host";
import { QRoomDocument } from "./room/q-room-document";
import { setMaterialDocument } from "./screen";

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
};

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
      });
      setClosed((current) =>
        current.filter((one) => one.documentId.toLowerCase() !== id),
      );
      // "Open it and read it to me": the opening answer's own acts apply.
      for (const turn of turnsRef.current.slice(at)) {
        applied.current?.delete(turn.id);
      }
      void openFile(ref.companyId, ref.documentId).then((result) =>
        setOpened((current) =>
          current?.documentId !== ref.documentId
            ? current
            : result.ok
              ? { ...current, file: result.value }
              : null,
        ),
      );
    },
    [openFile],
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
        void downloadSignedFile(current.file.url, current.title ?? "Document");
      }
      return;
    }
    // No data-room document open: the document Q just made, if any.
    const made = latestArtifactIn(turnsRef.current);
    if (made !== null) {
      openDocumentViewer(made);
      void downloadArtifact(made);
    }
  }, []);

  // "Download it": a side effect, once per answer. Paging, reading and
  // closing are derived from the conversation above and below.
  useEffect(() => {
    const seen = applied.current;
    if (seen === null) return;
    for (const [index, turn] of turns.entries()) {
      if (turn.kind !== "Q" || turn.streaming || seen.has(turn.id)) continue;
      seen.add(turn.id);
      if (opened !== null && index < opened.at) continue;
      if (documentActsOf(turn).some((act) => act.act === "DOWNLOAD")) {
        download(opened);
      }
    }
  }, [turns, opened, download]);

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
      <QRoomDocument
        title={opened.title ?? "Document"}
        file={opened.file}
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
      />,
      host,
    );
  }

  return (
    <FileViewer
      title={opened?.title ?? "Document"}
      file={shouldClose || host !== null ? null : (opened?.file ?? null)}
      onClose={close}
    />
  );
}
