"use client";

import { usePathname } from "next/navigation";
import { lazy, Suspense, useEffect, useRef } from "react";

import type { QShowInQRoomIntent } from "@capital-q/contracts";
import { DialogRoot, DialogViewerContent } from "@capital-q/ui/dialog";
import { ICON_SIZE, ICON_STROKE, X } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { askedSince } from "../client-actions";
import type { QTurn, QTurnObjectBlock } from "../conversation";
import { QMarkdown } from "../markdown";
import { useRoomDocumentHost } from "../room/document-host";
import { closeShown, showInModal, useShown, type Shown } from "./show-store";

/*
 * The cards and the room's card surface load the first time something is
 * shown, never with the page.
 */
const QResultBlocks = lazy(() =>
  import("../q-result-blocks").then((module) => ({
    default: module.QResultBlocks,
  })),
);
const QRoomStage = lazy(() =>
  import("../room/q-room-card").then((module) => ({
    default: module.QRoomStage,
  })),
);

/** What is worth a modal: something laid out to be looked at. */
const SHOWABLE: ReadonlySet<QTurnObjectBlock["kind"]> = new Set([
  "ANSWER_CARDS",
  "COMPARISON_CARDS",
  "COMPARISON",
  "TABLE",
  "CHART",
]);

function roomIntentOf(
  blocks: readonly QTurnObjectBlock[],
): QShowInQRoomIntent | null {
  for (const block of blocks) {
    if (
      block.kind === "UI_INTENT" &&
      block.intent.kind === "SHOW_IN_Q_ROOM" &&
      // A Q-made deck has its own viewer (the document modal).
      block.intent.object !== "Q_DOCUMENT"
    ) {
      return block.intent;
    }
  }
  return null;
}

/**
 * What an answer shows, or null: its cards, comparison or table, or the
 * card it asked to bring up. Words alone are the conversation's.
 */
export function shownOf(turn: QTurn): Shown | null {
  if (turn.kind !== "Q" || turn.streaming) return null;
  const room = roomIntentOf(turn.blocks);
  const laid = turn.blocks.filter((block) => SHOWABLE.has(block.kind));
  if (room === null && laid.length === 0) return null;
  return {
    key: turn.id,
    title: room?.title ?? "",
    text: turn.text,
    blocks: laid,
    ...(room === null ? {} : { room }),
  };
}

/**
 * Lane 7 (owner 2026-10-21): what Q shows the person -- a card, a
 * comparison, a summary -- opens over whatever page they are on, closable
 * by its Close button, Escape, a click outside or "close it". The Q page
 * shows these on its own stage, so there it never opens. The primitive
 * traps focus and returns it on close; under reduced motion it appears
 * and leaves without movement (the global rule).
 *
 * Only answers that arrive while this tab is open, to a question they just
 * asked: a reload never reopens an old one.
 */
export function QShowModal({ turns }: { readonly turns: readonly QTurn[] }) {
  const t = useT();
  const pathname = usePathname();
  const room = useRoomDocumentHost();
  const onQPage = pathname === "/home" || room !== null;
  const shown = useShown();
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(turns.map((one) => one.id));

  useEffect(() => {
    const known = seen.current;
    if (known === null) return;
    for (const turn of turns) {
      if (turn.kind !== "Q" || turn.streaming || known.has(turn.id)) continue;
      known.add(turn.id);
      if (onQPage || askedSince() === null) continue;
      const next = shownOf(turn);
      if (next !== null) showInModal(next);
    }
  }, [turns, onQPage]);

  // On the Q page the stage shows it; leaving a page leaves what it showed.
  useEffect(() => {
    if (onQPage) closeShown();
  }, [onQPage]);

  const title = shown?.title === "" ? t("By Q") : (shown?.title ?? "");
  return (
    <DialogRoot
      open={shown !== null && !onQPage}
      onOpenChange={(next) => {
        if (!next) closeShown();
      }}
    >
      {shown === null ? null : (
        <DialogViewerContent title={title} onSwipeDismiss={closeShown}>
          <div
            className="flex min-h-0 flex-1 flex-col"
            data-q-show-modal={shown.key}
          >
            <div
              className="flex min-h-14 flex-none items-center justify-between gap-2 border-b border-(--cq-border-subtle) py-1 ps-5 pe-2"
              data-cq-sheet-drag
            >
              <h2 className="cq-body min-w-0 truncate font-medium text-(--cq-text-primary)">
                {title}
              </h2>
              <button
                type="button"
                onClick={closeShown}
                aria-label={t("Close")}
                data-q-close
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-(--cq-radius-md) text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
              >
                <X
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              {shown.room === undefined && shown.text.trim().length > 0 ? (
                <div className="cq-body text-(--cq-text-primary)">
                  <QMarkdown text={shown.text} />
                </div>
              ) : null}
              <Suspense fallback={null}>
                {shown.room === undefined ? null : (
                  <QRoomStage
                    open={{
                      key: `${shown.room.object}:${shown.room.id ?? "-"}`,
                      intent: shown.room,
                      sources: [],
                      openedAt: 0,
                    }}
                    note={null}
                    onClose={closeShown}
                    turns={turns}
                  />
                )}
                {shown.blocks.length === 0 ? null : (
                  <QResultBlocks blocks={shown.blocks} />
                )}
              </Suspense>
            </div>
          </div>
        </DialogViewerContent>
      )}
    </DialogRoot>
  );
}
