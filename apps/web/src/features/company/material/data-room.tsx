"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ComponentType,
  type ReactNode,
} from "react";

import {
  DATA_ROOM_GRANT_DAYS,
  DATA_ROOM_GRANT_DEFAULT_DAYS,
  type DataRoomChecklistItem,
  type DataRoomFolder,
  type DataRoomInvestorDocument,
  type DataRoomInvestorView,
  type DataRoomLevel,
  type DataRoomOwnerDocument,
  type DataRoomOwnerView,
  type InterestDto,
  type RelationshipStateV2,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  Building2,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileText,
  Globe,
  History,
  ICON_SIZE,
  Landmark,
  LayoutGrid,
  Lock,
  Maximize2,
  Plus,
  Shield,
  Upload,
  UserRound,
  Users,
} from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";

import { ExpressInterest } from "../../network/express-interest";
import { useBrief, useRoomRequests } from "../brief/brief-context";
import { QMark } from "../brief/parts";
import { stageLabel } from "../declared-labels";
import { FileViewer, Watermark } from "./file-viewer";
import {
  decideRequestAction,
  openDocumentAction,
  setLevelAction,
  setOutlineAction,
  type OpenedFile,
} from "./material-actions";
import { RequestSheet, type RoomRequestTarget } from "./request-sheet";
import { setMaterialDocument } from "@/features/q/screen";
import { useT } from "@/features/i18n/language";

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

type IconType = ComponentType<{
  size?: number;
  "aria-hidden"?: boolean | "true";
  className?: string;
}>;

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
  new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
const dayMonth = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso));

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
      className="flex min-h-14 w-full items-center gap-3 py-3 text-start"
      data-folder={folder.code}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
        <Icon size={ICON_SIZE.regular} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="cq-body font-medium text-(--cq-text-primary)">
          {folder.label}
        </span>
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

/** Where the library is: "ALL", or one folder's code. */
type Shelf = string;

/** The newest change in the room, for the library's "Updated" line. */
function newest(documents: readonly DataRoomInvestorDocument[]): string | null {
  let at: string | null = null;
  for (const document of documents) {
    if (at === null || document.updatedAt > at) at = document.updatedAt;
  }
  return at;
}

/**
 * The library's own width decides whether the opened document sits beside
 * it or in a sheet: the room is narrower beside the profile's fit panel
 * than on its own page, so the window's width says too little.
 */
const BESIDE_PX = 900;
function useRoomWide(): [(node: HTMLElement | null) => void, boolean] {
  const [wide, setWide] = useState(false);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    // A runtime without ResizeObserver (a test DOM) reads as narrow.
    if (node === null || typeof ResizeObserver !== "function") return;
    const next = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWide(entry.contentRect.width >= BESIDE_PX);
    });
    next.observe(node);
    observer.current = next;
  }, []);
  return [measure, wide];
}

/**
 * The three steps to the room (Data room option 1, owner 2026-10-20), each
 * a word and a mark, never colour alone: done, now, or still to come.
 */
function Step({
  state,
  title,
  detail,
  children,
}: {
  readonly state: "DONE" | "NOW" | "LATER";
  readonly title: string;
  readonly detail?: string | undefined;
  readonly children?: ReactNode;
}) {
  const t = useT();
  return (
    <li className="cq-room-step" data-step={state.toLowerCase()}>
      <span className="cq-room-step-mark" aria-hidden="true">
        {state === "DONE" ? (
          <Check size={ICON_SIZE.compact} aria-hidden="true" />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="cq-body font-medium text-(--cq-text-primary)">
          <span className="sr-only">
            {state === "DONE"
              ? t("Done:")
              : state === "NOW"
                ? t("Now:")
                : t("Next:")}{" "}
          </span>
          {title}
        </span>
        {detail === undefined ? null : (
          <span className="cq-caption text-(--cq-text-secondary)">
            {detail}
          </span>
        )}
        {children}
      </span>
    </li>
  );
}

/**
 * The room before the founder accepts the investor's interest (founder
 * decision 2026-10-08): locked, with the three steps to open it. Folder
 * names and counts show only when the founder allows them; never titles.
 */
export function LockedDataRoom({
  companyId,
  companyName,
  locked,
  interest = null,
  relationshipState = null,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly locked: NonNullable<DataRoomInvestorView["locked"]>;
  readonly interest?: InterestDto | null | undefined;
  readonly relationshipState?: RelationshipStateV2 | null | undefined;
}) {
  const t = useT();
  const pending = locked.reason === "INTEREST_PENDING";
  const outline = locked.outline ?? [];
  const held = outline.reduce((sum, folder) => sum + folder.documents, 0);
  return (
    <section
      className="cq-room-locked"
      aria-label={t("Data room")}
      data-data-room="investor-locked"
      data-locked-reason={locked.reason}
    >
      <h2 className="cq-title-md flex items-center gap-3 text-(--cq-text-primary)">
        <Lock
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="cq-room-lock shrink-0"
        />
        {pending
          ? `Your interest is with ${companyName}.`
          : `${companyName}'s data room opens once you're connected.`}
      </h2>
      <p className="cq-body-sm max-w-2xl text-(--cq-text-secondary)">
        {outline.length === 0
          ? pending
            ? "Once they accept it, their data room opens here and you can request documents."
            : "Express interest to request data-room access. Once the founders accept, you can see their data room and ask for documents."
          : `It holds ${plural(held, "document")} in ${plural(outline.length, "folder")}. ${
              pending
                ? "Once they accept your interest, you can open what they share and request the rest."
                : "Express interest to request access; once the founders accept, you can open what they share and request the rest."
            }`}
      </p>
      <ol className="cq-room-steps" aria-label={t("How the room opens")}>
        <Step
          state={pending ? "DONE" : "NOW"}
          title={t("Express interest")}
          detail={
            pending && interest !== null
              ? `Sent ${dayMonth(interest.expressedAt)}`
              : pending
                ? t("Sent")
                : undefined
          }
        >
          {pending ? null : (
            <div className="pt-2" data-locked-cta>
              <ExpressInterest
                companyId={companyId}
                companyName={companyName}
                surface="COMPANY_PROFILE"
                initialInterest={interest}
                relationshipState={relationshipState}
              />
            </div>
          )}
        </Step>
        <Step
          state={pending ? "NOW" : "LATER"}
          title={`${companyName} accepts`}
          detail={pending ? t("Waiting on the founders") : undefined}
        />
        <Step
          state="LATER"
          title={t("The room opens")}
          detail={t("You’ll get a notification")}
        />
      </ol>
      {outline.length === 0 ? null : (
        <div className="flex flex-col gap-2" data-locked-outline>
          <p className="sr-only">{t("What’s in it, folder by folder:")}</p>
          <ul className="flex flex-wrap gap-2">
            {outline.map((folder) => {
              const Icon = FOLDER_ICONS[folder.code] ?? FileText;
              return (
                <li key={folder.code} className="cq-room-folder-chip">
                  <Icon size={ICON_SIZE.compact} aria-hidden="true" />
                  {folder.label}
                  <span className="text-(--cq-text-tertiary)">
                    {plural(folder.documents, "document")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

export function InvestorDataRoom({
  companyId,
  companyName,
  view,
  interest = null,
  relationshipState = null,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly view: DataRoomInvestorView;
  /** For the locked room's Express interest (the profile's own). */
  readonly interest?: InterestDto | null | undefined;
  readonly relationshipState?: RelationshipStateV2 | null | undefined;
}) {
  if (view.access === "LOCKED" && view.locked !== undefined)
    return (
      <LockedDataRoom
        companyId={companyId}
        companyName={companyName}
        locked={view.locked}
        interest={interest}
        relationshipState={relationshipState}
      />
    );
  return (
    <ConnectedDataRoom
      companyId={companyId}
      companyName={companyName}
      view={view}
    />
  );
}

/**
 * The connected room as a library (Data room option 1, owner 2026-10-20):
 * one next step for the room with its reason, folders on the left, the
 * documents in the middle with their access in words, and on a wide
 * screen the opened document beside them, so the place in the list is
 * kept. A phone opens the document in a sheet over the list.
 */
type RoomStep = {
  readonly key: "REQUEST" | "READ" | "ASK";
  readonly title: string;
  readonly reason: string;
  readonly action: string;
  readonly done: boolean;
};

const DAY_MS = 86_400_000;

/** Days left on a time-limited share, rounded up; never below zero. */
function daysLeft(endsAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / DAY_MS));
}

/** The room's three steps, from what is listed to this reader (pure). */
export function roomSteps(input: {
  readonly companyName: string;
  readonly documents: readonly DataRoomInvestorDocument[];
  readonly now: number;
}): readonly RoomStep[] {
  const { companyName: name, documents, now } = input;
  const requestable = documents.filter((d) => d.access === "REQUESTABLE");
  const expiring = documents
    .filter(
      (d) =>
        d.access === "OPEN" &&
        d.accessEndsAt !== null &&
        Date.parse(d.accessEndsAt) > now,
    )
    .sort(
      (a, b) =>
        Date.parse(a.accessEndsAt ?? "") - Date.parse(b.accessEndsAt ?? ""),
    );
  const unread = expiring.find((d) => d.openedAt === null) ?? expiring[0];
  const titles = requestable.slice(0, 2).map((d) => d.title);
  return [
    {
      key: "REQUEST",
      title:
        requestable.length === 0
          ? "Nothing left to request"
          : requestable.length === 1
            ? `Request ${requestable[0]?.title ?? "the document on request"}`
            : `Request the ${String(requestable.length)} documents on request`,
      reason:
        requestable.length === 0
          ? "Everything listed to you on request has been asked for."
          : `${titles.join(" and ")}${requestable.length > 2 ? ` and ${plural(requestable.length - 2, "other")}` : ""} ${requestable.length === 1 ? "is" : "are"} on request. ${name} decides who sees them.`,
      action:
        requestable.length === 1
          ? "Request it"
          : requestable.length === 2
            ? "Request both"
            : "Request all",
      done: requestable.length === 0,
    },
    {
      key: "READ",
      title:
        unread === undefined
          ? "Nothing shared for a limited time"
          : `Read ${unread.title} before ${dayMonth(unread.accessEndsAt ?? "")}`,
      reason:
        unread === undefined
          ? "Documents shared with you for a limited time appear here first."
          : `${name} shared it with you for ${plural(daysLeft(unread.accessEndsAt ?? "", now), "more day")}.`,
      action: "Open it",
      done: unread === undefined || unread.openedAt !== null,
    },
    {
      key: "ASK",
      title: "Ask Q what the room still doesn’t cover",
      reason:
        "Q compares what is here with what a diligence at this stage usually needs.",
      action: "Ask Q",
      done: false,
    },
  ];
}

function AccessTag({
  document,
  companyName,
  now,
}: {
  readonly document: DataRoomInvestorDocument;
  readonly companyName: string;
  readonly now: number;
}) {
  const t = useT();
  if (document.access === "REQUESTED")
    return (
      <span className="cq-room-tag" data-tone="claim">
        <History size={12} aria-hidden="true" />
        Requested, waiting on {companyName}
      </span>
    );
  if (document.access === "REQUESTABLE")
    return (
      <span className="cq-room-tag">
        <Lock size={12} aria-hidden="true" />
        {t("On request")}
      </span>
    );
  if (document.accessEndsAt !== null) {
    const left = daysLeft(document.accessEndsAt, now);
    return (
      <span className="cq-room-tag" data-tone="gap">
        <History size={12} aria-hidden="true" />
        Shared until {dayMonth(document.accessEndsAt)}
        <span
          className="cq-room-expiry"
          role="img"
          aria-label={`${plural(left, "day")} left`}
        >
          <b
            style={{
              width: `${String(Math.min(100, Math.round((left / DATA_ROOM_GRANT_DEFAULT_DAYS) * 100)))}%`,
            }}
          />
        </span>
      </span>
    );
  }
  return document.shownAs === "SHARED" ? (
    <span className="cq-room-tag" data-tone="positive">
      <Check size={12} aria-hidden="true" />
      {t("Shared with you")}
    </span>
  ) : (
    <span className="cq-room-tag" data-tone="positive">
      <Globe size={12} aria-hidden="true" />
      {t("Open to you")}
    </span>
  );
}

function ConnectedDataRoom({
  companyId,
  companyName,
  view,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly view: DataRoomInvestorView;
}) {
  const t = useT();
  const brief = useBrief();
  const { askNow } = useGlobalQ();
  const [measure, wide] = useRoomWide();
  const [shelf, setShelf] = useState<Shelf>("ALL");
  const [asking, setAsking] = useState<RoomRequestTarget | null>(null);
  const { requested, markRequested, shared } = useRoomRequests();
  const [askedNow, setAskedNow] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<{
    documentId: string;
    title: string;
    pages: number | null;
    file: OpenedFile | null;
  } | null>(null);
  const [readNow, setReadNow] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  // One open at a time, by document, never a shared "busy" flag: a slow or
  // failed open disabled every other document's Open (sc, 2026-10-16). A
  // newer click supersedes an older one; the older result is dropped.
  const [opening, setOpening] = useState<string | null>(null);
  const latest = useRef(0);
  const [now] = useState(() => Date.now());
  // Stress 2026-10-28 (S02-post): the document open in this viewer is on
  // screen for Q ("this deck", "what does it say"), as when Q opens one.
  // An id, never authority: the server reads it as them or not at all.
  const openedId = opened?.file == null ? null : opened.documentId;
  useEffect(() => {
    setMaterialDocument(
      openedId === null ? null : { companyId, documentId: openedId },
    );
    return () => setMaterialDocument(null);
  }, [companyId, openedId]);

  const documents = useMemo(
    () =>
      view.documents.map((document) => {
        const wasAsked =
          requested.has(document.documentId) ||
          (requested.has("*") && document.access === "REQUESTABLE");
        const read = readNow.has(document.documentId);
        return {
          ...document,
          ...(wasAsked ? { access: "REQUESTED" as const } : {}),
          ...(read && document.openedAt === null
            ? { openedAt: new Date(now).toISOString() }
            : {}),
        };
      }),
    [view.documents, requested, readNow, now],
  );
  const shown = documents.filter(
    (document) => shelf === "ALL" || document.folderCode === shelf,
  );
  const openCount = documents.filter(
    (document) => document.access === "OPEN",
  ).length;
  const folderLabel = new Map(
    view.folders.map((folder) => [folder.code, folder.label]),
  );
  const updated = newest(documents);
  const steps = roomSteps({ companyName, documents, now });
  const at = Math.max(
    0,
    steps.findIndex((step) => !step.done && !(step.key === "ASK" && asked)),
  );
  const step = steps[at];

  if (view.documents.length === 0) {
    return (
      <div className="flex flex-col gap-2 py-6" data-data-room="investor-empty">
        <p className="cq-body text-(--cq-text-primary)">
          Nothing in {companyName}&rsquo;s data room is open to you yet.
        </p>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t(
            "Documents they share with you, or list for you to request, appear here. Nothing here means nothing is shared with you yet, not that nothing exists.",
          )}
        </p>
      </div>
    );
  }

  const open = async (document: DataRoomInvestorDocument) => {
    const ticket = ++latest.current;
    setOpening(document.documentId);
    setMessage(null);
    setOpened({
      documentId: document.documentId,
      title: document.title,
      pages: document.pageCount,
      file: null,
    });
    try {
      const result = await openDocumentAction(companyId, document.documentId);
      if (ticket !== latest.current) return;
      if (result.ok) {
        setOpened({
          documentId: document.documentId,
          title: document.title,
          pages: document.pageCount,
          file: result.value,
        });
        setReadNow((previous) => new Set([...previous, document.documentId]));
      } else {
        setOpened(null);
        setMessage(result.message);
      }
    } catch {
      if (ticket === latest.current) {
        setOpened(null);
        setMessage(t("That couldn't be opened. Try again."));
      }
    } finally {
      if (ticket === latest.current) setOpening(null);
    }
  };

  const request = (target: RoomRequestTarget) => {
    if (shared && brief !== null) brief.requestDocuments(target);
    else setAsking(target);
  };
  const runStep = () => {
    if (step === undefined) return;
    if (step.key === "REQUEST") {
      const only = documents.filter((d) => d.access === "REQUESTABLE");
      request(only.length === 1 && only[0] !== undefined ? only[0] : "ALL");
    } else if (step.key === "READ") {
      const target = documents
        .filter((d) => d.access === "OPEN" && d.accessEndsAt !== null)
        .sort(
          (a, b) =>
            Date.parse(a.accessEndsAt ?? "") - Date.parse(b.accessEndsAt ?? ""),
        )
        .find((d) => d.openedAt === null);
      if (target !== undefined) void open(target);
    } else {
      setAsked(true);
      askNow(
        `What does ${companyName}'s data room still not cover that a diligence at this stage usually needs? Use only the documents and titles I can see here, and say what to request or ask for.`,
      );
    }
  };

  const shelves: readonly (readonly [Shelf, string, number, boolean])[] = [
    ["ALL", t("All documents"), documents.length, false],
    ...view.folders
      .map((folder) => {
        const inFolder = documents.filter(
          (document) => document.folderCode === folder.code,
        );
        return [
          folder.code,
          folder.label,
          inFolder.length,
          inFolder.length > 0 &&
            inFolder.every((document) => document.access !== "OPEN"),
        ] as const;
      })
      .filter(([, , count]) => count > 0),
  ];

  return (
    <section
      className="flex flex-col gap-5"
      aria-label={t("Data room")}
      data-data-room="investor"
      ref={measure}
    >
      {step === undefined ? null : (
        <div
          key={step.key}
          className="cq-brief-ribbon"
          style={{ marginBottom: 0 }}
          data-room-next={step.key}
        >
          <div className="rb">
            <p className="rk">
              <QMark />
              {t("Next step in the data room")}
            </p>
            <p className="rt">{step.title}</p>
            <p className="rw">{step.reason}</p>
            <span
              className="cq-brief-steps"
              role="img"
              aria-label={`Step ${String(at + 1)} of ${String(steps.length)}`}
            >
              {steps.map((one, index) => (
                <i
                  key={one.key}
                  data-step={
                    index === at
                      ? "now"
                      : one.done || index < at
                        ? "done"
                        : undefined
                  }
                />
              ))}
            </span>
          </div>
          <div className="ra">
            <button
              type="button"
              className={buttonClassName("primary")}
              onClick={runStep}
              data-room-step-action={step.key}
            >
              {step.action}
            </button>
          </div>
        </div>
      )}
      <div className="cq-room-library" data-room-library>
        <nav className="cq-room-shelves" aria-label={t("Folders")}>
          {shelves.map(([code, label, count, onRequest]) => {
            const Icon =
              code === "ALL"
                ? FileText
                : onRequest
                  ? Lock
                  : (FOLDER_ICONS[code] ?? FileText);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={shelf === code}
                onClick={() => setShelf(code)}
                className="cq-room-shelf"
                data-room-shelf={code}
              >
                <Icon size={ICON_SIZE.compact} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-start">{label}</span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="cq-body font-semibold text-(--cq-text-primary)">
              {plural(documents.length, "document")}, {openCount} open to you
            </h3>
            {updated === null ? null : (
              <p className="cq-caption text-(--cq-text-tertiary)">
                Updated {dayMonth(updated)}
              </p>
            )}
          </div>
          {message === null ? null : (
            <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
              {message}
            </p>
          )}
          <ul className="flex flex-col">
            {shown.map((document, index) => (
              <li
                key={`${shelf}-${document.documentId}`}
                className="cq-room-doc"
                style={{ animationDelay: `${String(index * 30)}ms` }}
                data-room-document={document.access}
                data-flash={askedNow.has(document.documentId) ? "" : undefined}
                data-selected={
                  opened?.documentId === document.documentId ? "" : undefined
                }
              >
                <span className="cq-room-doc-icon" aria-hidden="true">
                  {document.access === "OPEN" ? (
                    <FileText size={ICON_SIZE.compact} aria-hidden="true" />
                  ) : (
                    <Lock size={ICON_SIZE.compact} aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="cq-room-doc-name" title={document.title}>
                    {document.title}
                  </p>
                  <p className="cq-room-doc-meta">
                    <AccessTag
                      document={document}
                      companyName={companyName}
                      now={now}
                    />
                    {[
                      document.kind === null
                        ? null
                        : document.pageCount === null
                          ? document.kind
                          : `${document.kind}, ${plural(document.pageCount, "page")}`,
                      document.kind === null && document.pageCount !== null
                        ? plural(document.pageCount, "page")
                        : null,
                      shelf === "ALL"
                        ? (folderLabel.get(document.folderCode) ?? null)
                        : null,
                      document.validUntil === null
                        ? null
                        : `Valid to ${monthYear(document.validUntil)}`,
                    ]
                      .filter((part): part is string => part !== null)
                      .map((part) => (
                        <span key={part}>{part}</span>
                      ))}
                    {document.openedAt === null ? null : (
                      <span>
                        <Eye size={ICON_SIZE.compact} aria-hidden="true" />
                        {readNow.has(document.documentId) &&
                        view.documents.find(
                          (d) => d.documentId === document.documentId,
                        )?.openedAt === null
                          ? "You opened it today"
                          : `You opened it ${dayMonth(document.openedAt)}`}
                      </span>
                    )}
                  </p>
                  {document.declined === undefined ||
                  document.declined === null ? null : (
                    <p
                      className="cq-caption pt-1 text-(--cq-text-secondary)"
                      data-room-declined
                    >
                      Declined
                      {document.declined.note === null
                        ? ". You can ask again."
                        : `: “${document.declined.note}”`}
                    </p>
                  )}
                </div>
                {document.access === "OPEN" ? (
                  <button
                    type="button"
                    disabled={opening === document.documentId}
                    aria-busy={opening === document.documentId}
                    className={buttonClassName(
                      "secondary",
                      "compact",
                      "cq-room-act min-h-11 shrink-0",
                    )}
                    onClick={() => void open(document)}
                  >
                    {opening === document.documentId ? t("Opening") : t("Open")}
                  </button>
                ) : document.access === "REQUESTED" ? (
                  <span className="cq-room-act cq-caption inline-flex min-h-11 shrink-0 items-center text-(--cq-text-tertiary)">
                    {askedNow.has(document.documentId) ||
                    requested.has(document.documentId) ||
                    requested.has("*")
                      ? t("Asked today")
                      : t("Requested")}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={buttonClassName(
                      "secondary",
                      "compact",
                      "cq-room-act min-h-11 shrink-0",
                    )}
                    onClick={() => request(document)}
                  >
                    {t("Request")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="cq-room-note cq-caption text-(--cq-text-secondary)">
            <Eye size={ICON_SIZE.compact} aria-hidden="true" />
            <span>
              {companyName} can see when you open a document. Documents you
              can&rsquo;t download show your name on every page.
            </span>
          </p>
        </div>
        {wide ? (
          <div className="cq-room-preview" data-room-preview>
            {opened === null ? (
              <div className="flex flex-col items-center gap-2.5 text-center">
                <FileText
                  size={ICON_SIZE.prominent}
                  aria-hidden="true"
                  className="text-(--cq-text-tertiary)"
                />
                <p className="cq-body-sm text-(--cq-text-tertiary)">
                  {t("Choose a document to preview it here.")}
                </p>
                <p className="cq-caption text-(--cq-text-tertiary)">
                  {t("Previews keep your place in the list.")}
                </p>
              </div>
            ) : (
              <InlinePreview
                key={opened.documentId}
                companyName={companyName}
                title={opened.title}
                pages={opened.pages}
                file={opened.file}
                onClose={() => setOpened(null)}
                onAsk={() =>
                  askNow(
                    `About ${companyName}'s "${opened.title}" in their data room: what does it say, and what does it support or contradict in what they claim?`,
                  )
                }
              />
            )}
          </div>
        ) : null}
      </div>
      {shared ? null : (
        <RequestSheet
          companyId={companyId}
          companyName={companyName}
          target={asking}
          onClose={() => setAsking(null)}
          onSent={(target) => {
            markRequested(target);
            setAskedNow(
              (previous) =>
                new Set([
                  ...previous,
                  ...(target === "ALL"
                    ? documents
                        .filter((d) => d.access === "REQUESTABLE")
                        .map((d) => d.documentId)
                    : [target.documentId]),
                ]),
            );
            setAsking(null);
          }}
        />
      )}
      {wide ? null : (
        <FileViewer
          title={opened?.title ?? ""}
          file={opened?.file ?? null}
          onClose={() => setOpened(null)}
        />
      )}
    </section>
  );
}

/** The opened document beside the library: the bytes go browser <-> storage. */
function InlinePreview({
  companyName,
  title,
  pages,
  file,
  onClose,
  onAsk,
}: {
  readonly companyName: string;
  readonly title: string;
  readonly pages: number | null;
  /** Null while the signed link is being fetched: the page shimmers. */
  readonly file: OpenedFile | null;
  readonly onClose: () => void;
  readonly onAsk: () => void;
}) {
  const t = useT();
  const [ready, setReady] = useState(false);
  // Full screen keeps the reader's name over the page: the frame, not the file.
  const page = useRef<HTMLDivElement>(null);
  return (
    <div className="cq-room-preview-open flex w-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2.5">
        <p
          className="cq-body min-w-0 truncate font-semibold text-(--cq-text-primary)"
          title={title}
        >
          {title}
        </p>
        <span className="cq-caption shrink-0 text-(--cq-text-tertiary)">
          {pages === null ? null : `Page 1 of ${String(pages)}`}
        </span>
      </div>
      <div
        ref={page}
        className="cq-room-page"
        data-ready={ready && file !== null ? "" : undefined}
        aria-busy={!ready}
      >
        <div className="cq-room-shimmer" aria-hidden="true">
          {[92, 80, 60, 92, 40, 80, 92, 60, 80, 40].map((width, index) => (
            <i key={index} style={{ width: `${String(width)}%` }} />
          ))}
        </div>
        {file === null ? null : (
          <iframe
            src={
              file.downloadable ? file.url : `${file.url}#toolbar=0&navpanes=0`
            }
            title={title}
            referrerPolicy="no-referrer"
            onLoad={() => setReady(true)}
          />
        )}
        {file?.watermark === null || file === null ? null : (
          <Watermark words={file.watermark} />
        )}
      </div>
      <p className="cq-room-seen">
        <Eye size={ICON_SIZE.compact} aria-hidden="true" />
        {companyName} will see you opened this today
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAsk}
          className={buttonClassName("secondary", "compact")}
        >
          <QMark />
          {t("Ask Q about this")}
        </button>
        {file?.downloadable === true ? (
          <a
            href={file.downloadUrl ?? file.url}
            download
            className={buttonClassName("quiet", "compact")}
          >
            <Download size={ICON_SIZE.compact} aria-hidden="true" />{" "}
            {t("Download")}
          </a>
        ) : null}
        <button
          type="button"
          disabled={file === null}
          onClick={() =>
            void page.current?.requestFullscreen?.().catch(() => undefined)
          }
          className={buttonClassName("quiet", "compact")}
        >
          <Maximize2 size={ICON_SIZE.compact} aria-hidden="true" />{" "}
          {t("Full screen")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={buttonClassName("quiet", "compact", "ms-auto")}
        >
          {t("Close")}
        </button>
      </div>
      {file !== null && !file.downloadable ? (
        <p className="cq-caption flex items-center gap-1.5 text-(--cq-text-tertiary)">
          <Lock size={ICON_SIZE.compact} aria-hidden="true" />
          {t("View only. Your name is shown on every page.")}
        </p>
      ) : null}
    </div>
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
      className="grid w-full shrink-0 grid-cols-4 gap-1 rounded-md bg-(--cq-surface-subtle) p-1 lg:flex lg:w-auto"
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
            className={`cq-caption inline-flex min-h-11 flex-col items-center justify-center gap-0.5 rounded px-1 text-center sm:flex-row sm:gap-1 sm:px-2.5 lg:min-h-9 ${
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

/** Who asked for a document (2026-10-08): the data room ∩ requests. */
export type RequestedMark = {
  readonly who: string;
  readonly status: "OPEN" | "SHARED" | "DECLINED";
};

const REQUESTED_WORDS: Readonly<Record<RequestedMark["status"], string>> = {
  OPEN: "waiting",
  SHARED: "shared",
  DECLINED: "declined",
};

export function OwnerDataRoom({
  companyId,
  view,
  requested,
  onAccess,
  onFolderAccess,
  inDocuments = false,
}: {
  readonly companyId: string;
  readonly view: DataRoomOwnerView;
  /** Documents investors asked for, by document id, with who and where it stands. */
  readonly requested?:
    ReadonlyMap<string, readonly RequestedMark[]> | undefined;
  /** Opens the access editor for one document. */
  readonly onAccess?: ((document: DataRoomOwnerDocument) => void) | undefined;
  /** Opens the access editor for a folder. */
  readonly onFolderAccess?: ((folder: DataRoomFolder) => void) | undefined;
  /**
   * On the Documents page: requests are answered on the Requested tab, so
   * they are pointed to rather than repeated here.
   */
  readonly inDocuments?: boolean | undefined;
}) {
  const t = useT();
  const [documents, setDocuments] = useState(view.documents);
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    new Set(view.folders.map((folder) => folder.code).slice(3)),
  );
  const [days, setDays] = useState<Record<string, number>>({});
  const [answered, setAnswered] = useState<
    Record<string, "APPROVED" | "DECLINED">
  >({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [outline, setOutline] = useState(view.outlineBeforeConnection ?? false);

  const toggleOutline = () => {
    const next = !outline;
    setOutline(next);
    start(async () => {
      const result = await setOutlineAction({
        companyId,
        outlineBeforeConnection: next,
      });
      if (!result.ok) {
        setOutline(!next);
        setMessage(result.message);
      }
    });
  };

  // F10: an item filed here in this visit counts as present at once.
  const filedAs = (code: string) =>
    documents.some((d) => d.checklistItemCode === code);
  const present = view.checklist.filter(
    (item) => item.present || filedAs(item.code),
  ).length;
  const missing = view.checklist.filter(
    (item) => !item.present && !filedAs(item.code),
  );
  const stage = stageLabel(view.stageCode) ?? "your";
  const waiting = view.requests.filter(
    (request) =>
      request.status === "OPEN" && answered[request.requestId] === undefined,
  );
  const folders = useMemo(
    () =>
      view.folders.filter(
        (folder) =>
          documents.some((d) => d.folderCode === folder.code) ||
          missing.some((item) => item.folderCode === folder.code),
      ),
    [view.folders, documents, missing],
  );

  const setLevel = (document: DataRoomOwnerDocument, level: DataRoomLevel) => {
    const before = documents;
    setDocuments((current) =>
      current.map((d) =>
        d.documentId === document.documentId ? { ...d, level } : d,
      ),
    );
    start(async () => {
      const result = await setLevelAction({
        companyId,
        documentId: document.documentId,
        level,
        version: document.version,
      });
      if (!result.ok) {
        setDocuments(before);
        setMessage(result.message);
      } else {
        setDocuments((current) =>
          current.map((d) =>
            d.documentId === document.documentId
              ? { ...d, version: d.version + 1 }
              : d,
          ),
        );
      }
    });
  };

  // F10: file a document in a folder (or as a checklist item); its level
  // stays what it is.
  const fileAs = (document: DataRoomOwnerDocument, choice: string) => {
    const filing = filingOf(choice, view.checklist);
    if (filing === null) return;
    const before = documents;
    setDocuments((current) =>
      current.map((d) =>
        d.documentId === document.documentId ? { ...d, ...filing } : d,
      ),
    );
    start(async () => {
      const result = await setLevelAction({
        companyId,
        documentId: document.documentId,
        level: document.level,
        version: document.version,
        folderCode: filing.folderCode,
        checklistItemCode: filing.checklistItemCode,
      });
      if (!result.ok) {
        setDocuments(before);
        setMessage(result.message);
      } else {
        setDocuments((current) =>
          current.map((d) =>
            d.documentId === document.documentId
              ? { ...d, version: d.version + 1 }
              : d,
          ),
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
      if (result.ok)
        setAnswered((now) => ({
          ...now,
          [requestId]: decision === "APPROVE" ? "APPROVED" : "DECLINED",
        }));
      else setMessage(result.message);
    });

  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="data-room-title"
      data-data-room="owner"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="data-room-title"
            className="cq-title-md text-(--cq-text-primary)"
          >
            {t("Data room")}
          </h2>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(
              "What investors can see, folder by folder. You choose for each document. Investors see it once you accept their interest.",
            )}
          </p>
        </div>
        <Link
          href={inDocuments ? "/documents?tab=mine" : "/documents"}
          className={buttonClassName("primary", "regular")}
        >
          <Upload size={ICON_SIZE.compact} aria-hidden="true" />{" "}
          {t("Upload files")}
        </Link>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3"
        data-room-outline-setting
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="cq-body-sm text-(--cq-text-primary)">
            {t("Before you connect")}
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {outline
              ? "Investors not yet connected see folder names and counts. Titles and documents stay hidden."
              : "Investors not yet connected see only that your data room opens once you accept their interest."}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={outline}
          disabled={pending}
          onClick={toggleOutline}
          className={buttonClassName("secondary", "regular")}
        >
          {outline ? (
            <>
              <EyeOff size={ICON_SIZE.compact} aria-hidden="true" />{" "}
              {t("Hide folder names")}
            </>
          ) : (
            <>
              <Eye size={ICON_SIZE.compact} aria-hidden="true" />{" "}
              {t("Show folder names")}
            </>
          )}
        </button>
      </div>

      {view.checklist.length === 0 ? null : (
        <div
          className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
          data-readiness
        >
          <p className="cq-title-sm text-(--cq-text-primary)">
            {present} of {view.checklist.length} recommended for a{" "}
            {stage.toLowerCase()} round
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
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t("Everything investors usually ask for at this stage is here.")}
            </p>
          ) : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Still to add:{" "}
              {missing
                .slice(0, 3)
                .map(
                  (item) =>
                    item.label.charAt(0).toLowerCase() + item.label.slice(1),
                )
                .join(", ")}
              {missing.length > 3
                ? `, and ${String(missing.length - 3)} more`
                : ""}
              . A recommendation, not a requirement.
            </p>
          )}
        </div>
      )}

      {waiting.length === 0 ? null : inDocuments ? (
        <p className="cq-body-sm text-(--cq-text-secondary)" data-room-waiting>
          {plural(waiting.length, "request")} waiting for you.{" "}
          <Link
            href="/documents?tab=requested"
            className="text-(--cq-text-primary) underline underline-offset-2"
          >
            {t("Answer on Requested")}
          </Link>
        </p>
      ) : (
        <section
          className="flex flex-col gap-3"
          aria-labelledby="waiting-title"
        >
          <h3
            id="waiting-title"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            {t("Waiting for you")}
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
                    {[request.requesterName, request.requesterOrganisationName]
                      .filter(Boolean)
                      .join(", ") || "An investor"}
                  </p>
                  <p className="cq-body-sm text-(--cq-text-secondary)">
                    Asked for{" "}
                    <strong className="text-(--cq-text-primary)">
                      {request.documentTitle ?? "everything on request"}
                    </strong>
                    {request.note === null ? "." : `. “${request.note}”`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="cq-caption flex items-center gap-1 text-(--cq-text-secondary)">
                    <span className="sr-only">{t("How long")}</span>
                    <select
                      value={
                        days[request.requestId] ?? DATA_ROOM_GRANT_DEFAULT_DAYS
                      }
                      onChange={(event) =>
                        setDays((now) => ({
                          ...now,
                          [request.requestId]: Number(event.target.value),
                        }))
                      }
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
                    className={buttonClassName(
                      "primary",
                      "compact",
                      "min-h-11",
                    )}
                  >
                    {t("Share")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decide(request.requestId, "DECLINE")}
                    className={buttonClassName(
                      "secondary",
                      "compact",
                      "min-h-11",
                    )}
                  >
                    {t("Not now")}
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
        <p className="cq-body text-(--cq-text-secondary)">
          {t("Nothing here yet. Upload anything; you decide who sees it.")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
          {folders.map((folder) => {
            const inFolder = documents.filter(
              (d) => d.folderCode === folder.code,
            );
            const gaps = missing.filter(
              (item) => item.folderCode === folder.code,
            );
            const isOpen = !closed.has(folder.code);
            return (
              <li key={folder.code}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
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
                  </div>
                  {onFolderAccess === undefined ||
                  inFolder.length === 0 ? null : (
                    <button
                      type="button"
                      onClick={() => onFolderAccess(folder)}
                      className={buttonClassName(
                        "quiet",
                        "compact",
                        "min-h-11",
                      )}
                      data-folder-access={folder.code}
                    >
                      <Users size={ICON_SIZE.compact} aria-hidden="true" />
                      <span className="hidden sm:inline">
                        {t("Who can see this folder")}
                      </span>
                      <span className="sm:hidden">{t("Access")}</span>
                    </button>
                  )}
                </div>
                {isOpen ? (
                  <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
                    {inFolder.map((document) => (
                      <li
                        key={document.documentId}
                        className="flex flex-col gap-2 py-3 ps-1 lg:flex-row lg:items-center"
                        data-owner-document={document.level}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <FileText
                            size={ICON_SIZE.regular}
                            aria-hidden="true"
                            className="mt-0.5 shrink-0 text-(--cq-text-tertiary)"
                          />
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <p className="cq-body text-(--cq-text-primary)">
                              {document.title}
                            </p>
                            <p className="cq-caption flex flex-wrap items-center gap-x-2 text-(--cq-text-secondary)">
                              {[
                                document.kind,
                                document.pageCount === null
                                  ? null
                                  : plural(document.pageCount, "page"),
                                monthYear(document.updatedAt),
                              ]
                                .filter((part): part is string => part !== null)
                                .join(" · ")}
                              <span className="inline-flex items-center gap-1">
                                <Eye
                                  size={ICON_SIZE.compact}
                                  aria-hidden="true"
                                />
                                {document.level === "PRIVATE"
                                  ? "Only your team"
                                  : document.openedBy > 0
                                    ? `Opened by ${plural(document.openedBy, "investor")}`
                                    : document.sharedWith > 0
                                      ? `Shared with ${plural(document.sharedWith, "investor")}`
                                      : "Not opened yet"}
                              </span>
                            </p>
                            {(requested?.get(document.documentId) ?? []).map(
                              (mark) => (
                                <span
                                  key={`${mark.who}:${mark.status}`}
                                  className="cq-caption mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-(--cq-surface-subtle) px-2 py-0.5 text-(--cq-text-secondary)"
                                  data-requested-mark={mark.status}
                                >
                                  <History
                                    size={ICON_SIZE.compact}
                                    aria-hidden="true"
                                  />
                                  Requested by {mark.who} ·{" "}
                                  {t(REQUESTED_WORDS[mark.status])}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                        <FolderControl
                          document={document}
                          folders={view.folders}
                          checklist={view.checklist}
                          disabled={pending}
                          onChange={(choice) => fileAs(document, choice)}
                        />
                        <LevelControl
                          document={document}
                          disabled={pending}
                          onChange={(level) => setLevel(document, level)}
                        />
                        {onAccess === undefined ? null : (
                          <button
                            type="button"
                            onClick={() => onAccess(document)}
                            className={buttonClassName(
                              "secondary",
                              "compact",
                              "min-h-11",
                            )}
                            data-document-access={document.documentId}
                          >
                            {t("Access")}
                          </button>
                        )}
                      </li>
                    ))}
                    {gaps.map((item) => (
                      <li
                        key={item.code}
                        className="flex items-center gap-3 py-3 ps-1"
                        data-checklist-gap={item.code}
                      >
                        <Plus
                          size={ICON_SIZE.regular}
                          aria-hidden="true"
                          className="shrink-0 text-(--cq-text-tertiary)"
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <p className="cq-body text-(--cq-text-secondary)">
                            {item.label}
                          </p>
                          <p className="cq-caption text-(--cq-text-tertiary)">
                            {t("Usually expected")}
                          </p>
                        </div>
                        <Link
                          href="/documents"
                          className={buttonClassName(
                            "quiet",
                            "compact",
                            "min-h-11",
                          )}
                        >
                          {t("Add")}
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

/**
 * F10: "File in": a checklist item (which names its folder) or a folder
 * alone. Encoded as `item:<code>` / `folder:<code>`; null for anything else.
 */
export function filingOf(
  choice: string,
  checklist: readonly DataRoomChecklistItem[],
): {
  readonly folderCode: string;
  readonly checklistItemCode: string | null;
} | null {
  if (choice.startsWith("item:")) {
    const item = checklist.find((entry) => entry.code === choice.slice(5));
    return item === undefined
      ? null
      : { folderCode: item.folderCode, checklistItemCode: item.code };
  }
  if (choice.startsWith("folder:")) {
    const code = choice.slice(7);
    return code === "" ? null : { folderCode: code, checklistItemCode: null };
  }
  return null;
}

function FolderControl({
  document,
  folders,
  checklist,
  disabled,
  onChange,
}: {
  readonly document: DataRoomOwnerDocument;
  readonly folders: readonly DataRoomFolder[];
  readonly checklist: readonly DataRoomChecklistItem[];
  readonly disabled: boolean;
  readonly onChange: (choice: string) => void;
}) {
  const value =
    document.checklistItemCode === null
      ? `folder:${document.folderCode}`
      : `item:${document.checklistItemCode}`;
  return (
    <label className="cq-caption flex items-center gap-1 text-(--cq-text-secondary)">
      <span className="sr-only">File {document.title} in</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="cq-body-sm min-h-11 max-w-56 rounded-md border border-(--cq-border) bg-(--cq-surface) px-2 text-(--cq-text-primary)"
        data-folder-control
      >
        {folders.map((folder) => (
          <optgroup key={folder.code} label={folder.label}>
            {checklist
              .filter((item) => item.folderCode === folder.code)
              .map((item) => (
                <option key={item.code} value={`item:${item.code}`}>
                  {item.label}
                </option>
              ))}
            <option value={`folder:${folder.code}`}>
              Other in {folder.label}
            </option>
          </optgroup>
        ))}
      </select>
    </label>
  );
}
