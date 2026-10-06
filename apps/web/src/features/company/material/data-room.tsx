"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ComponentType } from "react";

import {
  DATA_ROOM_GRANT_DAYS,
  DATA_ROOM_GRANT_DEFAULT_DAYS,
  type DataRoomFolder,
  type DataRoomInvestorDocument,
  type DataRoomInvestorView,
  type DataRoomLevel,
  type DataRoomOwnerDocument,
  type DataRoomOwnerView,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  Building2,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Globe,
  History,
  ICON_SIZE,
  Landmark,
  LayoutGrid,
  Lock,
  Plus,
  Shield,
  Upload,
  UserRound,
  Users,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { stageLabel } from "../declared-labels";
import { FileViewer } from "./file-viewer";
import {
  decideRequestAction,
  newRequestKey,
  openDocumentAction,
  requestAccessAction,
  setLevelAction,
  type OpenedFile,
} from "./material-actions";

/**
 * The Data room tab (overnight plan A3; design-a "dataroom-*" mockups).
 *
 * Two readers, two shapes, both decided by the API: an investor sees only
 * what is open to them or listed on request (never a title they may not
 * see); the founder sees every document with who can see it, the default
 * checklist for their stage and country, and the requests waiting for
 * them. Folders are a list with counts, not cards; meaning is never colour
 * alone: every level is a word with its icon.
 */

type IconType = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true"; className?: string }>;

const FOLDER_ICONS: Readonly<Record<string, IconType>> = {
  fundraising: LayoutGrid,
  corporate: Building2,
  kyc_kyb: Shield,
  cap_table: LayoutGrid,
  financials: Landmark,
  tax: FileText,
  legal_ip: Lock,
  commercial: Users,
  team: UserRound,
  licences: Shield,
  other: FileText,
};

const monthYear = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const dayMonth = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

function plural(n: number, one: string, many = `${one}s`) {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function FolderHeader({
  folder,
  open,
  detail,
  onToggle,
}: {
  readonly folder: DataRoomFolder;
  readonly open: boolean;
  readonly detail: string;
  readonly onToggle: () => void;
}) {
  const Icon = FOLDER_ICONS[folder.code] ?? FileText;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex min-h-14 w-full items-center gap-3 py-3 text-left"
      data-folder={folder.code}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
        <Icon size={ICON_SIZE.regular} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="cq-body font-medium text-(--cq-text-primary)">{folder.label}</span>
        <span className="cq-caption text-(--cq-text-secondary)">{detail}</span>
      </span>
      <ChevronDown
        size={ICON_SIZE.regular}
        aria-hidden="true"
        className={`text-(--cq-text-tertiary) transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

const SHOWN_AS: Readonly<Record<DataRoomInvestorDocument["shownAs"], { label: string; icon: IconType; tone: string }>> = {
  PUBLIC: { label: "Public", icon: Globe, tone: "border-(--cq-positive) text-(--cq-positive) bg-(--cq-positive-soft)" },
  ON_REQUEST: { label: "On request", icon: Lock, tone: "border-(--cq-warning) text-(--cq-warning) bg-(--cq-warning-soft)" },
  SHARED: { label: "Shared with you", icon: Check, tone: "border-(--cq-accent) text-(--cq-accent) bg-(--cq-accent-soft)" },
};

function LevelChip({ shownAs }: { readonly shownAs: DataRoomInvestorDocument["shownAs"] }) {
  const { label, icon: Icon, tone } = SHOWN_AS[shownAs];
  return (
    <span className={`cq-caption inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${tone}`}>
      <Icon size={ICON_SIZE.compact} aria-hidden="true" />
      {label}
    </span>
  );
}

type Filter = "ALL" | "OPEN" | "ON_REQUEST" | "NOT_OPENED";
const FILTERS: readonly (readonly [Filter, string])[] = [
  ["ALL", "All"],
  ["OPEN", "Open to you"],
  ["ON_REQUEST", "On request"],
  ["NOT_OPENED", "Not opened yet"],
];

export function InvestorDataRoom({
  companyId,
  companyName,
  view,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly view: DataRoomInvestorView;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<DataRoomInvestorDocument | "ALL" | null>(null);
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<{ title: string; file: OpenedFile } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const documents = view.documents.map((document) =>
    requested.has(document.documentId) || (requested.has("*") && document.access === "REQUESTABLE")
      ? { ...document, access: "REQUESTED" as const }
      : document,
  );
  const shown = documents.filter((document) =>
    filter === "OPEN"
      ? document.access === "OPEN"
      : filter === "ON_REQUEST"
        ? document.shownAs === "ON_REQUEST"
        : filter === "NOT_OPENED"
          ? document.access === "OPEN" && document.openedAt === null
          : true,
  );
  const openCount = documents.filter((document) => document.access === "OPEN").length;
  const requestable = documents.some((document) => document.access === "REQUESTABLE");

  if (view.documents.length === 0) {
    return (
      <div className="flex flex-col gap-2 py-6" data-data-room="investor-empty">
        <p className="cq-body text-(--cq-text-primary)">Nothing in {companyName}&rsquo;s data room is open to you yet.</p>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Documents they share with you, or list on request, appear here.
        </p>
      </div>
    );
  }

  const open = (document: DataRoomInvestorDocument) =>
    start(async () => {
      const result = await openDocumentAction(companyId, document.documentId);
      if (result.ok) setOpened({ title: document.title, file: result.value });
      else setMessage(result.message);
    });

  return (
    <section className="flex flex-col gap-4" aria-label="Data room" data-data-room="investor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {plural(documents.length, "document")} you can see, in {plural(view.folders.length, "folder")}. {openCount} are
          open to you now.
        </p>
        {requestable ? (
          <button type="button" className={buttonClassName("secondary", "regular")} onClick={() => setAsking("ALL")}>
            Request all on request
          </button>
        ) : null}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Show">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`cq-body-sm min-h-11 shrink-0 rounded-full border px-4 ${
              filter === value
                ? "border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-text-inverse)"
                : "border-(--cq-border) text-(--cq-text-primary)"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
        {view.folders.map((folder) => {
          const inFolder = shown.filter((document) => document.folderCode === folder.code);
          const all = documents.filter((document) => document.folderCode === folder.code);
          if (inFolder.length === 0) return null;
          const isOpen = !closed.has(folder.code);
          return (
            <li key={folder.code}>
              <FolderHeader
                folder={folder}
                open={isOpen}
                detail={`${plural(all.length, "document")} · ${String(all.filter((d) => d.access === "OPEN").length)} open to you`}
                onToggle={() =>
                  setClosed((previous) => {
                    const next = new Set(previous);
                    if (next.has(folder.code)) next.delete(folder.code);
                    else next.add(folder.code);
                    return next;
                  })
                }
              />
              {isOpen ? (
                <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
                  {inFolder.map((document) => (
                    <li key={document.documentId} className="flex items-start gap-3 py-3 pl-1" data-room-document={document.access}>
                      <FileText size={ICON_SIZE.regular} aria-hidden="true" className="mt-0.5 shrink-0 text-(--cq-text-tertiary)" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <p className="cq-body text-(--cq-text-primary)">{document.title}</p>
                        <p className="cq-caption flex flex-wrap items-center gap-x-2 gap-y-1 text-(--cq-text-secondary)">
                          <LevelChip shownAs={document.shownAs} />
                          {[
                            document.kind,
                            document.pageCount === null ? null : plural(document.pageCount, "page"),
                            document.validUntil === null
                              ? monthYear(document.updatedAt)
                              : `Valid to ${monthYear(document.validUntil)}`,
                          ]
                            .filter((part): part is string => part !== null)
                            .join(" · ")}
                          {document.openedAt === null ? null : (
                            <span className="inline-flex items-center gap-1">
                              <Eye size={ICON_SIZE.compact} aria-hidden="true" /> You opened it {dayMonth(document.openedAt)}
                            </span>
                          )}
                          {document.accessEndsAt === null ? null : <span>Until {dayMonth(document.accessEndsAt)}</span>}
                        </p>
                      </div>
                      {document.access === "OPEN" ? (
                        <button
                          type="button"
                          disabled={pending}
                          className={buttonClassName("secondary", "compact", "min-h-11")}
                          onClick={() => open(document)}
                        >
                          Open
                        </button>
                      ) : document.access === "REQUESTED" ? (
                        <span className="cq-caption inline-flex min-h-11 items-center gap-1 text-(--cq-text-secondary)">
                          <History size={ICON_SIZE.compact} aria-hidden="true" /> Requested
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={buttonClassName("quiet", "compact", "min-h-11 text-(--cq-accent)")}
                          onClick={() => setAsking(document)}
                        >
                          Request
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="cq-caption text-(--cq-text-secondary)">
        {companyName} can see when you open a document. Documents that can&rsquo;t be downloaded show your name on every
        page.
      </p>
      <RequestSheet
        companyId={companyId}
        companyName={companyName}
        target={asking}
        onClose={() => setAsking(null)}
        onSent={(target) => {
          setRequested((previous) => new Set([...previous, target === "ALL" ? "*" : target.documentId]));
          setAsking(null);
        }}
      />
      <FileViewer title={opened?.title ?? ""} file={opened?.file ?? null} onClose={() => setOpened(null)} />
    </section>
  );
}

function RequestSheet({
  companyId,
  companyName,
  target,
  onClose,
  onSent,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly target: DataRoomInvestorDocument | "ALL" | null;
  readonly onClose: () => void;
  readonly onSent: (target: DataRoomInvestorDocument | "ALL") => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      if (target === null) return;
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
    <SheetRoot open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {target === null ? null : (
        <SheetContent title={target === "ALL" ? "Request everything on request" : "Request this document"} side="side">
          <div className="flex flex-col gap-4 px-4 pb-6" data-request-sheet>
            {target === "ALL" ? null : (
              <p className="cq-body flex items-center gap-2 text-(--cq-text-primary)">
                <FileText size={ICON_SIZE.regular} aria-hidden="true" /> {target.title}
              </p>
            )}
            <label className="flex flex-col gap-2">
              <span className="cq-label text-(--cq-text-primary)">A note to {companyName} (optional)</span>
              <textarea
                value={note}
                maxLength={1000}
                rows={3}
                onChange={(event) => setNote(event.target.value)}
                placeholder="For example: we're preparing for our investment committee on 20 October."
                className="cq-body rounded-md border border-(--cq-border) bg-(--cq-surface) p-3 text-(--cq-text-primary)"
              />
            </label>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              The founders will see your name, your firm and your note. You&rsquo;ll get a message here when they answer.
            </p>
            {error === null ? null : (
              <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button type="button" disabled={pending} onClick={send} className={buttonClassName("primary", "large")}>
                Send request
              </button>
              <button type="button" onClick={onClose} className={buttonClassName("quiet", "large")}>
                Cancel
              </button>
            </div>
          </div>
        </SheetContent>
      )}
    </SheetRoot>
  );
}

// --- the founder's side --------------------------------------------------------

const LEVELS: readonly (readonly [DataRoomLevel, string, IconType])[] = [
  ["PUBLIC", "Public", Globe],
  ["ON_REQUEST", "On request", Lock],
  ["SHARED_ONLY", "Shared only", Users],
  ["PRIVATE", "Private", EyeOff],
];

function LevelControl({
  document,
  onChange,
  disabled,
}: {
  readonly document: DataRoomOwnerDocument;
  readonly onChange: (level: DataRoomLevel) => void;
  readonly disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Who can see ${document.title}`}
      className="flex shrink-0 flex-wrap gap-1 rounded-md bg-(--cq-surface-subtle) p-1"
    >
      {LEVELS.map(([level, label, Icon]) => {
        const active = document.level === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => (active ? undefined : onChange(level))}
            className={`cq-caption inline-flex min-h-11 items-center gap-1 rounded px-2.5 sm:min-h-9 ${
              active
                ? "bg-(--cq-surface-raised) font-medium text-(--cq-text-primary) shadow-(--cq-shadow-xs)"
                : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            }`}
          >
            <Icon size={ICON_SIZE.compact} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function OwnerDataRoom({ companyId, view }: { readonly companyId: string; readonly view: DataRoomOwnerView }) {
  const [documents, setDocuments] = useState(view.documents);
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    new Set(view.folders.map((folder) => folder.code).slice(3)),
  );
  const [days, setDays] = useState<Record<string, number>>({});
  const [answered, setAnswered] = useState<Record<string, "APPROVED" | "DECLINED">>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const present = view.checklist.filter((item) => item.present).length;
  const missing = view.checklist.filter((item) => !item.present);
  const stage = stageLabel(view.stageCode) ?? "your";
  const waiting = view.requests.filter((request) => request.status === "OPEN" && answered[request.requestId] === undefined);
  const folders = useMemo(
    () =>
      view.folders.filter(
        (folder) =>
          documents.some((d) => d.folderCode === folder.code) || missing.some((item) => item.folderCode === folder.code),
      ),
    [view.folders, documents, missing],
  );

  const setLevel = (document: DataRoomOwnerDocument, level: DataRoomLevel) => {
    const before = documents;
    setDocuments((current) => current.map((d) => (d.documentId === document.documentId ? { ...d, level } : d)));
    start(async () => {
      const result = await setLevelAction({ companyId, documentId: document.documentId, level, version: document.version });
      if (!result.ok) {
        setDocuments(before);
        setMessage(result.message);
      } else {
        setDocuments((current) =>
          current.map((d) => (d.documentId === document.documentId ? { ...d, version: d.version + 1 } : d)),
        );
      }
    });
  };

  const decide = (requestId: string, decision: "APPROVE" | "DECLINE") =>
    start(async () => {
      const result = await decideRequestAction({
        companyId,
        requestId,
        decision,
        days: days[requestId] ?? DATA_ROOM_GRANT_DEFAULT_DAYS,
      });
      if (result.ok) setAnswered((now) => ({ ...now, [requestId]: decision === "APPROVE" ? "APPROVED" : "DECLINED" }));
      else setMessage(result.message);
    });

  return (
    <section className="flex flex-col gap-6" aria-labelledby="data-room-title" data-data-room="owner">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="data-room-title" className="cq-title-md text-(--cq-text-primary)">
            Data room
          </h2>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            What investors can see, folder by folder. You choose for each document.
          </p>
        </div>
        <Link href="/documents" className={buttonClassName("primary", "regular")}>
          <Upload size={ICON_SIZE.compact} aria-hidden="true" /> Upload files
        </Link>
      </div>

      {view.checklist.length === 0 ? null : (
        <div className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4" data-readiness>
          <p className="cq-title-sm text-(--cq-text-primary)">
            {present} of {view.checklist.length} recommended for a {stage.toLowerCase()} round
          </p>
          <div className="flex gap-1" aria-hidden="true">
            {view.checklist.map((item) => (
              <span
                key={item.code}
                className={`h-1.5 flex-1 rounded-full ${item.present ? "bg-(--cq-positive)" : "bg-(--cq-border-subtle)"}`}
              />
            ))}
          </div>
          {missing.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">Everything investors usually ask for at this stage is here.</p>
          ) : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Still to add: {missing.slice(0, 3).map((item) => item.label.charAt(0).toLowerCase() + item.label.slice(1)).join(", ")}
              {missing.length > 3 ? `, and ${String(missing.length - 3)} more` : ""}. A recommendation, not a requirement.
            </p>
          )}
        </div>
      )}

      {waiting.length === 0 ? null : (
        <section className="flex flex-col gap-3" aria-labelledby="waiting-title">
          <h3 id="waiting-title" className="cq-title-sm text-(--cq-text-primary)">
            Waiting for you
          </h3>
          <ul className="flex flex-col gap-2">
            {waiting.map((request) => (
              <li
                key={request.requestId}
                className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) p-3 sm:flex-row sm:items-center"
                data-room-request
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="cq-body font-medium text-(--cq-text-primary)">
                    {[request.requesterName, request.requesterOrganisationName].filter(Boolean).join(", ") || "An investor"}
                  </p>
                  <p className="cq-body-sm text-(--cq-text-secondary)">
                    Asked for <strong className="text-(--cq-text-primary)">{request.documentTitle ?? "everything on request"}</strong>
                    {request.note === null ? "." : `. “${request.note}”`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="cq-caption flex items-center gap-1 text-(--cq-text-secondary)">
                    <span className="sr-only">How long</span>
                    <select
                      value={days[request.requestId] ?? DATA_ROOM_GRANT_DEFAULT_DAYS}
                      onChange={(event) => setDays((now) => ({ ...now, [request.requestId]: Number(event.target.value) }))}
                      className="cq-body-sm min-h-11 rounded-md border border-(--cq-border) bg-(--cq-surface) px-2 text-(--cq-text-primary)"
                    >
                      {DATA_ROOM_GRANT_DAYS.map((n) => (
                        <option key={n} value={n}>
                          {n} days
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decide(request.requestId, "APPROVE")}
                    className={buttonClassName("primary", "compact", "min-h-11")}
                  >
                    Share
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decide(request.requestId, "DECLINE")}
                    className={buttonClassName("secondary", "compact", "min-h-11")}
                  >
                    Not now
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}

      {documents.length === 0 && missing.length === 0 ? (
        <p className="cq-body text-(--cq-text-secondary)">Nothing here yet. Upload anything; you decide who sees it.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
          {folders.map((folder) => {
            const inFolder = documents.filter((d) => d.folderCode === folder.code);
            const gaps = missing.filter((item) => item.folderCode === folder.code);
            const isOpen = !closed.has(folder.code);
            return (
              <li key={folder.code}>
                <FolderHeader
                  folder={folder}
                  open={isOpen}
                  detail={`${plural(inFolder.length, "document")}${gaps.length === 0 ? "" : ` · ${String(gaps.length)} usually expected`}`}
                  onToggle={() =>
                    setClosed((previous) => {
                      const next = new Set(previous);
                      if (next.has(folder.code)) next.delete(folder.code);
                      else next.add(folder.code);
                      return next;
                    })
                  }
                />
                {isOpen ? (
                  <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
                    {inFolder.map((document) => (
                      <li
                        key={document.documentId}
                        className="flex flex-col gap-2 py-3 pl-1 lg:flex-row lg:items-center"
                        data-owner-document={document.level}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <FileText size={ICON_SIZE.regular} aria-hidden="true" className="mt-0.5 shrink-0 text-(--cq-text-tertiary)" />
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <p className="cq-body text-(--cq-text-primary)">{document.title}</p>
                            <p className="cq-caption flex flex-wrap items-center gap-x-2 text-(--cq-text-secondary)">
                              {[document.kind, document.pageCount === null ? null : plural(document.pageCount, "page"), monthYear(document.updatedAt)]
                                .filter((part): part is string => part !== null)
                                .join(" · ")}
                              <span className="inline-flex items-center gap-1">
                                <Eye size={ICON_SIZE.compact} aria-hidden="true" />
                                {document.level === "PRIVATE"
                                  ? "Only your team"
                                  : document.openedBy > 0
                                    ? `Opened by ${plural(document.openedBy, "investor")}`
                                    : document.sharedWith > 0
                                      ? `Shared with ${plural(document.sharedWith, "investor")}`
                                      : "Not opened yet"}
                              </span>
                            </p>
                          </div>
                        </div>
                        <LevelControl document={document} disabled={pending} onChange={(level) => setLevel(document, level)} />
                      </li>
                    ))}
                    {gaps.map((item) => (
                      <li key={item.code} className="flex items-center gap-3 py-3 pl-1" data-checklist-gap={item.code}>
                        <Plus size={ICON_SIZE.regular} aria-hidden="true" className="shrink-0 text-(--cq-text-tertiary)" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <p className="cq-body text-(--cq-text-secondary)">{item.label}</p>
                          <p className="cq-caption text-(--cq-text-tertiary)">Usually expected</p>
                        </div>
                        <Link href="/documents" className={buttonClassName("quiet", "compact", "min-h-11")}>
                          Add
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
