"use client";

import { useState, useTransition } from "react";

import type { DataRoomInvestorDocument } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { FileText, ICON_SIZE } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { useT } from "@/features/i18n/language";

import { newRequestKey, requestAccessAction } from "./material-actions";

/** One document, or every document listed on request. */
export type RoomRequestTarget = DataRoomInvestorDocument | "ALL";

/**
 * Asking the founders for documents they list on request (data room option
 * 1). Prepare -> approve -> execute: the sheet says exactly what is asked
 * for and who sees the note; only "Send request" sends it, under a key
 * minted for that press. The founders decide; nothing opens until they do.
 */
export function RequestSheet({
  companyId,
  companyName,
  target,
  onClose,
  onSent,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly target: RoomRequestTarget | null;
  readonly onClose: () => void;
  readonly onSent: (target: RoomRequestTarget) => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      if (target === null) return;
      setError(null);
      const result = await requestAccessAction({
        companyId,
        documentId: target === "ALL" ? null : target.documentId,
        note,
        idempotencyKey: await newRequestKey(),
      });
      if (result.ok) {
        setNote("");
        onSent(target);
      } else setError(result.message);
    });
  return (
    <SheetRoot
      open={target !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      {target === null ? null : (
        <SheetContent
          title={
            target === "ALL"
              ? "Request every on-request document"
              : "Request this document"
          }
          side="side"
        >
          <div className="flex flex-col gap-4 pb-6" data-request-sheet>
            {target === "ALL" ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                This asks for the documents {companyName} lists here as
                available on request. It does not reach anything they
                haven&rsquo;t listed for you.
              </p>
            ) : (
              <p className="cq-body flex items-center gap-2 text-(--cq-text-primary)">
                <FileText size={ICON_SIZE.regular} aria-hidden="true" />{" "}
                {target.title}
              </p>
            )}
            <label className="flex flex-col gap-2">
              <span className="cq-label text-(--cq-text-primary)">
                A note to {companyName} (optional)
              </span>
              <textarea
                value={note}
                maxLength={1000}
                rows={4}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t(
                  "For example: we're preparing for our investment committee on 20 October.",
                )}
                className="cq-body resize-none rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) p-3 text-(--cq-text-primary)"
              />
            </label>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t(
                "The founders will see your name, your firm and your note. You’ll get a message here when they answer.",
              )}
            </p>
            {error === null ? null : (
              <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={pending}
                aria-busy={pending}
                onClick={send}
                className={buttonClassName("primary", "large")}
                data-send-request
              >
                {pending ? t("Sending…") : t("Send request")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className={buttonClassName("quiet", "large")}
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        </SheetContent>
      )}
    </SheetRoot>
  );
}
