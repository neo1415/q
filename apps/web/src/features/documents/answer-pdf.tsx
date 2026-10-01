"use client";

import { useState } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { Download, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { exportAnswerAction } from "./actions";
import { announceDocument } from "./document-ready";

/**
 * Any of Q's answers as a PDF (DOCS spec §3 F5; founder directive
 * 2026-10-01). One quiet control under a substantive answer: the server
 * files exactly the words shown as a private document, and the
 * document-ready card offers the download wherever the person is.
 */

/** Shorter answers are a line of conversation, not a document. */
export const ANSWER_PDF_MIN_CHARS = 200;

export function AnswerPdf({
  runId,
  messageId,
}: {
  readonly runId: string;
  readonly messageId: string;
}) {
  const [state, setState] = useState<
    | { readonly kind: "idle" }
    | { readonly kind: "busy" }
    | { readonly kind: "done" }
    | { readonly kind: "failed"; readonly message: string }
  >({ kind: "idle" });

  const file = async () => {
    if (state.kind === "busy" || state.kind === "done") return;
    setState({ kind: "busy" });
    const result = await exportAnswerAction({ runId, messageId });
    if (!result.ok) {
      setState({ kind: "failed", message: result.message });
      return;
    }
    setState({ kind: "done" });
    announceDocument({
      artifactId: result.value.artifactId,
      type: result.value.type,
      title: result.value.title,
      version: Math.max(1, result.value.currentVersion),
      status: "READY",
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-q-answer-pdf>
      <button
        type="button"
        className={buttonClassName("quiet", "compact")}
        onClick={() => void file()}
        disabled={state.kind === "busy" || state.kind === "done"}
        aria-label="Save this answer as a PDF"
        data-q-answer-pdf-button={state.kind}
      >
        <Download
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        {state.kind === "busy"
          ? "Making PDF…"
          : state.kind === "done"
            ? "PDF ready"
            : "PDF"}
      </button>
      {state.kind === "failed" ? (
        <p className="cq-caption text-(--cq-text-secondary)" role="status">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
