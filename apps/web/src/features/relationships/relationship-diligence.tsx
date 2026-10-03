"use client";

import { useEffect, useId, useState } from "react";

import type { DiligenceDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  diligenceDownloadAction,
  ownDocumentsAction,
  readDiligenceAction,
  requestDiligenceAction,
  revokeDiligenceAction,
  shareDiligenceAction,
} from "./diligence-actions";
import { NotScannedNote } from "../documents/not-scanned-note";

/**
 * The diligence area (2026-10-02): once diligence starts, the founder shares
 * chosen documents with this investor (and can take one back), the investor
 * asks for documents, and both see the checklist. Every change is
 * server-confirmed and the area re-read; a download is a short-lived signed
 * URL the browser opens straight from storage.
 */

type Doc = { readonly id: string; readonly title: string };
type DiligenceRequest = DiligenceDto["requests"][number];

/**
 * A request's state as it stands now. A request answered with a document the
 * founder later stopped sharing is not "answered" any more from the
 * investor's seat: say both facts rather than pick one (messy real use).
 */
export function requestStatusWords(
  request: DiligenceRequest,
  sharedDocumentIds: ReadonlySet<string>,
): { readonly words: string; readonly answerable: boolean } {
  if (request.status !== "FULFILLED")
    return { words: "Open", answerable: true };
  const by = request.fulfilledBy;
  if (by === null) return { words: "Answered", answerable: false };
  const title = by.title ?? "a document";
  return sharedDocumentIds.has(by.documentId)
    ? { words: `Answered · ${title}`, answerable: false }
    : {
        // design-48: the state first, then why, in one short line.
        words: `Needs a new answer · ${title} no longer shared`,
        answerable: true,
      };
}

function newKey(): string {
  return `web-diligence-${crypto.randomUUID()}`;
}

export function RelationshipDiligence({
  relationshipId,
  companyId,
}: {
  readonly relationshipId: string;
  readonly companyId: string;
}) {
  const [area, setArea] = useState<DiligenceDto | null>(null);
  const [documents, setDocuments] = useState<readonly Doc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bumped after every change: the area is re-read from the server.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void readDiligenceAction(relationshipId).then((read) => {
      if (read.ok) setArea(read.value);
    });
  }, [relationshipId, version]);

  useEffect(() => {
    if (area?.side !== "COMPANY") return;
    void ownDocumentsAction(companyId).then((result) => {
      if (result.ok) setDocuments(result.value);
    });
  }, [area?.side, companyId]);

  const act = async (
    work: () => Promise<
      { readonly ok: true } | { readonly ok: false; readonly message: string }
    >,
  ) => {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) setError(result.message);
    setVersion((n) => n + 1);
  };

  if (area === null || (!area.open && area.shares.length === 0)) return null;
  const founder = area.side === "COMPANY";
  const sharedIds = new Set(area.shares.map((share) => share.documentId));
  const everAnswered = area.requests.some(
    (request) => request.status === "FULFILLED",
  );

  return (
    <div className="flex flex-col gap-5" data-diligence>
      <section className="flex flex-col gap-2">
        <h3 className="cq-title-sm text-(--cq-text-primary)">
          Shared documents
        </h3>
        {area.shares.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {everAnswered
              ? "Nothing is shared right now."
              : founder
                ? "Nothing shared yet. Only what you choose is shared, and only with them."
                : "Nothing shared yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {area.shares.map((share) => (
              <li
                key={share.policyId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="cq-body">{share.title}</span>
                  {share.scanned ? null : <NotScannedNote />}
                </span>
                <span className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => {
                      void diligenceDownloadAction(
                        relationshipId,
                        share.documentId,
                      ).then((result) => {
                        if (result.ok) window.open(result.value.url, "_blank");
                        else setError(result.message);
                      });
                    }}
                  >
                    Download
                  </Button>
                  {founder ? (
                    <Button
                      variant="secondary"
                      className="min-h-11"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          revokeDiligenceAction(relationshipId, share.policyId),
                        )
                      }
                    >
                      Stop sharing
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {founder && area.open ? (
          <DocumentPicker
            documents={documents}
            label="Share a document"
            busy={busy}
            onPick={(documentId) =>
              void act(() =>
                shareDiligenceAction(relationshipId, documentId, null),
              )
            }
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="cq-title-sm text-(--cq-text-primary)">Requests</h3>
        {area.requests.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {founder
              ? "They haven't asked for anything yet."
              : "Ask for what you need; they see it as a checklist."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {area.requests.map((request) => {
              const status = requestStatusWords(request, sharedIds);
              return (
                <li key={request.requestId} className="flex flex-col gap-1">
                  <span className="cq-body text-(--cq-text-primary)">
                    {request.title}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {status.words}
                  </span>
                  {request.note === null ? null : (
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {request.note}
                    </span>
                  )}
                  {founder && area.open && status.answerable ? (
                    <DocumentPicker
                      documents={documents}
                      label="Answer with a document"
                      busy={busy}
                      onPick={(documentId) =>
                        void act(() =>
                          shareDiligenceAction(
                            relationshipId,
                            documentId,
                            request.requestId,
                          ),
                        )
                      }
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {!founder && area.open ? (
          <RequestForm
            busy={busy}
            onSubmit={(title, note) =>
              act(() =>
                requestDiligenceAction(
                  relationshipId,
                  { title, ...(note === null ? {} : { note }) },
                  newKey(),
                ),
              )
            }
          />
        ) : null}
      </section>
      {error === null ? null : (
        <p role="alert" className="cq-body-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function DocumentPicker({
  documents,
  label,
  busy,
  onPick,
}: {
  readonly documents: readonly Doc[];
  readonly label: string;
  readonly busy: boolean;
  readonly onPick: (documentId: string) => void;
}) {
  const id = useId();
  const [chosen, setChosen] = useState("");
  if (documents.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Upload a document in Documents to share it here.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={chosen}
        onChange={(event) => setChosen(event.target.value)}
        className="cq-body min-h-11 rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)"
      >
        <option value="">{label}…</option>
        {documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.title}
          </option>
        ))}
      </select>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={busy || chosen === ""}
        onClick={() => {
          onPick(chosen);
          setChosen("");
        }}
      >
        Share
      </Button>
    </div>
  );
}

function RequestForm({
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onSubmit: (title: string, note: string | null) => Promise<void>;
}) {
  const titleId = useId();
  const noteId = useId();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length === 0) return;
        void onSubmit(
          title.trim(),
          note.trim().length === 0 ? null : note.trim(),
        ).then(() => {
          setTitle("");
          setNote("");
        });
      }}
    >
      <label
        htmlFor={titleId}
        className="cq-body-sm text-(--cq-text-secondary)"
      >
        Ask for a document
      </label>
      <input
        id={titleId}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="e.g. Last 12 months of management accounts"
        className="cq-body min-h-11 rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)"
      />
      <label htmlFor={noteId} className="sr-only">
        Note (optional)
      </label>
      <textarea
        id={noteId}
        value={note}
        maxLength={1000}
        rows={2}
        onChange={(event) => setNote(event.target.value)}
        placeholder="A note (optional)"
        className="cq-body min-h-11 w-full resize-y rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary)"
      />
      <Button
        variant="secondary"
        className="min-h-11 self-start"
        type="submit"
        disabled={busy || title.trim().length === 0}
      >
        Ask
      </Button>
    </form>
  );
}
