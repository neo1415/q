"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  DATA_ROOM_GRANT_DAYS,
  DATA_ROOM_GRANT_DEFAULT_DAYS,
  DOCUMENT_ACCESS_LEVEL_WORDS,
  type DataRoomFolder,
  type DocumentAccessLevel,
  type DocumentRequestItem,
  type InvestorQuestion,
  type QuestionSetItem,
  type RequestInboxDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { FileText, ICON_SIZE, Plus, Upload } from "@capital-q/ui/icons";

import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "@/features/onboarding-kit/material-actions";

import { documentTypeForFile } from "../library-model";
import {
  answerQuestionAction,
  declineRequestAction,
  fulfilRequestAction,
  loadInboxAction,
  newAnswerKey,
} from "./request-actions";
import {
  inboxFilterOf,
  initials,
  shortDate,
  waitingWords,
  type InboxFilter,
} from "./requests-model";

/**
 * The Requested tab (founder documents, 2026-10-08; design
 * docs/design/2026-10-08/founder-docs): everything investors asked the
 * company for, open first. Each request says who, what, why (their note)
 * and since when; it is answered here: upload and share (the documents
 * screen's own upload path, filed in the data room, shared with that
 * investor only), share a document the company has, or decline with a
 * note they see. Questions are answered inline, as the founder's own
 * claim, with documents as support. A notification opens one item here
 * (`?item=`), scrolled to and open.
 */

export type OwnDocument = {
  readonly documentId: string;
  readonly title: string;
};

const FILTERS: readonly (readonly [InboxFilter, string])[] = [
  ["OPEN", "Open"],
  ["ANSWERED", "Answered"],
  ["DECLINED", "Declined"],
];

const selectClass =
  "cq-body-sm min-h-11 w-full rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)";

/** Upload one file through the documents screen's own three steps. */
async function uploadFile(
  companyId: string,
  file: File,
): Promise<{ readonly documentId: string } | { readonly error: string }> {
  const target = await materialUploadTargetAction({
    companyId,
    documentType: documentTypeForFile(file.name),
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });
  if (!target.ok) return { error: target.message };
  const stored = await fetch(target.value.url, {
    method: target.value.method,
    headers: target.value.headers,
    body: file,
  })
    .then((response) => response.ok)
    .catch(() => false);
  if (!stored) return { error: "The upload stopped. Try again." };
  const completed = await materialUploadCompleteAction(
    target.value.uploadSessionId,
  );
  return completed.ok
    ? { documentId: completed.value.documentId }
    : { error: completed.message };
}

function Who({
  name,
  organisation,
  detail,
  title,
}: {
  readonly name: string | null;
  readonly organisation: string | null;
  readonly detail: string;
  readonly title: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        className="cq-caption grid size-9 shrink-0 place-items-center rounded-full bg-(--cq-surface-subtle) font-semibold text-(--cq-text-secondary)"
      >
        {initials(organisation ?? name)}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="cq-body font-semibold text-(--cq-text-primary)">
          {title}
        </h3>
        <p className="cq-caption text-(--cq-text-secondary)">
          {[name, organisation ?? "An investor", detail]
            .filter((part): part is string => part !== null && part !== "")
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

function Chip({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="cq-caption inline-flex shrink-0 items-center rounded-full bg-(--cq-surface-subtle) px-2 py-0.5 text-(--cq-text-secondary)">
      {children}
    </span>
  );
}

function DocumentRequestCard({
  item,
  companyId,
  folders,
  documents,
  focused,
  onChanged,
}: {
  readonly item: DocumentRequestItem;
  readonly companyId: string;
  readonly folders: readonly DataRoomFolder[];
  readonly documents: readonly OwnDocument[];
  readonly focused: boolean;
  readonly onChanged: (message: string) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const [folder, setFolder] = useState(item.dataRoom?.folderCode ?? "other");
  const [level, setLevel] = useState<DocumentAccessLevel>("view");
  const [days, setDays] = useState<number>(DATA_ROOM_GRANT_DEFAULT_DAYS);
  const [mode, setMode] = useState<"NONE" | "PICK" | "DECLINE">("NONE");
  const [picked, setPicked] = useState(item.dataRoom?.documentId ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const folderWords = (code: string) =>
    folders.find((candidate) => candidate.code === code)?.label ?? code;
  const who = item.investorOrganisationName ?? "this investor";

  const share = async (documentId: string) => {
    setBusy("Sharing…");
    const out = await fulfilRequestAction(item.requestId, {
      source: item.source,
      documentId,
      folderCode: folder,
      accessLevel: level,
      days,
    });
    setBusy(null);
    if (out.ok) onChanged(`Shared with ${who}. They've been told.`);
    else setError(out.message);
  };

  const uploadAndShare = async (chosen: File) => {
    setError(null);
    setBusy(`Uploading ${chosen.name}…`);
    const uploaded = await uploadFile(companyId, chosen);
    if ("error" in uploaded) {
      setBusy(null);
      setError(uploaded.error);
      return;
    }
    await share(uploaded.documentId);
  };

  const decline = async () => {
    setBusy("Declining…");
    const out = await declineRequestAction(item.requestId, {
      source: item.source,
      note: note.trim() === "" ? null : note.trim(),
    });
    setBusy(null);
    if (out.ok) onChanged(`Declined. ${who} has been told.`);
    else setError(out.message);
  };

  const open = item.status === "OPEN";
  return (
    <article
      id={`request-${item.itemId}`}
      tabIndex={-1}
      aria-label={`Request from ${who}: ${item.title}`}
      className={`flex flex-col gap-3 rounded-xl border bg-(--cq-surface-raised) p-4 outline-none ${focused ? "border-(--cq-accent) ring-2 ring-(--cq-accent-soft)" : "border-(--cq-border-subtle)"}`}
      data-request-item={item.itemId}
      data-request-status={item.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Who
          name={item.requesterName}
          organisation={item.investorOrganisationName}
          title={item.title}
          detail={`asked ${shortDate(item.requestedAt)}${open ? ` · ${waitingWords(item.requestedAt, now)}` : ""}${item.source === "DATA_ROOM" ? " · from your data room" : ""}`}
        />
        {item.dataRoom === null ? (
          <Chip>Document</Chip>
        ) : (
          <Chip>In data room · {folderWords(item.dataRoom.folderCode)}</Chip>
        )}
      </div>
      {item.note === null ? null : (
        <p className="cq-body-sm border-l-2 border-(--cq-border) pl-3 text-(--cq-text-secondary)">
          “{item.note}”
        </p>
      )}

      {item.status === "SHARED" ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Shared
          {item.sharedDocument === null ? "" : `: ${item.sharedDocument.title}`}
          {item.accessEndsAt === null
            ? "."
            : `, until ${shortDate(item.accessEndsAt)}.`}
        </p>
      ) : null}
      {item.status === "DECLINED" ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Declined
          {item.declineNote === null ? "." : `: “${item.declineNote}”`}
        </p>
      ) : null}

      {open ? (
        <>
          <div className="grid gap-3 border-t border-(--cq-border-subtle) pt-3 sm:grid-cols-3">
            <label className="cq-caption flex flex-col gap-1 text-(--cq-text-secondary)">
              File in
              <select
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                className={selectClass}
              >
                {folders.map((candidate) => (
                  <option key={candidate.code} value={candidate.code}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cq-caption flex flex-col gap-1 text-(--cq-text-secondary)">
              They can
              <select
                value={level}
                onChange={(event) =>
                  setLevel(event.target.value as DocumentAccessLevel)
                }
                className={selectClass}
              >
                <option value="view">{DOCUMENT_ACCESS_LEVEL_WORDS.view}</option>
                <option value="view_download">
                  {DOCUMENT_ACCESS_LEVEL_WORDS.view_download}
                </option>
              </select>
            </label>
            <label className="cq-caption flex flex-col gap-1 text-(--cq-text-secondary)">
              For
              <select
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className={selectClass}
              >
                {DATA_ROOM_GRANT_DAYS.map((n) => (
                  <option key={n} value={n}>
                    {n} days
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Only {who} will see it. You can take it back at any time.
          </p>
          <input
            ref={file}
            type="file"
            hidden
            data-request-file
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (chosen !== undefined) void uploadAndShare(chosen);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => file.current?.click()}
              className={buttonClassName("primary", "regular", "min-h-11")}
              data-request-upload
            >
              <Upload size={ICON_SIZE.compact} aria-hidden="true" /> Upload and
              share
            </button>
            <button
              type="button"
              disabled={busy !== null || documents.length === 0}
              onClick={() => setMode(mode === "PICK" ? "NONE" : "PICK")}
              aria-expanded={mode === "PICK"}
              className={buttonClassName("secondary", "regular", "min-h-11")}
            >
              Share a document you have
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setMode(mode === "DECLINE" ? "NONE" : "DECLINE")}
              aria-expanded={mode === "DECLINE"}
              className={buttonClassName("quiet", "regular", "min-h-11")}
            >
              Decline
            </button>
          </div>
          {mode === "PICK" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="cq-caption flex flex-1 flex-col gap-1 text-(--cq-text-secondary)">
                Document
                <select
                  value={picked}
                  onChange={(event) => setPicked(event.target.value)}
                  className={selectClass}
                  data-request-pick
                >
                  <option value="">Choose a document</option>
                  {documents.map((document) => (
                    <option
                      key={document.documentId}
                      value={document.documentId}
                    >
                      {document.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy !== null || picked === ""}
                onClick={() => void share(picked)}
                className={buttonClassName("primary", "regular", "min-h-11")}
              >
                Share
              </button>
            </div>
          ) : null}
          {mode === "DECLINE" ? (
            <div className="flex flex-col gap-2">
              <label className="cq-caption flex flex-col gap-1 text-(--cq-text-secondary)">
                A note for {who} (optional)
                <textarea
                  value={note}
                  maxLength={1000}
                  onChange={(event) => setNote(event.target.value)}
                  className="cq-body-sm min-h-20 rounded-md border border-(--cq-border) bg-(--cq-surface) p-3 text-(--cq-text-primary)"
                  placeholder="For example: after a term sheet."
                />
              </label>
              <div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decline()}
                  className={buttonClassName(
                    "secondary",
                    "regular",
                    "min-h-11",
                  )}
                  data-request-decline
                >
                  Decline request
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {busy === null ? null : (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {busy}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-danger)">
          {error}
        </p>
      )}
    </article>
  );
}

function QuestionRow({
  question,
  companyId,
  documents,
  investor,
  startOpen,
  onChanged,
}: {
  readonly question: InvestorQuestion;
  readonly companyId: string;
  readonly documents: readonly OwnDocument[];
  readonly investor: string;
  readonly startOpen: boolean;
  readonly onChanged: (message: string) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<readonly OwnDocument[]>([]);
  const [picking, setPicking] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const send = async () => {
    setError(null);
    setBusy("Sending…");
    const out = await answerQuestionAction(
      question.questionId,
      {
        answer: text.trim(),
        documentIds: attached.map((document) => document.documentId),
      },
      await newAnswerKey(),
    );
    setBusy(null);
    if (out.ok) onChanged(`Answer sent. ${investor} has been told.`);
    else setError(out.message);
  };

  const attachUpload = async (chosen: File) => {
    setBusy(`Uploading ${chosen.name}…`);
    const uploaded = await uploadFile(companyId, chosen);
    setBusy(null);
    if ("error" in uploaded) setError(uploaded.error);
    else
      setAttached((now) => [
        ...now,
        { documentId: uploaded.documentId, title: chosen.name },
      ]);
  };

  return (
    <li
      className="flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-3 first:border-t-0 first:pt-0"
      data-question={question.questionId}
      data-question-answered={question.answer !== null}
    >
      <p className="cq-body text-(--cq-text-primary)">
        <span className="font-semibold">{question.position}.</span>{" "}
        {question.question}
      </p>
      {question.assumptionLabel === null ? null : (
        <p className="cq-caption text-(--cq-text-tertiary)">
          About: {question.assumptionLabel}
        </p>
      )}
      {question.answer !== null ? (
        <div className="flex flex-col gap-1 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) p-3">
          <p className="cq-caption text-(--cq-text-tertiary)">
            Your answer, {shortDate(question.answer.answeredAt)} ·{" "}
            {question.answer.evidenceStatus === "DOCUMENT_SUPPORTED"
              ? "your claim, with a document"
              : "your claim"}
          </p>
          <p className="cq-body-sm text-(--cq-text-primary)">
            {question.answer.text}
          </p>
          {question.answer.documents.map((document) => (
            <p
              key={document.documentId}
              className="cq-caption inline-flex items-center gap-1 text-(--cq-text-secondary)"
            >
              <FileText size={ICON_SIZE.compact} aria-hidden="true" />
              {document.title}
            </p>
          ))}
        </div>
      ) : !open ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={buttonClassName("secondary", "compact", "min-h-11")}
            data-question-answer-open
          >
            Answer
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor={`answer-${question.questionId}`}>
            Your answer
          </label>
          <textarea
            id={`answer-${question.questionId}`}
            value={text}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            placeholder="Your answer, in your words."
            className="cq-body-sm min-h-24 rounded-md border border-(--cq-border) bg-(--cq-surface) p-3 text-(--cq-text-primary)"
            data-question-text
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={file}
              type="file"
              hidden
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (chosen !== undefined) void attachUpload(chosen);
              }}
            />
            <button
              type="button"
              disabled={busy !== null || attached.length >= 5}
              onClick={() => file.current?.click()}
              className={buttonClassName("secondary", "compact", "min-h-11")}
            >
              <Plus size={ICON_SIZE.compact} aria-hidden="true" /> Attach
              evidence
            </button>
            {documents.length === 0 ? null : (
              <label className="cq-caption flex items-center gap-1 text-(--cq-text-secondary)">
                <span className="sr-only">Attach a document you have</span>
                <select
                  value={picking}
                  onChange={(event) => {
                    const chosen = documents.find(
                      (document) => document.documentId === event.target.value,
                    );
                    setPicking("");
                    if (
                      chosen !== undefined &&
                      !attached.some((a) => a.documentId === chosen.documentId)
                    )
                      setAttached((now) => [...now, chosen].slice(0, 5));
                  }}
                  className="cq-body-sm min-h-11 rounded-md border border-(--cq-border) bg-(--cq-surface) px-2 text-(--cq-text-primary)"
                >
                  <option value="">Or one you have…</option>
                  {documents.map((document) => (
                    <option
                      key={document.documentId}
                      value={document.documentId}
                    >
                      {document.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {attached.map((document) => (
              <span
                key={document.documentId}
                className="cq-caption inline-flex items-center gap-1 rounded-full bg-(--cq-surface-subtle) px-2 py-0.5 text-(--cq-text-secondary)"
              >
                {document.title}
                <button
                  type="button"
                  aria-label={`Remove ${document.title}`}
                  onClick={() =>
                    setAttached((now) =>
                      now.filter((a) => a.documentId !== document.documentId),
                    )
                  }
                  className="min-h-6 px-1"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy !== null || text.trim() === ""}
              onClick={() => void send()}
              className={buttonClassName("primary", "regular", "min-h-11")}
              data-question-send
            >
              Send answer
            </button>
            <p className="cq-caption text-(--cq-text-tertiary)">
              {attached.length > 0
                ? `Recorded as your claim, supported by ${attached.length === 1 ? "the document" : "the documents"}. ${investor} is told and can open ${attached.length === 1 ? "it" : "them"}, view only.`
                : `Recorded as your claim. ${investor} is told.`}
            </p>
          </div>
        </div>
      )}
      {busy === null ? null : (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {busy}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-danger)">
          {error}
        </p>
      )}
    </li>
  );
}

function QuestionSetCard({
  item,
  companyId,
  documents,
  focused,
  onChanged,
}: {
  readonly item: QuestionSetItem;
  readonly companyId: string;
  readonly documents: readonly OwnDocument[];
  readonly focused: boolean;
  readonly onChanged: (message: string) => void;
}) {
  const count = item.questions.length;
  const investor = item.investorOrganisationName ?? "The investor";
  const fromBoard = item.questions.some((q) => q.assumptionId !== null);
  return (
    <article
      id={`request-${item.itemId}`}
      tabIndex={-1}
      aria-label={`Questions from ${investor}`}
      className={`flex flex-col gap-3 rounded-xl border bg-(--cq-surface-raised) p-4 outline-none ${focused ? "border-(--cq-accent) ring-2 ring-(--cq-accent-soft)" : "border-(--cq-border-subtle)"}`}
      data-request-item={item.itemId}
      data-request-kind="QUESTIONS"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Who
          name={item.requesterName}
          organisation={item.investorOrganisationName}
          title={
            count === 1
              ? `A question from ${investor}`
              : `${String(count)} questions from ${investor}`
          }
          detail={`${fromBoard ? "from “Assumptions to test” · " : ""}asked ${shortDate(item.askedAt)}`}
        />
        <Chip>Questions</Chip>
      </div>
      <ol className="flex flex-col gap-3">
        {item.questions.map((question, index) => (
          <QuestionRow
            key={question.questionId}
            question={question}
            companyId={companyId}
            documents={documents}
            investor={investor}
            startOpen={
              focused &&
              question.answer === null &&
              item.questions.findIndex((q) => q.answer === null) === index
            }
            onChanged={onChanged}
          />
        ))}
      </ol>
    </article>
  );
}

export function RequestsInbox({
  companyId,
  initial,
  documents,
  focusItem = null,
}: {
  readonly companyId: string;
  /** Null when the inbox could not be read. */
  readonly initial: RequestInboxDto | null;
  readonly documents: readonly OwnDocument[];
  /** A notification's `?item=`: opened, scrolled to and focused. */
  readonly focusItem?: string | null;
}) {
  const [inbox, setInbox] = useState(initial);
  const focused = inbox?.items.find((item) => item.itemId === focusItem);
  const [filter, setFilter] = useState<InboxFilter>(
    focused === undefined ? "OPEN" : inboxFilterOf(focused),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if (focusItem === null) return;
    const element = document.getElementById(`request-${focusItem}`);
    if (element === null) return;
    element.scrollIntoView({ block: "center" });
    element.focus({ preventScroll: true });
  }, [focusItem]);

  const changed = (words: string) => {
    setMessage(words);
    start(async () => {
      const next = await loadInboxAction(companyId);
      if (next.ok) setInbox(next.value);
    });
  };

  if (inbox === null) {
    return (
      <p className="cq-body text-(--cq-text-secondary)" role="status">
        Requests couldn&apos;t load. Try again in a moment.
      </p>
    );
  }
  const counts = {
    OPEN: inbox.counts.open,
    ANSWERED: inbox.counts.answered,
    DECLINED: inbox.counts.declined,
  };
  const shown = inbox.items.filter((item) => inboxFilterOf(item) === filter);

  return (
    <section
      className="flex flex-col gap-4"
      aria-label="Requested"
      data-requests-inbox
    >
      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={
              filter === value
                ? "min-h-11 rounded-full bg-(--cq-text-primary) px-3.5 cq-body-sm text-(--cq-canvas) lg:min-h-9"
                : "min-h-11 rounded-full border border-(--cq-border-subtle) px-3.5 cq-body-sm text-(--cq-text-secondary) hover:border-(--cq-border-strong) lg:min-h-9"
            }
            data-requests-filter={value}
          >
            {label} · {counts[value]}
          </button>
        ))}
      </div>
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="cq-body text-(--cq-text-secondary)">
          {filter === "OPEN"
            ? "Nothing waiting for you. When an investor asks for a document or sends a question, it shows here."
            : filter === "ANSWERED"
              ? "Nothing answered yet."
              : "Nothing declined."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((item) =>
            item.kind === "DOCUMENT_REQUEST" ? (
              <DocumentRequestCard
                key={item.itemId}
                item={item}
                companyId={companyId}
                folders={inbox.folders}
                documents={documents}
                focused={item.itemId === focusItem}
                onChanged={changed}
              />
            ) : (
              <QuestionSetCard
                key={item.itemId}
                item={item}
                companyId={companyId}
                documents={documents}
                focused={item.itemId === focusItem}
                onChanged={changed}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}
