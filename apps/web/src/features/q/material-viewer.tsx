"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FileViewer } from "@/features/company/material/file-viewer";
import {
  openDocumentAction,
  type OpenedFile,
} from "@/features/company/material/material-actions";

import {
  Q_MATERIAL_CLOSE_EVENT,
  Q_MATERIAL_OPEN_EVENT,
  type QMaterialDocumentRef,
} from "./client-actions";
import type { QTurn } from "./conversation";
import { materialShouldClose } from "./material-viewer-logic";
import { setMaterialDocument } from "./screen";

type Opened = QMaterialDocumentRef & {
  readonly file: OpenedFile | null;
  /** How many turns the conversation had when it opened. */
  readonly at: number;
  readonly path: string;
};

/**
 * The data-room document Q opened, in the viewer where the person is (R0,
 * Zino live 2026-10-06). The signed, view-only read is the data room's
 * own (openDocumentAction, as on the Data room tab): bytes go browser <->
 * storage, and the API authorises the read as the person again. It is part
 * of what is on screen while it is open, and closes when they say so, the
 * conversation moves on, or they leave the page.
 */
export function QMaterialViewer({
  turns,
}: {
  readonly turns: readonly QTurn[];
}) {
  const pathname = usePathname();
  const [opened, setOpened] = useState<Opened | null>(null);
  // Where the conversation and the page were, read when an open arrives.
  const turnCount = useRef(turns.length);
  const pathRef = useRef(pathname);
  useEffect(() => {
    turnCount.current = turns.length;
    pathRef.current = pathname;
  }, [turns.length, pathname]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<QMaterialDocumentRef>).detail;
      const ref: Opened = {
        companyId: detail.companyId,
        documentId: detail.documentId,
        title: detail.title,
        file: null,
        at: turnCount.current,
        path: pathRef.current,
      };
      setOpened(ref);
      void openDocumentAction(ref.companyId, ref.documentId).then((result) =>
        setOpened((current) =>
          current?.documentId !== ref.documentId
            ? current
            : result.ok
              ? { ...current, file: result.value }
              : null,
        ),
      );
    };
    const onClose = () => setOpened(null);
    window.addEventListener(Q_MATERIAL_OPEN_EVENT, onOpen);
    window.addEventListener(Q_MATERIAL_CLOSE_EVENT, onClose);
    return () => {
      window.removeEventListener(Q_MATERIAL_OPEN_EVENT, onOpen);
      window.removeEventListener(Q_MATERIAL_CLOSE_EVENT, onClose);
    };
  }, []);

  // On screen while open: what Q is asked about "this" is this document.
  useEffect(() => {
    setMaterialDocument(
      opened === null
        ? null
        : { companyId: opened.companyId, documentId: opened.documentId },
    );
    return () => setMaterialDocument(null);
  }, [opened]);

  // The topic moved on, they asked to close it, or they left the page.
  const shouldClose =
    opened !== null &&
    (pathname !== opened.path ||
      materialShouldClose(turns.slice(opened.at), opened.documentId));
  // Adjusted while rendering, as React advises for state derived from props.
  if (shouldClose) setOpened(null);

  return (
    <FileViewer
      title={opened?.title ?? "Document"}
      file={shouldClose ? null : (opened?.file ?? null)}
      onClose={() => setOpened(null)}
    />
  );
}
