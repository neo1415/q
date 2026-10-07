"use client";

import { useEffect, useRef, useState } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { FileText, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { exportAnswerAction } from "@/features/documents/actions";
import {
  announceDocument,
  openDocumentViewer,
} from "@/features/documents/document-ready";

import type { QTurn } from "../conversation";

import { answerToOffer, offerLine, pdfOfferOf } from "./document-room";

export type PdfExport = (input: {
  readonly runId: string;
  readonly messageId: string;
}) => ReturnType<typeof exportAnswerAction>;

/**
 * Q room W3 (R6, design scene 6): after a long web or news answer, "That's
 * about 1,100 words. Want it as a PDF?". Yes, tapped or said, files exactly
 * that answer through the existing answer-to-PDF path (a private document
 * of their organisation) and opens it in the viewer, where it downloads;
 * no, or moving on, puts the offer away. Only answers that arrive while
 * this room is open are offered: a reload never re-files anything.
 */
export function QRoomPdfOffer({
  turns,
  file = exportAnswerAction,
  opened,
}: {
  readonly turns: readonly QTurn[];
  readonly file?: PdfExport | undefined;
  /**
   * W7: what was in the conversation when the room opened, from the room
   * itself: this offer's code loads only once Q has answered.
   */
  readonly opened?: ReadonlySet<string> | undefined;
}) {
  const offer = pdfOfferOf(turns);
  // Per offered answer: "busy", "done", "declined", or what went wrong.
  const [state, setState] = useState<Readonly<Record<string, string>>>({});
  // What was already in the conversation when the room opened.
  const [known] = useState<ReadonlySet<string>>(
    () => opened ?? new Set(turns.map((turn) => turn.id)),
  );
  const fresh = offer !== null && !known.has(offer.answerId);

  const make = async (runId: string, messageId: string) => {
    setState((current) => ({ ...current, [messageId]: "busy" }));
    const result = await file({ runId, messageId });
    if (!result.ok) {
      setState((current) => ({ ...current, [messageId]: result.message }));
      return;
    }
    setState((current) => ({ ...current, [messageId]: "done" }));
    announceDocument({
      artifactId: result.value.artifactId,
      type: result.value.type,
      title: result.value.title,
      version: Math.max(1, result.value.currentVersion),
      status: "READY",
    });
    openDocumentViewer(result.value.artifactId);
  };
  const makeRef = useRef(make);
  useEffect(() => {
    makeRef.current = make;
  });

  // "Yes" or "no", said or typed, right after the offered answer.
  const offeredAt =
    offer === null ? -1 : turns.findIndex((turn) => turn.id === offer.answerId);
  const reply = offeredAt < 0 ? undefined : turns[offeredAt + 1];
  const answer =
    fresh && reply?.kind === "PERSON" && !known.has(reply.id)
      ? answerToOffer(reply.text)
      : null;
  const offerId = offer?.answerId;
  const runId = offer?.runId;
  const now = offerId === undefined ? undefined : state[offerId];
  // A said "yes" files it, once; a said "no" puts the offer away.
  const sayYes = answer === "YES" && now === undefined;
  useEffect(() => {
    if (!sayYes || offerId === undefined || runId === undefined) return;
    void makeRef.current(runId, offerId);
  }, [sayYes, offerId, runId]);

  if (offer === null || !fresh) return null;
  // Moved on: they said something else after the offer.
  if (reply !== undefined && answer === null && now === undefined) return null;
  if (now === "declined" || now === "done" || answer === "NO") return null;

  return (
    <section
      className="flex w-full flex-wrap items-center gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-4"
      aria-label="Make a PDF"
      data-q-room-pdf-offer
    >
      <span className="flex size-9 flex-none items-center justify-center rounded-(--cq-radius-md) border border-(--cq-border) text-(--cq-text-secondary)">
        <FileText
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
      </span>
      <span className="flex min-w-44 flex-1 flex-col">
        <span className="cq-body font-medium text-(--cq-text-primary)">
          {offerLine(offer.words)}
        </span>
        <span className="cq-caption text-(--cq-text-secondary)">
          {now === undefined || now === "busy"
            ? "With every source linked."
            : now}
        </span>
      </span>
      <button
        type="button"
        className={buttonClassName("primary", "compact")}
        disabled={now === "busy"}
        onClick={() => void make(offer.runId, offer.answerId)}
        data-q-room-pdf-yes
      >
        {now === "busy" ? "Making the PDF…" : "Yes, make the PDF"}
      </button>
      <button
        type="button"
        className={buttonClassName("quiet", "compact")}
        disabled={now === "busy"}
        onClick={() =>
          setState((current) => ({ ...current, [offer.answerId]: "declined" }))
        }
        data-q-room-pdf-no
      >
        No thanks
      </button>
    </section>
  );
}
