"use client";

import { useId, useRef, useState } from "react";

import type { DiligenceDto } from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { cx } from "@capital-q/ui";
import {
  Download,
  Eye,
  FileText,
  ICON_SIZE,
  Upload,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { materialUploadTargetAction } from "@/features/onboarding-kit/material-actions";

import {
  diligenceDownloadAction,
  ownDocumentsAction,
  readDiligenceAction,
  requestDiligenceAction,
  revokeDiligenceAction,
  shareDiligenceAction,
  uploadAndFulfilAction,
} from "./diligence-actions";
import { NotScannedNote } from "../documents/not-scanned-note";
import { since } from "./relationships-view";

/**
 * The Diligence tab (founder critique 2026-10-04: "they requested
 * something... there's nowhere to upload it and also no way for the
 * requester to download it... Q is even supposed to be able to read the
 * content"). Each request is a card: what, who asked, when, and where it
 * stands (Requested, Shared, Viewed). The founder answers on the card:
 * Upload & share (their file goes to their Documents and answers the
 * request in one step) or Share existing. The investor opens or saves what
 * was shared, with Q's one line on it. Every change is server-confirmed
 * and the area re-read.
 */

type Doc = { readonly id: string; readonly title: string };
type DiligenceRequest = DiligenceDto["requests"][number];
type Share = DiligenceDto["shares"][number];

export type RequestStatus = {
  readonly words: "Requested" | "Shared" | "Viewed" | "Needs a new file";
  readonly tone: "waiting" | "positive" | "accent";
  /** The founder can still answer it. */
  readonly answerable: boolean;
  /** The share that answers it now, if still shared. */
  readonly share: Share | null;
};

/**
 * Where a request stands now. A request answered with a document the
 * founder later stopped sharing is open again from the investor's seat:
 * said as such, never as answered (messy real use).
 */
export function requestStatus(
  request: DiligenceRequest,
  shares: readonly Share[],
): RequestStatus {
  if (request.status !== "FULFILLED" || request.fulfilledBy === null) {
    return {
      words: "Requested",
      tone: "waiting",
      answerable: true,
      share: null,
    };
  }
  const documentId = request.fulfilledBy.documentId;
  const share = shares.find((s) => s.documentId === documentId) ?? null;
  if (share === null) {
    return {
      words: "Needs a new file",
      tone: "waiting",
      answerable: true,
      share: null,
    };
  }
  return share.viewedAt === null
    ? { words: "Shared", tone: "positive", answerable: false, share }
    : { words: "Viewed", tone: "accent", answerable: false, share };
}

const TONES: Readonly<Record<RequestStatus["tone"], string>> = {
  waiting: "bg-(--cq-warning-soft) text-(--cq-text-primary)",
  positive: "bg-(--cq-positive-soft) text-(--cq-text-primary)",
  accent: "bg-(--cq-accent-soft) text-(--cq-text-primary)",
};

function newKey(): string {
  return `web-diligence-${crypto.randomUUID()}`;
}

/** Browser → private storage, with progress; never through our servers. */
function putFile(
  target: {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
  },
  file: File,
  onProgress: (fraction: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

export function RelationshipDiligence({
  relationshipId,
  companyId,
  counterpart,
  initial,
  now,
}: {
  readonly relationshipId: string;
  readonly companyId: string;
  readonly counterpart: string;
  readonly initial: DiligenceDto;
  readonly now: number;
}) {
  const [area, setArea] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{
    readonly requestId: string;
    readonly name: string;
    readonly fraction: number;
  } | null>(null);
  const [picking, setPicking] = useState<{
    readonly requestId: string | null;
  } | null>(null);

  const founder = area.side === "COMPANY";
  const reread = async () => {
    const read = await readDiligenceAction(relationshipId);
    if (read.ok) setArea(read.value);
  };
  const act = async (
    key: string,
    work: () => Promise<
      { readonly ok: true } | { readonly ok: false; readonly message: string }
    >,
  ) => {
    setBusy(key);
    setError(null);
    const result = await work();
    if (!result.ok) setError(result.message);
    await reread();
    setBusy(null);
  };

  const uploadAndShare = async (request: DiligenceRequest, file: File) => {
    setError(null);
    setUploading({
      requestId: request.requestId,
      name: file.name,
      fraction: 0,
    });
    try {
      const target = await materialUploadTargetAction({
        companyId,
        documentType: "UNCLASSIFIED",
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!target.ok) {
        setError(target.message);
        return;
      }
      const stored = await putFile(target.value, file, (fraction) =>
        setUploading((current) =>
          current === null ? null : { ...current, fraction },
        ),
      );
      if (!stored) {
        setError(`${file.name} didn't upload. Try again.`);
        return;
      }
      const shared = await uploadAndFulfilAction(
        relationshipId,
        request.requestId,
        target.value.uploadSessionId,
        newKey(),
      );
      if (!shared.ok) setError(shared.message);
      await reread();
    } catch {
      setError(`${file.name} didn't upload. Try again.`);
    } finally {
      setUploading(null);
    }
  };

  const open = async (documentId: string, view: boolean) => {
    setError(null);
    const result = await diligenceDownloadAction(
      relationshipId,
      documentId,
      view,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    window.open(result.value.url, "_blank", "noopener");
    // Opening it is what "Viewed" means to the founder.
    if (!founder) void reread();
  };

  const answered = new Set(
    area.requests.flatMap((request) =>
      request.fulfilledBy === null ? [] : [request.fulfilledBy.documentId],
    ),
  );
  const extra = area.shares.filter((share) => !answered.has(share.documentId));
  // What waits on someone first; then the newest.
  const requests = area.requests.toSorted((a, b) => {
    const aOpen = requestStatus(a, area.shares).answerable ? 0 : 1;
    const bOpen = requestStatus(b, area.shares).answerable ? 0 : 1;
    return aOpen !== bOpen
      ? aOpen - bOpen
      : Date.parse(b.requestedAt) - Date.parse(a.requestedAt);
  });

  const fileRow = (share: Share) => (
    <FileRow
      key={share.policyId}
      share={share}
      founder={founder}
      now={now}
      busy={busy !== null}
      onOpen={(view) => void open(share.documentId, view)}
      onRevoke={() =>
        void act(`revoke:${share.policyId}`, () =>
          revokeDiligenceAction(relationshipId, share.policyId),
        )
      }
    />
  );

  return (
    <div className="flex flex-col gap-3" data-diligence>
      {!founder && area.open ? (
        <AskForm
          busy={busy === "ask"}
          onSubmit={(title, note) =>
            act("ask", () =>
              requestDiligenceAction(
                relationshipId,
                { title, ...(note === null ? {} : { note }) },
                newKey(),
              ),
            )
          }
        />
      ) : null}

      {error === null ? null : (
        <p
          role="alert"
          className="cq-body-sm rounded-lg border border-(--cq-border) bg-(--cq-surface-raised) px-3 py-2 text-(--cq-text-primary)"
        >
          {error}
        </p>
      )}

      {requests.length === 0 ? (
        <section className="flex flex-col items-start gap-2 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4">
          <h2 className="cq-title-sm text-(--cq-text-primary)">
            {founder ? "No requests yet" : "Nothing asked yet"}
          </h2>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {founder
              ? `When ${counterpart} asks for a document, it lands here.`
              : `Ask for a deck, accounts or a cap table. ${counterpart} sees it straight away.`}
          </p>
        </section>
      ) : (
        <ul aria-label="Requests" className="flex flex-col gap-3">
          {requests.map((request) => {
            const status = requestStatus(request, area.shares);
            const mine = uploading?.requestId === request.requestId;
            return (
              <li key={request.requestId}>
                <article
                  aria-label={request.title}
                  className="flex flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 shadow-(--cq-shadow-xs)"
                  data-request={status.words}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <h3 className="cq-body font-semibold text-(--cq-text-primary)">
                        {request.title}
                      </h3>
                      <p className="cq-body-sm text-(--cq-text-secondary)">
                        {founder
                          ? `${request.requestedByName ?? counterpart} asked`
                          : "You asked"}{" "}
                        ·{" "}
                        <time dateTime={request.requestedAt}>
                          {since(request.requestedAt, now)}
                        </time>
                      </p>
                    </div>
                    <span
                      className={cx(
                        "cq-caption shrink-0 rounded-full px-2.5 py-1",
                        TONES[status.tone],
                      )}
                    >
                      {status.words}
                    </span>
                  </div>
                  {request.note === null ? null : (
                    <p className="cq-body-sm border-l-2 border-(--cq-border) pl-3 text-(--cq-text-secondary)">
                      {request.note}
                    </p>
                  )}
                  {status.share === null ? null : fileRow(status.share)}
                  {mine && uploading !== null ? (
                    <UploadProgress
                      name={uploading.name}
                      fraction={uploading.fraction}
                    />
                  ) : null}
                  {founder && area.open && status.answerable && !mine ? (
                    <div className="flex gap-2">
                      <UploadButton
                        disabled={busy !== null || uploading !== null}
                        label={`Upload & share ${request.title}`}
                        onFile={(file) => void uploadAndShare(request, file)}
                      />
                      <Button
                        variant="secondary"
                        className="flex-1 sm:flex-none"
                        disabled={busy !== null || uploading !== null}
                        onClick={() =>
                          setPicking({ requestId: request.requestId })
                        }
                      >
                        <FileText size={ICON_SIZE.compact} aria-hidden="true" />
                        Share existing
                      </Button>
                    </div>
                  ) : null}
                  {!founder && status.answerable ? (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      Waiting on {counterpart}.
                    </p>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {extra.length > 0 || (founder && area.open) ? (
        <section
          aria-labelledby="also-shared"
          className="flex flex-col gap-2 pt-2"
        >
          <h2 id="also-shared" className="cq-title-sm text-(--cq-text-primary)">
            {founder ? "Also shared" : "Also shared with you"}
          </h2>
          {extra.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Only what you share here, and only with {counterpart}.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {extra.map((share) => (
                <li key={share.policyId}>{fileRow(share)}</li>
              ))}
            </ul>
          )}
          {founder && area.open ? (
            <Button
              variant="secondary"
              className="self-start"
              disabled={busy !== null || uploading !== null}
              onClick={() => setPicking({ requestId: null })}
            >
              <FileText size={ICON_SIZE.compact} aria-hidden="true" />
              Share a document
            </Button>
          ) : null}
        </section>
      ) : null}

      {founder ? (
        <SharePicker
          open={picking !== null}
          companyId={companyId}
          busy={busy !== null}
          onClose={() => setPicking(null)}
          onPick={(documentId) => {
            const requestId = picking?.requestId ?? null;
            setPicking(null);
            void act(`share:${documentId}`, () =>
              shareDiligenceAction(relationshipId, documentId, requestId),
            );
          }}
        />
      ) : null}
    </div>
  );
}

function FileRow({
  share,
  founder,
  now,
  busy,
  onOpen,
  onRevoke,
}: {
  readonly share: Share;
  readonly founder: boolean;
  readonly now: number;
  readonly busy: boolean;
  readonly onOpen: (view: boolean) => void;
  readonly onRevoke: () => void;
}) {
  return (
    <div
      className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg bg-(--cq-surface-subtle) p-3 sm:grid-cols-[36px_minmax(0,1fr)_auto]"
      data-shared-file
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-9 items-center justify-center rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-raised) text-(--cq-text-secondary)"
      >
        <FileText size={ICON_SIZE.compact} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="cq-body-sm truncate font-semibold text-(--cq-text-primary)">
          {share.title}
        </span>
        <span className="cq-caption text-(--cq-text-tertiary)">
          Shared {since(share.sharedAt, now)}
          {share.viewedAt === null
            ? ""
            : ` · opened ${since(share.viewedAt, now)}`}
        </span>
        {share.scanned ? null : <NotScannedNote />}
      </span>
      <span className="col-span-2 flex gap-2 sm:col-span-1">
        {founder ? (
          <Button
            variant="quiet"
            size="compact"
            disabled={busy}
            onClick={onRevoke}
          >
            Stop sharing
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              size="compact"
              className="flex-1 sm:flex-none"
              onClick={() => onOpen(true)}
            >
              <Eye size={ICON_SIZE.compact} aria-hidden="true" />
              View
            </Button>
            <Button
              variant="secondary"
              size="compact"
              className="flex-1 sm:flex-none"
              onClick={() => onOpen(false)}
            >
              <Download size={ICON_SIZE.compact} aria-hidden="true" />
              Download
            </Button>
          </>
        )}
      </span>
      {share.qSummary === null ? null : (
        <p
          className="cq-body-sm col-span-2 flex items-start gap-2 sm:col-span-3"
          data-q-summary
        >
          <span
            aria-hidden="true"
            className="mt-1 size-3 shrink-0 rounded-full border-2 border-(--cq-q-light)"
          />
          <span>
            <span className="font-semibold text-(--cq-text-primary)">
              Q&apos;s summary
            </span>{" "}
            <span className="text-(--cq-text-secondary)">{share.qSummary}</span>
          </span>
        </p>
      )}
    </div>
  );
}

function UploadButton({
  disabled,
  label,
  onFile,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="primary"
        className="flex-1 sm:flex-none"
        disabled={disabled}
        aria-label={label}
        onClick={() => input.current?.click()}
      >
        <Upload size={ICON_SIZE.compact} aria-hidden="true" />
        Upload &amp; share
      </Button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) onFile(file);
        }}
      />
    </>
  );
}

function UploadProgress({
  name,
  fraction,
}: {
  readonly name: string;
  readonly fraction: number;
}) {
  const percent = Math.round(fraction * 100);
  return (
    <div className="flex flex-col gap-1.5" role="status">
      <span className="cq-body-sm text-(--cq-text-secondary)">
        {percent >= 100
          ? `Sharing ${name}…`
          : `Uploading ${name} · ${String(percent)}%`}
      </span>
      <span
        aria-hidden="true"
        className="h-1 overflow-hidden rounded-full bg-(--cq-surface-strong)"
      >
        <span
          className="block h-full bg-(--cq-accent) transition-[width] duration-(--cq-motion-base)"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
    </div>
  );
}

function SharePicker({
  open,
  companyId,
  busy,
  onClose,
  onPick,
}: {
  readonly open: boolean;
  readonly companyId: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onPick: (documentId: string) => void;
}) {
  const name = useId();
  const [documents, setDocuments] = useState<readonly Doc[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const load = () => {
    setFailed(false);
    void ownDocumentsAction(companyId).then((result) => {
      if (result.ok) setDocuments(result.value);
      else setFailed(true);
    });
  };
  return (
    <SheetRoot
      open={open}
      onOpenChange={(next) => {
        if (next && documents === null) load();
        if (!next) {
          setChosen(null);
          onClose();
        }
      }}
    >
      <SheetContent title="Share existing" side="bottom">
        <div className="flex flex-col gap-3 p-4">
          {failed ? (
            <div className="flex items-center justify-between gap-3">
              <p className="cq-body-sm text-(--cq-text-secondary)">
                Your documents didn&apos;t load.
              </p>
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          ) : documents === null ? (
            <ul aria-busy="true" className="flex flex-col gap-2">
              {[0, 1, 2].map((n) => (
                <li
                  key={n}
                  className="h-12 animate-pulse rounded-lg bg-(--cq-surface-subtle) motion-reduce:animate-none"
                />
              ))}
            </ul>
          ) : documents.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              No documents yet. Use Upload &amp; share instead.
            </p>
          ) : (
            <fieldset className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
              <legend className="sr-only">Your documents</legend>
              {documents.map((document) => (
                <label
                  key={document.id}
                  className={cx(
                    "cq-body-sm flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3",
                    chosen === document.id
                      ? "bg-(--cq-accent-soft)"
                      : "hover:bg-(--cq-surface-subtle)",
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={document.id}
                    checked={chosen === document.id}
                    onChange={() => setChosen(document.id)}
                    className="size-4 accent-(--cq-accent)"
                  />
                  <FileText
                    size={ICON_SIZE.compact}
                    aria-hidden="true"
                    className="text-(--cq-text-tertiary)"
                  />
                  <span className="min-w-0 flex-1 truncate text-(--cq-text-primary)">
                    {document.title}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClassName("secondary", "regular", "flex-1")}
              onClick={() => {
                setChosen(null);
                onClose();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={buttonClassName("primary", "regular", "flex-1")}
              disabled={busy || chosen === null}
              onClick={() => {
                if (chosen !== null) onPick(chosen);
                setChosen(null);
              }}
            >
              Share
            </button>
          </div>
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

function AskForm({
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
  const [withNote, setWithNote] = useState(false);
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-3 shadow-(--cq-shadow-xs)"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length === 0) return;
        void onSubmit(
          title.trim(),
          note.trim().length === 0 ? null : note.trim(),
        ).then(() => {
          setTitle("");
          setNote("");
          setWithNote(false);
        });
      }}
    >
      <div className="flex gap-2">
        <label htmlFor={titleId} className="sr-only">
          Ask for a document
        </label>
        <input
          id={titleId}
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ask for a document"
          className="cq-body min-h-11 min-w-0 flex-1 rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)"
        />
        <Button
          variant="primary"
          type="submit"
          disabled={busy || title.trim().length === 0}
        >
          Ask
        </Button>
      </div>
      {withNote ? (
        <>
          <label htmlFor={noteId} className="sr-only">
            Note
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={1000}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            placeholder="A note for them"
            className="cq-body min-h-11 w-full resize-y rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary)"
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => setWithNote(true)}
          className="cq-body-sm inline-flex min-h-11 items-center self-start text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
        >
          Add a note
        </button>
      )}
    </form>
  );
}
