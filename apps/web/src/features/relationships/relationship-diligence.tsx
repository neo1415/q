"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { DiligenceDto } from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { cx } from "@capital-q/ui";
import {
  Check,
  CircleHelp,
  Clock,
  Download,
  FileText,
  ICON_SIZE,
  Lock,
  Plus,
  Upload,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { sendChatMessageAction } from "@/features/chat/chat-actions";
import { Watermark } from "@/features/company/material/file-viewer";
import { fitQViewAction } from "@/features/fit/fit-actions";
import { materialUploadTargetAction } from "@/features/onboarding-kit/material-actions";

import {
  diligenceDownloadAction,
  diligenceViewAction,
  ownDocumentsAction,
  readDiligenceAction,
  requestDiligenceAction,
  revokeDiligenceAction,
  shareDiligenceAction,
  uploadAndFulfilAction,
} from "./diligence-actions";
import { NotScannedNote } from "../documents/not-scanned-note";
import { dealDay } from "./deal-stage-strip";
import { QCircle, QLine, RecordSheet, Tag } from "./record-parts";
import { since } from "./relationships-view";
import { useT } from "@/features/i18n/language";

/**
 * The Diligence tab as the CRM prototype's request checklist (diligence
 * option 1, owner 2026-10-20): one row per request, each saying in words
 * and with an icon whether it was shared, is waiting, or was not asked
 * yet, with one line under it -- Q's summary of what was shared, or what
 * the request stands on. The investor opens what was shared in place,
 * watermarked with their own name, asks for what is missing (Q's open
 * questions are offered first, labelled as Q's), and may remind the
 * company of a request in their conversation, with the exact words shown
 * before anything is sent. The founder answers on the row: Upload & share
 * or Share existing. Every change is server-confirmed and the area re-read.
 */

type Doc = { readonly id: string; readonly title: string };
type DiligenceRequest = DiligenceDto["requests"][number];
type Share = DiligenceDto["shares"][number];

export type RequestStatus = {
  readonly words:
    | "Requested"
    | "Shared"
    | "Viewed"
    | "Needs a new file"
    | "Declined"
    | "Answered"
    | `Answered ${string} of ${string}`;
  readonly tone: "waiting" | "positive" | "accent" | "neutral";
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
  // 2026-10-08: the founder said no, with a note the investor reads.
  if (request.status === "DECLINED") {
    return {
      words: "Declined",
      tone: "neutral",
      answerable: false,
      share: null,
    };
  }
  // 2026-10-08: a request that carried the investor's questions stands
  // where its answers stand (it was showing "Requested" after answers
  // arrived). The founder answers its questions, not with a file.
  const questions = request.questions ?? [];
  if (
    questions.length > 0 &&
    (request.status !== "FULFILLED" || request.fulfilledBy === null)
  ) {
    const answered = questions.filter((q) => q.answer !== null).length;
    if (answered > 0)
      return {
        words:
          answered >= questions.length
            ? "Answered"
            : `Answered ${String(answered)} of ${String(questions.length)}`,
        tone: answered >= questions.length ? "positive" : "waiting",
        answerable: false,
        share: null,
      };
  }
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

/** The checklist's three counts: shared, waiting, not asked. */
export function checklistCounts(
  area: Pick<DiligenceDto, "requests" | "shares">,
  notAsked: number,
): {
  readonly shared: number;
  readonly waiting: number;
  readonly notAsked: number;
  readonly answered: number;
  readonly asked: number;
} {
  const statuses = area.requests.map((r) => requestStatus(r, area.shares));
  const answered = statuses.filter(
    (s) => s.share !== null || s.words === "Answered",
  ).length;
  const waiting = statuses.filter((s) => s.answerable).length;
  const fulfilledDocs = new Set(
    area.requests.flatMap((r) =>
      r.fulfilledBy === null ? [] : [r.fulfilledBy.documentId],
    ),
  );
  const extra = area.shares.filter((s) => !fulfilledDocs.has(s.documentId));
  return {
    shared: statuses.filter((s) => s.share !== null).length + extra.length,
    waiting,
    notAsked,
    answered,
    asked: area.requests.length,
  };
}

/**
 * Q's open questions that are not asked yet: a question already asked,
 * by the same words, is not offered again.
 */
export function openQuestionsNotAsked(
  questions: readonly string[],
  requests: readonly Pick<DiligenceRequest, "title">[],
): readonly string[] {
  const asked = new Set(requests.map((r) => r.title.trim().toLowerCase()));
  return questions
    .map((question) => question.trim())
    .filter((question) => question !== "" && !asked.has(question.toLowerCase()));
}

/**
 * The questions a request carried, each with the founder's answer (their
 * claim, never verified fact), linked to the assumption card it tests.
 */
function QuestionAnswers({
  questions,
  companyId,
  founder,
  counterpart,
}: {
  readonly questions: NonNullable<DiligenceRequest["questions"]>;
  readonly companyId: string;
  readonly founder: boolean;
  readonly counterpart: string;
}) {
  const t = useT();

  return (
    <ol className="flex flex-col gap-3" data-request-questions>
      {questions.map((question) => (
        <li
          key={question.questionId}
          className="flex flex-col gap-1 border-s-2 border-(--cq-border) ps-3"
          data-question-answered={question.answer === null ? "no" : "yes"}
        >
          <p className="cq-body-sm text-(--cq-text-primary)">
            {t(question.question)}
          </p>
          {question.answer === null ? (
            <p className="cq-caption text-(--cq-text-tertiary)">
              {founder
                ? t("Not answered yet.")
                : t(`Waiting on ${counterpart}.`)}
            </p>
          ) : (
            <>
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {question.answer.text}
              </p>
              <p className="cq-caption text-(--cq-text-tertiary)">
                {founder ? t("Your answer") : t(`${counterpart}'s answer`)} ·{" "}
                {question.answer.evidenceStatus === "DOCUMENT_SUPPORTED"
                  ? "with a document"
                  : t("their own words, not verified")}
              </p>
            </>
          )}
          {question.assumptionLabel === null ? null : (
            <Link
              href={`/company/${encodeURIComponent(companyId)}#assumptions`}
              className="cq-caption inline-flex min-h-11 items-center self-start text-(--cq-text-secondary) underline underline-offset-2 hover:text-(--cq-text-primary)"
            >
              {t("On the assumptions card:")} {t(question.assumptionLabel)}
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}

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

/** The header's "Ask for a document" opens the tab's own sheet. */
const ASK_EVENT = "cq:diligence-ask";

/**
 * The Diligence tab's header action (prototype: the primary button beside
 * the state). It asks the checklist below to open its sheet.
 */
export function DiligenceAskButton() {
  const t = useT();
  return (
    <Button
      variant="primary"
      onClick={() => window.dispatchEvent(new CustomEvent(ASK_EVENT))}
    >
      <Plus size={ICON_SIZE.compact} aria-hidden="true" />
      {t("Ask for a document")}
    </Button>
  );
}

type Row =
  | {
      readonly kind: "REQUEST";
      readonly key: string;
      readonly request: DiligenceRequest;
      readonly status: RequestStatus;
    }
  | { readonly kind: "SHARE"; readonly key: string; readonly share: Share }
  | { readonly kind: "OPEN"; readonly key: string; readonly question: string };

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
  const t = useT();

  const [area, setArea] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{
    readonly requestId: string;
    readonly name: string;
    readonly fraction: number;
  } | null>(null);
  const [picking, setPicking] = useState<{
    readonly requestId: string | null;
  } | null>(null);
  const [asking, setAsking] = useState<{ readonly preset: string } | null>(
    null,
  );
  const [viewing, setViewing] = useState<Share | null>(null);
  const [reminding, setReminding] = useState<DiligenceRequest | null>(null);
  // Q's open questions on this company, asked after the list has rendered,
  // never on the critical path; unknown when Q has no view.
  const [questions, setQuestions] = useState<readonly string[]>([]);

  const founder = area.side === "COMPANY";

  useEffect(() => {
    if (founder) return;
    let live = true;
    void fitQViewAction(companyId)
      .then((view) => {
        if (live && view !== null && view.status === "READY") {
          setQuestions(view.unknowns);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [companyId, founder]);

  useEffect(() => {
    if (founder || !area.open) return;
    const open = () => setAsking({ preset: "" });
    window.addEventListener(ASK_EVENT, open);
    return () => window.removeEventListener(ASK_EVENT, open);
  }, [founder, area.open]);

  const reread = async () => {
    const read = await readDiligenceAction(relationshipId);
    if (read.ok) setArea(read.value);
  };
  const act = async (
    key: string,
    work: () => Promise<
      { readonly ok: true } | { readonly ok: false; readonly message: string }
    >,
  ): Promise<boolean> => {
    setBusy(key);
    setError(null);
    const result = await work();
    if (!result.ok) setError(result.message);
    await reread();
    setBusy(null);
    return result.ok;
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

  const download = async (documentId: string) => {
    setError(null);
    const result = await diligenceDownloadAction(
      relationshipId,
      documentId,
      false,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    window.open(result.value.url, "_blank", "noopener");
    if (!founder) void reread();
  };

  const answeredDocs = new Set(
    area.requests.flatMap((request) =>
      request.fulfilledBy === null ? [] : [request.fulfilledBy.documentId],
    ),
  );
  const extra = area.shares.filter(
    (share) => !answeredDocs.has(share.documentId),
  );
  const notAsked = founder
    ? []
    : openQuestionsNotAsked(questions, area.requests);
  // What waits on someone first; then the newest.
  const requests = area.requests.toSorted((a, b) => {
    const aOpen = requestStatus(a, area.shares).answerable ? 1 : 0;
    const bOpen = requestStatus(b, area.shares).answerable ? 1 : 0;
    return aOpen !== bOpen
      ? aOpen - bOpen
      : Date.parse(b.requestedAt) - Date.parse(a.requestedAt);
  });
  // Shared first, then waiting, then what was not asked (prototype order).
  const rows: readonly Row[] = [
    ...requests
      .map(
        (request): Row => ({
          kind: "REQUEST",
          key: request.requestId,
          request,
          status: requestStatus(request, area.shares),
        }),
      )
      .toSorted(
        (a, b) =>
          (a.kind === "REQUEST" && a.status.share !== null ? 0 : 1) -
          (b.kind === "REQUEST" && b.status.share !== null ? 0 : 1),
      ),
    ...extra.map((share): Row => ({
      kind: "SHARE",
      key: share.policyId,
      share,
    })),
    ...notAsked.map((question): Row => ({
      kind: "OPEN",
      key: `open:${question}`,
      question,
    })),
  ];
  const counts = checklistCounts(area, notAsked.length);

  return (
    <div className="flex flex-col gap-4" data-diligence>
      {founder ? (
        // Owner 2026-10-15: when an investor asks for something, the
        // founder's own data room and deck are one step away from here.
        <p className="cq-body-sm flex flex-wrap items-center justify-between gap-x-3 text-(--cq-text-secondary)">
          <span>{t("Shares come from your data room.")}</span>
          <Link
            href="/company/data-room"
            className="inline-flex min-h-11 items-center text-(--cq-text-primary) underline underline-offset-2"
            data-own-data-room
          >
            {t("Edit data room & deck")}
          </Link>
        </p>
      ) : counts.asked === 0 ? null : (
        <QLine note={t("From your requests and what was shared. Not a verdict.")}>
          {t(
            `${String(counts.answered)} of ${String(counts.asked)} ${counts.asked === 1 ? "request is" : "requests are"} answered.`,
          )}
          {counts.waiting === 0
            ? null
            : ` ${t(`${String(counts.waiting)} still ${counts.waiting === 1 ? "waits" : "wait"} on ${counterpart}.`)}`}
        </QLine>
      )}

      {rows.length === 0 ? null : (
        <div className="flex flex-wrap gap-2.5" data-diligence-counts>
          <Tag tone="evidence" icon={<Check aria-hidden="true" />}>
            {t(`${String(counts.shared)} shared`)}
          </Tag>
          <Tag tone="stone">{t(`${String(counts.waiting)} waiting`)}</Tag>
          {founder ? null : (
            <Tag tone="dash">{t(`${String(counts.notAsked)} not asked`)}</Tag>
          )}
        </div>
      )}

      {error === null ? null : (
        <p
          role="alert"
          className="cq-body-sm rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 py-2 text-(--cq-text-primary)"
        >
          {t(error)}
        </p>
      )}
      {notice === null ? null : (
        <p
          role="status"
          className="cq-body-sm cq-swap flex items-center gap-2 rounded-(--cq-radius-md) bg-(--cq-positive-soft) px-3 py-2 text-(--cq-positive)"
        >
          <Check size={ICON_SIZE.compact} aria-hidden="true" />
          {t(notice)}
        </p>
      )}

      {rows.length === 0 ? (
        <section className="flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface) px-6 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
            <FileText size={ICON_SIZE.prominent} aria-hidden="true" />
          </span>
          <h2 className="cq-body font-semibold text-(--cq-text-primary)">
            {founder ? t("No requests yet") : t("Nothing asked yet")}
          </h2>
          <p className="cq-body-sm max-w-[44ch] text-(--cq-text-secondary)">
            {founder
              ? t(`When ${counterpart} asks for a document, it lands here.`)
              : t(
                  `Ask for a deck, accounts or a cap table. ${counterpart} sees it straight away.`,
                )}
          </p>
          {!founder && area.open ? (
            <Button variant="primary" onClick={() => setAsking({ preset: "" })}>
              {t("Ask for a document")}
            </Button>
          ) : null}
        </section>
      ) : (
        <ul aria-label={t("Requests")} className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li key={row.key}>
              {row.kind === "OPEN" ? (
                <ChecklistRow
                  label={row.question}
                  tone="open"
                  icon={<CircleHelp size={ICON_SIZE.regular} aria-hidden="true" />}
                  tag={<Tag tone="dash">{t("Not asked yet")}</Tag>}
                  line={
                    <>
                      <QCircle className="size-4 text-[9px] text-(--cq-accent)" />
                      <span>
                        {t("Not asked yet. It's one of Q's open questions.")}
                      </span>
                    </>
                  }
                  action={
                    area.open ? (
                      <Button
                        variant="secondary"
                        onClick={() => setAsking({ preset: row.question })}
                      >
                        {t("Ask for it")}
                      </Button>
                    ) : null
                  }
                />
              ) : row.kind === "SHARE" ? (
                <ShareRow
                  share={row.share}
                  founder={founder}
                  now={now}
                  busy={busy !== null}
                  onOpen={() => setViewing(row.share)}
                  onRevoke={() =>
                    void act(`revoke:${row.share.policyId}`, () =>
                      revokeDiligenceAction(relationshipId, row.share.policyId),
                    )
                  }
                />
              ) : (
                <RequestRow
                  request={row.request}
                  status={row.status}
                  founder={founder}
                  open={area.open}
                  counterpart={counterpart}
                  companyId={companyId}
                  now={now}
                  busy={busy !== null || uploading !== null}
                  uploading={
                    uploading?.requestId === row.request.requestId
                      ? uploading
                      : null
                  }
                  onOpen={(share) => setViewing(share)}
                  onRevoke={(share) =>
                    void act(`revoke:${share.policyId}`, () =>
                      revokeDiligenceAction(relationshipId, share.policyId),
                    )
                  }
                  onUpload={(file) => void uploadAndShare(row.request, file)}
                  onPick={() =>
                    setPicking({ requestId: row.request.requestId })
                  }
                  onRemind={() => setReminding(row.request)}
                  onAskAgain={() => setAsking({ preset: row.request.title })}
                />
              )}
            </li>
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
          {t("Share a document")}
        </Button>
      ) : null}
      {!founder && area.open && rows.length > 0 ? (
        <Button
          variant="primary"
          className="w-full sm:hidden"
          onClick={() => setAsking({ preset: "" })}
        >
          <Plus size={ICON_SIZE.compact} aria-hidden="true" />
          {t("Ask for a document")}
        </Button>
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
      ) : (
        <>
          <AskSheet
            open={asking !== null}
            preset={asking?.preset ?? ""}
            counterpart={counterpart}
            suggestions={notAsked}
            busy={busy === "ask"}
            onClose={() => setAsking(null)}
            onSend={async (title, note, key) => {
              const done = await act("ask", () =>
                requestDiligenceAction(
                  relationshipId,
                  { title, ...(note === null ? {} : { note }) },
                  key,
                ),
              );
              if (done) {
                setAsking(null);
                setNotice(`Request sent to ${counterpart}`);
              }
              return done;
            }}
          />
          <RemindSheet
            request={reminding}
            relationshipId={relationshipId}
            counterpart={counterpart}
            onClose={(sent) => {
              setReminding(null);
              if (sent) setNotice(`Reminder sent to ${counterpart}`);
            }}
          />
        </>
      )}
      <ViewerSheet
        share={viewing}
        relationshipId={relationshipId}
        counterpart={counterpart}
        now={now}
        onClose={() => {
          setViewing(null);
          // Opening it is what "Viewed" means to the founder.
          if (!founder) void reread();
        }}
        onDownload={(documentId) => void download(documentId)}
      />
    </div>
  );
}

/** One checklist row: icon, title, state, one line, and its one action. */
function ChecklistRow({
  label,
  tone,
  icon,
  tag,
  line,
  action,
  children,
}: {
  readonly label: string;
  readonly tone: "shared" | "asked" | "open";
  readonly icon: ReactNode;
  readonly tag: ReactNode;
  readonly line?: ReactNode;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}) {
  const t = useT();
  return (
    <article
      aria-label={t(label)}
      className={cx(
        "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-3 rounded-(--cq-radius-lg) border px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        tone === "open"
          ? "border-dashed border-(--cq-border) bg-(--cq-surface)"
          : "border-(--cq-border-subtle) bg-(--cq-surface-raised)",
      )}
      data-request-row={tone}
    >
      <span
        aria-hidden="true"
        className={cx(
          "grid size-10 place-items-center self-start rounded-(--cq-radius-lg)",
          tone === "shared"
            ? "bg-(--cq-positive-soft) text-(--cq-positive)"
            : "bg-(--cq-surface-subtle) text-(--cq-text-secondary)",
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col">
        <h3 className="cq-body font-semibold text-(--cq-text-primary)">
          {t(label)}
        </h3>
        <div className="mt-1.5">{tag}</div>
        {line === undefined ? null : (
          <div className="cq-body-sm mt-1 flex items-start gap-1.5 text-(--cq-text-secondary) [&>span:first-child]:mt-0.5">
            {line}
          </div>
        )}
        {children}
      </div>
      {action === undefined || action === null ? null : (
        <div className="col-span-2 flex gap-2 sm:col-span-1 [&>*]:max-sm:flex-1">
          {action}
        </div>
      )}
    </article>
  );
}

function RequestRow({
  request,
  status,
  founder,
  open,
  counterpart,
  companyId,
  now,
  busy,
  uploading,
  onOpen,
  onRevoke,
  onUpload,
  onPick,
  onRemind,
  onAskAgain,
}: {
  readonly request: DiligenceRequest;
  readonly status: RequestStatus;
  readonly founder: boolean;
  readonly open: boolean;
  readonly counterpart: string;
  readonly companyId: string;
  readonly now: number;
  readonly busy: boolean;
  readonly uploading: {
    readonly name: string;
    readonly fraction: number;
  } | null;
  readonly onOpen: (share: Share) => void;
  readonly onRevoke: (share: Share) => void;
  readonly onUpload: (file: File) => void;
  readonly onPick: () => void;
  readonly onRemind: () => void;
  readonly onAskAgain: () => void;
}) {
  const t = useT();
  const share = status.share;
  const shared = share !== null;
  const asked = founder
    ? t(`${request.requestedByName ?? counterpart} asked ${since(request.requestedAt, now)} ago`)
    : t(`Asked ${dealDay(request.requestedAt)}.`);
  const tag = shared ? (
    <Tag tone="evidence" icon={<Check aria-hidden="true" />}>
      {status.words === "Viewed"
        ? t(`Shared, opened ${since(share.viewedAt ?? share.sharedAt, now)} ago`)
        : t(`Shared ${dealDay(share.sharedAt)}`)}
    </Tag>
  ) : status.words === "Declined" ? (
    <Tag tone="dash">{t("Declined")}</Tag>
  ) : status.words.startsWith("Answered") ? (
    <Tag
      tone={status.tone === "positive" ? "evidence" : "stone"}
      icon={status.tone === "positive" ? <Check aria-hidden="true" /> : undefined}
    >
      {t(status.words)}
    </Tag>
  ) : (
    <Tag tone="stone" icon={<Clock aria-hidden="true" />}>
      {status.words === "Needs a new file"
        ? t("Needs a new file")
        : founder
          ? t("Asked, waiting on you")
          : t("Asked, waiting")}
    </Tag>
  );
  const line = shared ? (
    share.qSummary === null ? (
      <span>{t("Q hasn't read it yet.")}</span>
    ) : (
      <>
        <QCircle className="size-4 text-[9px] text-(--cq-accent)" />
        <span data-q-summary>{t(share.qSummary)}</span>
      </>
    )
  ) : (
    <span>
      {asked}
      {request.note === null ? "" : ` ${request.note}`}
    </span>
  );

  const action = shared ? (
    founder ? (
      <Button variant="quiet" disabled={busy} onClick={() => onRevoke(share)}>
        {t("Stop sharing")}
      </Button>
    ) : (
      <Button variant="secondary" onClick={() => onOpen(share)}>
        {t("Open")}
      </Button>
    )
  ) : founder ? (
    open &&
    status.answerable &&
    uploading === null &&
    (request.questions === null || request.questions.length === 0) ? (
      <>
        <UploadButton
          disabled={busy}
          label={t(`Upload & share ${request.title}`)}
          onFile={onUpload}
        />
        <Button variant="secondary" disabled={busy} onClick={onPick}>
          <FileText size={ICON_SIZE.compact} aria-hidden="true" />
          {t("Share existing")}
        </Button>
      </>
    ) : null
  ) : status.answerable && open ? (
    <Button variant="quiet" onClick={onRemind}>
      {t("Remind")}
    </Button>
  ) : status.words === "Declined" && open ? (
    <Button variant="secondary" onClick={onAskAgain}>
      {t("Ask again")}
    </Button>
  ) : null;

  return (
    <ChecklistRow
      label={request.title}
      tone={shared ? "shared" : "asked"}
      icon={
        shared ? (
          <FileText size={ICON_SIZE.regular} aria-hidden="true" />
        ) : (
          <Clock size={ICON_SIZE.regular} aria-hidden="true" />
        )
      }
      tag={tag}
      line={line}
      action={action}
    >
      {request.status === "DECLINED" ? (
        <p
          className="cq-body-sm mt-1 text-(--cq-text-secondary)"
          data-request-declined
        >
          {founder ? t("You declined") : t("They declined")}
          {request.declineNote === null
            ? "."
            : t(`: “${request.declineNote}”`)}
        </p>
      ) : null}
      {request.questions === null || request.questions.length === 0 ? null : (
        <div className="mt-3">
          <QuestionAnswers
            questions={request.questions}
            companyId={companyId}
            founder={founder}
            counterpart={counterpart}
          />
        </div>
      )}
      {founder &&
      request.questions !== null &&
      request.questions.some((q) => q.answer === null) ? (
        <Link
          href={`/documents?tab=requested&item=${encodeURIComponent(request.requestId)}`}
          className="cq-body-sm inline-flex min-h-11 items-center self-start text-(--cq-text-primary) underline underline-offset-2"
        >
          {t("Answer their questions")}
        </Link>
      ) : null}
      {share !== null && !share.scanned ? <NotScannedNote /> : null}
      {uploading === null ? null : (
        <div className="mt-2">
          <UploadProgress name={uploading.name} fraction={uploading.fraction} />
        </div>
      )}
    </ChecklistRow>
  );
}

function ShareRow({
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
  readonly onOpen: () => void;
  readonly onRevoke: () => void;
}) {
  const t = useT();
  return (
    <ChecklistRow
      label={share.title}
      tone="shared"
      icon={<FileText size={ICON_SIZE.regular} aria-hidden="true" />}
      tag={
        <Tag tone="evidence" icon={<Check aria-hidden="true" />}>
          {share.viewedAt === null
            ? t(`Shared ${dealDay(share.sharedAt)}`)
            : t(`Shared, opened ${since(share.viewedAt, now)} ago`)}
        </Tag>
      }
      line={
        share.qSummary === null ? (
          <span>
            {founder
              ? t("Shared without a request.")
              : t("Shared without a request. Q hasn't read it yet.")}
          </span>
        ) : (
          <>
            <QCircle className="size-4 text-[9px] text-(--cq-accent)" />
            <span data-q-summary>{t(share.qSummary)}</span>
          </>
        )
      }
      action={
        founder ? (
          <Button variant="quiet" disabled={busy} onClick={onRevoke}>
            {t("Stop sharing")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onOpen}>
            {t("Open")}
          </Button>
        )
      }
    >
      {share.scanned ? null : <NotScannedNote />}
    </ChecklistRow>
  );
}

/**
 * A shared document in place: the reader's own name over every page (it
 * deters and attributes; it does not prevent a screenshot), Q's one line,
 * and a download, since a diligence share may be saved.
 */
function ViewerSheet({
  share,
  relationshipId,
  counterpart,
  now,
  onClose,
  onDownload,
}: {
  readonly share: Share | null;
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly now: number;
  readonly onClose: () => void;
  readonly onDownload: (documentId: string) => void;
}) {
  const t = useT();
  const [file, setFile] = useState<
    | { readonly kind: "LOADING" }
    | { readonly kind: "READ"; readonly url: string; readonly watermark: string }
    | { readonly kind: "FAILED"; readonly message: string }
  >({ kind: "LOADING" });
  const documentId = share?.documentId ?? null;

  useEffect(() => {
    if (documentId === null) return;
    let live = true;
    setFile({ kind: "LOADING" });
    void diligenceViewAction(relationshipId, documentId)
      .then((result) => {
        if (!live) return;
        setFile(
          result.ok
            ? { kind: "READ", ...result.value }
            : { kind: "FAILED", message: result.message },
        );
      })
      .catch(() => {
        if (live)
          setFile({ kind: "FAILED", message: "That couldn't be opened." });
      });
    return () => {
      live = false;
    };
  }, [relationshipId, documentId]);

  return (
    <RecordSheet
      open={share !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={share === null ? "" : t(share.title)}
      description={
        share === null
          ? undefined
          : t(`Shared by ${counterpart} ${since(share.sharedAt, now)} ago`)
      }
    >
      <div
        className="cq-doc-lines relative aspect-[4/3] overflow-hidden rounded-(--cq-radius-md) border border-(--cq-border-subtle)"
        data-diligence-viewer
      >
        {file.kind === "READ" ? (
          <>
            <iframe
              src={`${file.url}#toolbar=0&navpanes=0`}
              title={share?.title ?? t("Document")}
              className="absolute inset-0 h-full w-full"
              referrerPolicy="no-referrer"
            />
            <Watermark words={file.watermark} />
          </>
        ) : file.kind === "FAILED" ? (
          <p
            role="alert"
            className="cq-body-sm absolute inset-0 grid place-items-center p-6 text-center text-(--cq-text-secondary)"
          >
            {t(file.message)}
          </p>
        ) : (
          <span className="sr-only" role="status">
            {t("Opening…")}
          </span>
        )}
      </div>
      {share?.qSummary === null || share === null ? null : (
        <QLine note={t("Q's one line on it. Read the document for the detail.")}>
          {t(share.qSummary)}
        </QLine>
      )}
      {share === null ? null : (
        <>
          <p className="cq-caption flex items-center gap-1.5 text-(--cq-text-tertiary)">
            <Lock size={ICON_SIZE.compact} aria-hidden="true" />
            {t("Watermarked with your name while you read it here.")}
          </p>
          <Button
            variant="secondary"
            onClick={() => onDownload(share.documentId)}
          >
            <Download size={ICON_SIZE.compact} aria-hidden="true" />
            {t("Download")}
          </Button>
        </>
      )}
    </RecordSheet>
  );
}

/**
 * "Ask for a document": Q's open questions first (labelled as Q's), or the
 * person's own words, and an optional note. The request appears in the
 * company's diligence list. Its key belongs to exactly what is sent: an
 * edit makes a new one, so a retried press asks once.
 */
function AskSheet({
  open,
  preset,
  counterpart,
  suggestions,
  busy,
  onClose,
  onSend,
}: {
  readonly open: boolean;
  readonly preset: string;
  readonly counterpart: string;
  readonly suggestions: readonly string[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSend: (
    title: string,
    note: string | null,
    key: string,
  ) => Promise<boolean>;
}) {
  const t = useT();
  const titleId = useId();
  const noteId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  const [note, setNote] = useState("");
  const [key, setKey] = useState(newKey);
  const [opened, setOpened] = useState<string | null>(null);

  // Each opening starts from its preset (an open question's "Ask for it").
  if (open && opened !== preset) {
    setOpened(preset);
    setChosen(
      preset !== "" && suggestions.includes(preset)
        ? preset
        : (suggestions[0] ?? null),
    );
    setOwn(preset !== "" && !suggestions.includes(preset) ? preset : "");
    setNote("");
    setKey(newKey());
  }
  if (!open && opened !== null) setOpened(null);

  const title = (chosen ?? own).trim();
  return (
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("Ask for a document")}
      description={t(`${counterpart} sees your request in their diligence list`)}
    >
      {suggestions.length === 0 ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="cq-body-sm mb-1.5 flex items-center gap-1.5 font-medium text-(--cq-text-secondary)">
            <QCircle className="size-4 text-[9px]" />
            {t("Suggested from Q's open questions")}
          </legend>
          {[...suggestions, null].map((suggestion) => {
            const on = chosen === suggestion;
            return (
              <button
                key={suggestion ?? "own"}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setChosen(suggestion);
                  setKey(newKey());
                }}
                className={cx(
                  "flex min-h-[52px] items-center gap-3 rounded-(--cq-radius-lg) border px-3.5 py-2.5 text-start transition-[border-color,box-shadow] duration-(--cq-motion-fast)",
                  on
                    ? "border-(--cq-text-primary) bg-(--cq-surface) shadow-[0_0_0_1px_var(--cq-text-primary)]"
                    : "border-(--cq-border) bg-(--cq-surface-raised) hover:border-(--cq-border-strong)",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "grid size-[18px] flex-none place-items-center rounded-full border-[1.5px]",
                    on ? "border-(--cq-text-primary)" : "border-(--cq-border)",
                  )}
                >
                  {on ? (
                    <span className="size-2 rounded-full bg-(--cq-text-primary)" />
                  ) : null}
                </span>
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {suggestion === null ? t("Something else") : t(suggestion)}
                </span>
              </button>
            );
          })}
        </fieldset>
      )}
      {suggestions.length === 0 || chosen === null ? (
        <label className="flex flex-col gap-1.5" htmlFor={titleId}>
          <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
            {t("What you need")}
          </span>
          <input
            id={titleId}
            value={own}
            maxLength={200}
            onChange={(event) => {
              setOwn(event.target.value);
              setKey(newKey());
            }}
            placeholder={t("For example, the cap table")}
            className="cq-body min-h-11 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary)"
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5" htmlFor={noteId}>
        <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
          {t("A note for them (optional)")}
        </span>
        <textarea
          id={noteId}
          value={note}
          maxLength={1000}
          rows={3}
          onChange={(event) => {
            setNote(event.target.value);
            setKey(newKey());
          }}
          placeholder={t("Why you need it")}
          className="cq-body min-h-[84px] w-full resize-y rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 py-2.5 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary)"
        />
      </label>
      <Button
        variant="primary"
        disabled={busy || title.length === 0}
        onClick={() =>
          void onSend(title, note.trim() === "" ? null : note.trim(), key)
        }
      >
        {busy ? t("Sending…") : t("Send request")}
      </Button>
    </RecordSheet>
  );
}

/**
 * "Remind": a short message to the company in your conversation about one
 * request. The exact words are shown and editable; nothing is sent until
 * the person presses Send, under a key made for exactly those words.
 */
function RemindSheet({
  request,
  relationshipId,
  counterpart,
  onClose,
}: {
  readonly request: DiligenceRequest | null;
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly onClose: (sent: boolean) => void;
}) {
  const t = useT();
  const fieldId = useId();
  const [text, setText] = useState("");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [for_, setFor] = useState<string | null>(null);

  if (request !== null && for_ !== request.requestId) {
    setFor(request.requestId);
    setText(
      `A quick reminder about “${request.title}”, which we asked for on ${dealDay(request.requestedAt)}. Could you share it when you can? Thank you.`,
    );
    setKey(newKey());
    setError(null);
  }
  if (request === null && for_ !== null) setFor(null);

  const send = () => {
    const body = text.trim();
    if (body === "") return;
    setBusy(true);
    setError(null);
    void sendChatMessageAction(relationshipId, { kind: "TEXT", body }, key)
      .then((result) => {
        setBusy(false);
        if (result.ok) onClose(true);
        else setError(result.message);
      })
      .catch(() => {
        setBusy(false);
        setError("That didn't send. Try again.");
      });
  };

  return (
    <RecordSheet
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) onClose(false);
      }}
      title={t("Remind them")}
      description={t(`A message to ${counterpart} in your conversation`)}
    >
      <label className="flex flex-col gap-1.5" htmlFor={fieldId}>
        <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
          {t("Your message")}
        </span>
        <textarea
          id={fieldId}
          value={text}
          maxLength={4000}
          rows={4}
          onChange={(event) => {
            setText(event.target.value);
            setKey(newKey());
          }}
          className="cq-body min-h-28 w-full resize-y rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 py-2.5 text-(--cq-text-primary)"
        />
      </label>
      <span className="cq-caption text-(--cq-text-tertiary)">
        {t("Nothing is sent until you press Send. Both sides see the conversation.")}
      </span>
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {t(error)}
        </p>
      )}
      <Button
        variant="primary"
        disabled={busy || text.trim() === ""}
        onClick={send}
      >
        {busy ? t("Sending…") : t("Send")}
      </Button>
    </RecordSheet>
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
  const t = useT();

  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="primary"
        className="min-w-0 px-2.5 sm:px-4"
        disabled={disabled}
        aria-label={t(label)}
        onClick={() => input.current?.click()}
      >
        <Upload size={ICON_SIZE.compact} aria-hidden="true" />
        {t("Upload & share")}
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
  const t = useT();

  const percent = Math.round(fraction * 100);
  return (
    <div className="flex flex-col gap-1.5" role="status">
      <span className="cq-body-sm text-(--cq-text-secondary)">
        {percent >= 100
          ? t(`Sharing ${name}…`)
          : t(`Uploading ${name} · ${String(percent)}%`)}
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
  const t = useT();

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
      <SheetContent title={t("Share existing")} side="bottom">
        <div className="flex flex-col gap-3 p-4">
          {failed ? (
            <div className="flex items-center justify-between gap-3">
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {t("Your documents didn't load.")}
              </p>
              <Button variant="secondary" onClick={load}>
                {t("Retry")}
              </Button>
            </div>
          ) : documents === null ? (
            <ul aria-busy="true" className="flex flex-col gap-2">
              {[0, 1, 2].map((n) => (
                <li
                  key={n}
                  className="h-12 animate-pulse rounded-(--cq-radius-md) bg-(--cq-surface-subtle) motion-reduce:animate-none"
                />
              ))}
            </ul>
          ) : documents.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t("No documents yet. Use Upload & share instead.")}
            </p>
          ) : (
            <fieldset className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
              <legend className="sr-only">{t("Your documents")}</legend>
              {documents.map((document) => (
                <label
                  key={document.id}
                  className={cx(
                    "cq-body-sm flex min-h-12 cursor-pointer items-center gap-3 rounded-(--cq-radius-md) px-3",
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
                    {t(document.title)}
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
              {t("Cancel")}
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
              {t("Share")}
            </button>
          </div>
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

/** The tab could not be read: say so, and one way to try again. */
export function DiligenceUnavailable({ href }: { readonly href: string }) {
  const t = useT();

  return (
    <section
      role="alert"
      className="flex items-center justify-between gap-3 rounded-(--cq-radius-lg) border border-(--cq-border) bg-(--cq-surface-raised) p-4"
      data-state="unavailable"
    >
      <span className="flex flex-col gap-0.5">
        <span className="cq-body-sm font-semibold text-(--cq-text-primary)">
          {t("Diligence didn't load")}
        </span>
        <span className="cq-body-sm text-(--cq-text-secondary)">
          {t("Nothing changed. Try again in a moment.")}
        </span>
      </span>
      <a href={href} className={buttonClassName("secondary")}>
        {t("Retry")}
      </a>
    </section>
  );
}
