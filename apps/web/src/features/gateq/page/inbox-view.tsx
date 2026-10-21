"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import type {
  GateqInboxDetailDto,
  GateqInboxDto,
  GateqInboxItemDto,
  GateqPassReason,
  QManifestRef,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  Archive,
  Check,
  CircleAlert,
  CircleHelp,
  Clock,
  Download,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Inbox,
  Link as LinkIcon,
  Lock,
  MessageSquare,
  Search,
  Send,
  Square,
  SquareCheck,
  Star,
  Tag,
  UserPlus,
  X,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { QPageState, QSection, useQDialog } from "@/features/q/q-section";
import { QPageFocus } from "@/features/q/q-subject";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";
import { qRef } from "@/features/q/q-ref";

import {
  ApplicationComparison,
  GATEQ_COMPARE_MAX,
} from "./application-comparison";
import { SubmittedBrief, SubmittedTranscript } from "./submitted-brief";
import { GateqUnicornAssessment } from "./unicorn-assessment";

import { FitGlyph } from "../fit-glyph";
import {
  archiveAction,
  assignAction,
  labelAction,
  loadDetailAction,
  noteAction,
  passAction,
  replyAction,
  starAction,
  type Done,
} from "./gateq-actions";
import { ErrorBlock, Skeleton, StateBlock } from "./gateq-chrome";
import {
  draftAsk,
  draftCall,
  draftPass,
  draftReply,
  dueWords,
  inPane,
  matchesSearch,
  monogram,
  onePageSummary,
  openQuestions,
  PANE_VIEWS,
  paneCounts,
  paneWhy,
  PASS_REASONS,
  qualifiesOf,
  QUALIFIES_WORDS,
  qView,
  receivedWords,
  shortcutFor,
  submittedWords,
  type PaneView,
} from "./inbox-model";
import { useT } from "@/features/i18n/language";

/**
 * The investor's GateQ inbox (F4; design a/gateq.html "Investor: GateQ
 * inbox"): every founder who came through their gate, like a mail client.
 * Views and counts, stars, labels, bulk select, a reply-by clock, assign,
 * team notes, a preview pane on desktop and a full-screen detail on a
 * phone, the download pack, a pass that always carries a reason and is
 * sent only as approved, and Gmail's keys.
 *
 * Every change goes through the API under GateQ's own gateway authority;
 * stars and archive update at once and settle with the server. A member
 * who may not act for the firm sees the decision buttons disabled with
 * the reason, and the server refuses them anyway.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

export type InboxDemo = {
  readonly details: Readonly<Record<string, GateqInboxDetailDto>>;
  readonly checked?: readonly string[];
  /** Design review only (/dev/gateq-review): a sheet already open. */
  readonly sheet?: "pass" | "pack" | "book" | "ask" | "reply" | null;
  readonly phoneDetail?: boolean;
  readonly selected?: string;
};

export type InboxViewProps = {
  readonly inbox: GateqInboxDto | null;
  readonly state: "full" | "loading" | "empty" | "error";
  readonly initialDetail: GateqInboxDetailDto | null;
  /**
   * A deep link (?item=) named an application this investor cannot see (or
   * none at all): say so, and open nothing in its place.
   */
  readonly missingItem?: boolean | undefined;
  readonly gateLink: string;
  readonly fund: string;
  /** Where a view chip goes; the view's name is appended. */
  readonly viewBase?: string;
  /** The saved view the inbox opens on (design gateq-2). */
  readonly initialPane?: PaneView | undefined;
  readonly demo?: InboxDemo;
};

/** What a reply is for: a plain reply, a call, or more information. */
type ReplyDraft = "REPLY" | "CALL" | "ASK";

type Sheet =
  | { readonly kind: "pass"; readonly ids: readonly string[] }
  | {
      readonly kind: "reply";
      readonly id: string;
      readonly draft?: ReplyDraft | undefined;
    }
  | { readonly kind: "pack"; readonly id: string }
  | { readonly kind: "assign"; readonly ids: readonly string[] }
  | { readonly kind: "label"; readonly ids: readonly string[] }
  | { readonly kind: "keys" }
  | { readonly kind: "triage" }
  | { readonly kind: "compare"; readonly ids: readonly string[] };

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

const SHORTCUTS_KEY = "cq.gateq.shortcuts.v1";

const noSubscription = () => () => undefined;
function readShortcutsSetting(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUTS_KEY) !== "off";
  } catch {
    // Storage can be blocked; shortcuts stay on.
    return true;
  }
}

export function InboxView({
  inbox,
  state,
  initialDetail,
  missingItem = false,
  gateLink,
  fund,
  viewBase = "/gateq?tab=inbox&view=",
  initialPane = "ALL",
  demo,
}: InboxViewProps) {
  const t = useT();

  const router = useRouter();
  const viewHref = (view: string) => `${viewBase}${view}`;
  const desktop = useIsDesktop();
  const [items, setItems] = useState<readonly GateqInboxItemDto[]>(
    inbox?.items ?? [],
  );
  // A fresh list from the server replaces the optimistic one.
  const [source, setSource] = useState(inbox);
  if (source !== inbox) {
    setSource(inbox);
    setItems(inbox?.items ?? []);
  }
  const [selected, setSelected] = useState<string | null>(
    demo?.selected ??
      initialDetail?.item.applicationId ??
      (missingItem ? null : (inbox?.items[0]?.applicationId ?? null)),
  );
  const [details, setDetails] = useState<
    Readonly<Record<string, GateqInboxDetailDto>>
  >(() => ({
    ...(demo?.details ?? {}),
    ...(initialDetail === null
      ? {}
      : { [initialDetail.item.applicationId]: initialDetail }),
  }));
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    new Set(demo?.checked ?? []),
  );
  const [phoneOpen, setPhoneOpen] = useState(demo?.phoneDetail === true);
  const [sheet, setSheet] = useState<Sheet | null>(() => {
    const id = demo?.selected ?? inbox?.items[0]?.applicationId;
    if (demo?.sheet === "pass" && id !== undefined)
      return { kind: "pass", ids: [id] };
    if (demo?.sheet === "pack" && id !== undefined) return { kind: "pack", id };
    if (demo?.sheet === "book" && id !== undefined)
      return { kind: "reply", id, draft: "CALL" };
    if (demo?.sheet === "ask" && id !== undefined)
      return { kind: "reply", id, draft: "ASK" };
    if (demo?.sheet === "reply" && id !== undefined)
      return { kind: "reply", id };
    return null;
  });
  const [search, setSearch] = useState("");
  const [pane, setPane] = useState<PaneView>(initialPane);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const storedShortcuts = useSyncExternalStore(
    noSubscription,
    readShortcutsSetting,
    () => true,
  );
  const [shortcutsOverride, setShortcutsOn] = useState<boolean | null>(null);
  const shortcutsOn = shortcutsOverride ?? storedShortcuts;
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const say = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(
      () => setToast((current) => (current === message ? null : current)),
      2600,
    );
  }, []);

  const gatewayId = inbox?.gateway.id ?? "";
  const canDecide = inbox?.viewer.canDecide ?? false;
  const solo = inbox?.viewer.solo ?? true;
  const onInboxFolder = (inbox?.view ?? "INBOX") === "INBOX";
  const viewerUserId = inbox?.viewer.userId ?? "";
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          matchesSearch(item, search) &&
          (!onInboxFolder || inPane(item, pane, viewerUserId)),
      ),
    [items, search, onInboxFolder, pane, viewerUserId],
  );
  const current =
    visible.find((item) => item.applicationId === selected) ??
    (missingItem && selected === null ? null : visible[0]) ??
    null;
  const detail =
    current === null ? null : (details[current.applicationId] ?? null);

  const applicationFocus: QManifestRef | undefined =
    state === "full" &&
    (desktop || phoneOpen) &&
    detail !== null &&
    current?.applicationId === detail.item.applicationId
      ? { kind: "GATEQ_APPLICATION", id: detail.item.applicationId }
      : undefined;
  const selectedRefs: QManifestRef[] = items
    .filter((item) => checked.has(item.applicationId))
    .map((item) => ({ kind: "GATEQ_APPLICATION", id: item.applicationId }));
  useQDialog(
    phoneOpen && !desktop && applicationFocus !== undefined,
    "gateq-application-dialog",
    "APPLICATION",
    applicationFocus === undefined ? [] : [applicationFocus],
    "Submitted GateQ application",
  );

  const run = useCallback(
    (work: () => Promise<Done<unknown>>, after?: string) => {
      if (demo !== undefined) {
        if (after !== undefined) say(after);
        return;
      }
      startTransition(async () => {
        const done = await work();
        if (!done.ok) {
          say(done.message);
          router.refresh();
          return;
        }
        if (after !== undefined) say(after);
        router.refresh();
      });
    },
    [demo, router, say],
  );

  const open = useCallback(
    (id: string) => {
      setSelected(id);
      setItems((all) =>
        all.map((item) =>
          item.applicationId === id ? { ...item, unread: false } : item,
        ),
      );
      if (!desktop) setPhoneOpen(true);
      if (details[id] !== undefined || demo !== undefined) return;
      startTransition(async () => {
        const loaded = await loadDetailAction(gatewayId, id);
        if (loaded.ok) setDetails((all) => ({ ...all, [id]: loaded.value }));
        else say(loaded.message);
      });
    },
    [desktop, details, demo, gatewayId, say],
  );

  const targets = useCallback(
    (fallback?: string): readonly string[] =>
      checked.size > 0
        ? [...checked]
        : fallback === undefined
          ? []
          : [fallback],
    [checked],
  );

  const star = useCallback(
    (ids: readonly string[], starred: boolean) => {
      setItems((all) =>
        all.map((item) =>
          ids.includes(item.applicationId) ? { ...item, starred } : item,
        ),
      );
      run(() => starAction(gatewayId, { applicationIds: ids, starred }));
    },
    [gatewayId, run],
  );

  const archive = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      setItems((all) =>
        all.filter((item) => !ids.includes(item.applicationId)),
      );
      setChecked(new Set());
      setPhoneOpen(false);
      run(
        () => archiveAction(gatewayId, { applicationIds: ids, archived: true }),
        ids.length === 1 ? "Archived." : `${ids.length} archived.`,
      );
    },
    [gatewayId, run],
  );

  const move = useCallback(
    (step: 1 | -1) => {
      if (visible.length === 0) return;
      const index = Math.max(
        0,
        visible.findIndex(
          (item) => item.applicationId === current?.applicationId,
        ),
      );
      const next =
        visible[Math.min(visible.length - 1, Math.max(0, index + step))];
      if (next === undefined) return;
      setSelected(next.applicationId);
      if (desktop) open(next.applicationId);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-id="${next.applicationId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    [current, desktop, open, visible],
  );

  useEffect(() => {
    if (!shortcutsOn || state !== "full") return;
    const onKey = (event: KeyboardEvent) => {
      if (sheet !== null) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const command = shortcutFor({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target:
          target === null
            ? null
            : {
                tagName: target.tagName,
                isContentEditable: target.isContentEditable,
              },
      });
      if (command === null) return;
      const id = current?.applicationId;
      switch (command) {
        case "NEXT":
          move(1);
          break;
        case "PREVIOUS":
          move(-1);
          break;
        case "ARCHIVE":
          archive(targets(id));
          break;
        case "STAR":
          if (id !== undefined) star(targets(id), !(current?.starred ?? false));
          break;
        case "PASS":
          if (canDecide && id !== undefined)
            setSheet({ kind: "pass", ids: targets(id) });
          break;
        case "SEARCH":
          setSearching(true);
          window.setTimeout(() => searchRef.current?.focus(), 0);
          break;
        case "SELECT":
          if (id !== undefined) {
            setChecked((all) => {
              const next = new Set(all);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }
          break;
        case "OPEN":
          if (id !== undefined) open(id);
          break;
        case "BACK":
          setPhoneOpen(false);
          break;
        case "REPLY":
          if (canDecide && id !== undefined) setSheet({ kind: "reply", id });
          break;
        case "DOWNLOAD":
          if (id !== undefined) setSheet({ kind: "pack", id });
          break;
        case "HELP":
          setSheet({ kind: "keys" });
          break;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    archive,
    canDecide,
    current,
    move,
    open,
    sheet,
    shortcutsOn,
    star,
    state,
    targets,
  ]);

  // ------------------------------------------------------------------------
  // Design gateq-2 (2026-10-21): three panes. Saved views, the applications,
  // and the open dossier; on a phone the views are chips and the dossier is
  // a sheet.

  const viewerId = inbox?.viewer.userId ?? "";
  const onInbox = (inbox?.view ?? "INBOX") === "INBOX";
  const counts = onInbox ? paneCounts(items, viewerId) : null;
  const serverCounts: Readonly<Record<PaneView, number | null>> = {
    ALL: inbox?.counts.INBOX ?? 0,
    FIRST: inbox?.counts.FITS ?? 0,
    TODAY: null,
    MINE: inbox?.counts.ASSIGNED_TO_ME ?? 0,
    OUTSIDE: inbox?.counts.NOT_A_FIT ?? 0,
  };
  // Assigned-to-me only means something in a firm of more than one.
  const panes = PANE_VIEWS.filter(([key]) => !(solo && key === "MINE"));

  const views = (variant: "pane" | "chips") => (
    <nav
      className={variant === "pane" ? "gq2-views" : "gq2-chips"}
      aria-label={t("Views")}
    >
      {panes.map(([key, label]) => {
        const n = counts?.[key] ?? serverCounts[key];
        const count =
          variant === "pane" && n !== null ? (
            <span className="gq2-n">{n}</span>
          ) : null;
        return onInbox ? (
          <button
            key={key}
            type="button"
            aria-pressed={pane === key}
            onClick={() => {
              setPane(key);
              setChecked(new Set());
            }}
          >
            <span>{t(label)}</span>
            {count}
          </button>
        ) : (
          <Link key={key} href={`${viewHref("INBOX")}&pane=${key}`}>
            <span>{t(label)}</span>
            {count}
          </Link>
        );
      })}
      {variant === "pane" ? <span className="gq2-sep" aria-hidden /> : null}
      {FOLDER_VIEWS.map(([view, label]) => (
        <Link
          key={view}
          href={viewHref(view)}
          aria-current={inbox?.view === view ? "page" : undefined}
        >
          <span>{t(label)}</span>
          {variant === "pane" &&
          view === "STARRED" &&
          (inbox?.counts.STARRED ?? 0) > 0 ? (
            <span className="gq2-n">{inbox?.counts.STARRED}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );

  if (state === "loading") {
    return (
      <div className="gq2-panes" aria-busy="true">
        <div className="gq2-views">
          {[1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} width="100%" height={36} />
          ))}
        </div>
        <div className="gq2-list">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="gq2-row">
              <Skeleton width="36px" height={36} />
              <div className="flex flex-col gap-1.5">
                <Skeleton width="50%" height={15} />
                <Skeleton width="80%" height={12} />
                <Skeleton width="100%" height={20} />
              </div>
            </div>
          ))}
        </div>
        <div className="gq2-dossier" data-content-pane>
          <div className="gq2-dos">
            <Skeleton width="60%" height={22} />
            <Skeleton width="100%" height={160} />
            <Skeleton width="100%" height={44} />
          </div>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <>
        {views("chips")}
        <ErrorBlock
          t={t}
          what="Your GateQ inbox"
          retryHref={viewHref(inbox?.view ?? "INBOX")}
        />
      </>
    );
  }

  if (state === "empty" || inbox === null || items.length === 0) {
    return (
      <>
        {inbox === null ? null : views("chips")}
        <div
          className="grid items-start gap-6"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}
        >
          <StateBlock
            icon={
              <Inbox
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
            }
            title={
              inbox?.view === "INBOX" || inbox === null
                ? t("No applications yet")
                : t("Nothing here")
            }
            body={
              inbox?.view === "INBOX" || inbox === null
                ? t(
                    "Share your gate and founders can check their fit with you in two minutes. Only companies that meet your rules can send.",
                  )
                : t("Nothing in this view right now.")
            }
          >
            <CopyLink
              text={gateLink}
              onCopied={() => say("Gate link copied")}
              primary
            />
            <Link
              href="/gateq?tab=gate"
              className={buttonClassName("secondary")}
            >
              {t("Preview the form")}
            </Link>
          </StateBlock>
          <div className="gq-card flex flex-col gap-2 p-4">
            <p className="cq-label gq-t2">{t("Your gate link")}</p>
            <p
              className="cq-body break-all"
              style={{
                fontFamily: "var(--cq-font-mono, monospace)",
                fontSize: 14,
              }}
            >
              {t(gateLink.replace(/^https?:\/\//, ""))}
            </p>
            <p className="cq-caption gq-t3">
              {t("Also as a QR code and a snippet for your website.")}
            </p>
          </div>
        </div>
        <Toast message={toast} />
      </>
    );
  }

  const bulk =
    checked.size === 0 ? null : (
      <div
        className="gq-bulk"
        role="toolbar"
        aria-label={t(`${checked.size} selected`)}
      >
        <b className="px-2 font-medium">
          {checked.size} {t("selected")}
        </b>
        <button
          type="button"
          disabled={
            checked.size < 2 ||
            checked.size > GATEQ_COMPARE_MAX ||
            selectedRefs.length !== checked.size
          }
          onClick={() => setSheet({ kind: "compare", ids: [...checked] })}
        >
          {t("Compare")}
        </button>
        {checked.size > GATEQ_COMPARE_MAX ? (
          <span className="cq-caption">
            {t("Select up to")} {GATEQ_COMPARE_MAX}{" "}
            {t("applications to compare.")}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setSheet({ kind: "label", ids: [...checked] })}
        >
          <Tag {...icon} />
          {t("Label")}
        </button>
        {solo || !canDecide ? null : (
          <button
            type="button"
            onClick={() => setSheet({ kind: "assign", ids: [...checked] })}
          >
            <UserPlus {...icon} />
            {t("Assign")}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            // One zip each, from the same audited route as a single pack.
            for (const id of checked) {
              const link = document.createElement("a");
              link.href = `/gateq/pack/${gatewayId}/${id}`;
              link.download = "";
              if (demo === undefined) link.click();
            }
            say(`Preparing ${checked.size} packs.`);
          }}
        >
          <Download {...icon} />
          {t("Download packs")}
        </button>
        <button type="button" onClick={() => archive([...checked])}>
          <Archive {...icon} />
          {t("Archive")}
        </button>
        {canDecide ? (
          <button
            type="button"
            onClick={() => setSheet({ kind: "pass", ids: [...checked] })}
          >
            {t("Pass…")}
          </button>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t("Clear selection")}
          onClick={() => setChecked(new Set())}
        >
          <X {...icon} />
        </button>
      </div>
    );

  const list = (
    <div
      className="gq2-list"
      ref={listRef}
      role="listbox"
      aria-label={t("Applications")}
      aria-multiselectable="true"
    >
      {searching ? (
        <label className="gq-search gq2-search">
          <span className="sr-only">{t("Search applications")}</span>
          <Search {...icon} />
          <input
            ref={searchRef}
            className="gq-input"
            style={{ minHeight: 40 }}
            value={search}
            placeholder={t("Search")}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearch("");
                setSearching(false);
              }
            }}
          />
        </label>
      ) : null}
      {visible.length === 0 ? (
        <p className="cq-body-sm gq-t2 gq2-none">
          {t("Nothing in this view right now.")}
        </p>
      ) : (
        visible.map((item) => (
          <Row
            key={item.applicationId}
            item={item}
            selected={item.applicationId === current?.applicationId}
            checked={checked.has(item.applicationId)}
            picking={checked.size > 0}
            onOpen={() => open(item.applicationId)}
            onCheck={() =>
              setChecked((all) => {
                const next = new Set(all);
                if (next.has(item.applicationId))
                  next.delete(item.applicationId);
                else next.add(item.applicationId);
                return next;
              })
            }
            onStar={() => star([item.applicationId], !item.starred)}
          />
        ))
      )}
    </div>
  );

  const founderOf = (id: string) =>
    details[id]?.dossier?.contact?.name ?? details[id]?.contact.name ?? null;

  const dossierPane =
    current === null ? null : (
      <Dossier
        item={current}
        detail={detail}
        canDecide={canDecide}
        solo={solo}
        fund={fund}
        onBook={() => {
          setPhoneOpen(false);
          setSheet({ kind: "reply", id: current.applicationId, draft: "CALL" });
        }}
        onReply={() => {
          setPhoneOpen(false);
          setSheet({ kind: "reply", id: current.applicationId });
        }}
        onAsk={() => {
          setPhoneOpen(false);
          setSheet({ kind: "reply", id: current.applicationId, draft: "ASK" });
        }}
        onPass={() => {
          setPhoneOpen(false);
          setSheet({ kind: "pass", ids: [current.applicationId] });
        }}
        onAssign={() =>
          setSheet({ kind: "assign", ids: [current.applicationId] })
        }
        onPack={() => {
          setPhoneOpen(false);
          setSheet({ kind: "pack", id: current.applicationId });
        }}
        onLabel={() =>
          setSheet({ kind: "label", ids: [current.applicationId] })
        }
        onArchive={() => archive([current.applicationId])}
        onStar={() => star([current.applicationId], !current.starred)}
        onNote={(body) =>
          run(
            () =>
              noteAction(gatewayId, current.applicationId, {
                body,
                clientRequestId: key("note"),
              }),
            "Noted for your team.",
          )
        }
      />
    );

  return (
    <>
      <QPageState tab="inbox" focus={applicationFocus} />
      {applicationFocus === undefined ? null : (
        <QSection
          id="gateq-application"
          kind="GATEQ_APPLICATION"
          refs={[applicationFocus]}
          label={t("Submitted GateQ application")}
        />
      )}
      {selectedRefs.length === 0 ? (
        bulk
      ) : (
        <QSection
          id="gateq-selection"
          kind="GATEQ_INBOX"
          refs={selectedRefs}
          label={t("Selected GateQ applications")}
        >
          {bulk}
        </QSection>
      )}
      {/* Q's panel is about the application being read, not the reader's
          own organisation (live check 2026-10-16). */}
      <QPageFocus
        label={
          applicationFocus === undefined || current === null
            ? null
            : t(`${current.companyName}'s application`)
        }
      />
      <QSection
        id="gateq-inbox"
        kind="GATEQ_INBOX"
        refs={visible.map((item) => ({
          kind: "GATEQ_APPLICATION",
          id: item.applicationId,
        }))}
        label={t("GateQ inbox")}
      >
        {desktop ? null : views("chips")}
        <div className="gq2-panes">
          {desktop ? views("pane") : null}
          {list}
          {desktop ? (
            <div className="gq2-dossier" aria-live="polite" data-content-pane>
              {dossierPane}
            </div>
          ) : null}
        </div>
      </QSection>
      <p className="cq-caption gq-t3 mt-3">
        {inbox.counts.NOT_A_FIT > 0 && onInbox && pane !== "OUTSIDE"
          ? t(
              `${inbox.counts.NOT_A_FIT} application${inbox.counts.NOT_A_FIT === 1 ? "" : "s"} outside your rules ${inbox.counts.NOT_A_FIT === 1 ? "is" : "are"} under Outside your rules. `,
            )
          : ""}
        {t("Q never passes on your behalf.")}{" "}
        {shortcutsOn ? (
          <>
            {t("Keys:")} <span className="gq-kbd">j</span>{" "}
            <span className="gq-kbd">k</span> {t("move,")}{" "}
            <span className="gq-kbd">x</span> {t("select,")}{" "}
            <span className="gq-kbd">s</span> {t("star,")}{" "}
            <span className="gq-kbd">e</span> {t("archive,")}{" "}
            <span className="gq-kbd">#</span> {t("pass,")}{" "}
            <span className="gq-kbd">/</span> {t("search.")}{" "}
          </>
        ) : (
          t("Keyboard shortcuts are off. ")
        )}
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={() => {
            const next = !shortcutsOn;
            setShortcutsOn(next);
            try {
              window.localStorage.setItem(SHORTCUTS_KEY, next ? "on" : "off");
            } catch {
              // Not remembered; still applies now.
            }
          }}
        >
          {t("Turn")} {shortcutsOn ? "off" : "on"}
        </button>
      </p>

      {/* On a phone the dossier opens as a sheet (design gateq-2). */}
      <SheetRoot
        open={phoneOpen && !desktop && current !== null}
        onOpenChange={(next) => (next ? undefined : setPhoneOpen(false))}
      >
        {phoneOpen && !desktop && current !== null ? (
          <SheetContent
            title={current.companyName}
            description={current.oneLiner ?? undefined}
            side="bottom"
            className="cq-charcoal"
          >
            <div className="gq2-sheet">{dossierPane}</div>
          </SheetContent>
        ) : null}
      </SheetRoot>

      <Sheets
        sheet={sheet}
        onClose={() => setSheet(null)}
        items={items}
        details={details}
        inbox={inbox}
        fund={fund}
        demo={demo !== undefined}
        founderOf={founderOf}
        onPassed={(ids, reasonCode, messages) => {
          setSheet(null);
          setItems((all) =>
            all.filter((item) => !ids.includes(item.applicationId)),
          );
          setChecked(new Set());
          setPhoneOpen(false);
          run(
            async () => {
              for (const id of ids) {
                const done = await passAction(gatewayId, id, {
                  reasonCode,
                  message: messages[id] ?? "",
                  clientRequestId: key("pass"),
                });
                if (!done.ok) return done;
              }
              return { ok: true, value: null };
            },
            ids.length === 1
              ? "Passed with a reason. They got your exact message."
              : `${ids.length} passes sent, each with your exact message.`,
          );
        }}
        onReplied={(id, message, draft) => {
          setSheet(null);
          run(
            () =>
              replyAction(gatewayId, id, {
                message,
                clientRequestId: key("reply"),
              }),
            draft === "CALL"
              ? "Sent after your approval. They're asked for times for a call."
              : draft === "ASK"
                ? "Sent after your approval: your questions, exactly as shown."
                : "Reply sent.",
          );
        }}
        onAssigned={(ids, userId) => {
          setSheet(null);
          setChecked(new Set());
          run(
            () =>
              assignAction(gatewayId, {
                applicationIds: ids,
                assigneeUserId: userId,
              }),
            userId === null ? "Unassigned." : "Assigned.",
          );
        }}
        onPreparePasses={(ids) => setSheet({ kind: "pass", ids })}
        onLabelled={(ids, label) => {
          setSheet(null);
          setChecked(new Set());
          setItems((all) =>
            all.map((item) =>
              ids.includes(item.applicationId) && !item.labels.includes(label)
                ? { ...item, labels: [...item.labels, label] }
                : item,
            ),
          );
          run(
            () =>
              labelAction(gatewayId, { applicationIds: ids, label, on: true }),
            `Labelled "${label}".`,
          );
        }}
      />
      <Toast message={toast} />
    </>
  );
}

// ---------------------------------------------------------------------------

const FOLDER_VIEWS = [
  ["STARRED", "Starred"],
  ["PASSED", "Passed"],
  ["ARCHIVED", "Archived"],
] as const;

function QualifiesTag({ item }: { readonly item: GateqInboxItemDto }) {
  const t = useT();
  const q = qualifiesOf(item);
  return (
    <span className={`gq2-tag gq2-q-${q.toLowerCase()}`}>
      {q === "YES" ? (
        <Check {...icon} size={12} />
      ) : q === "NO" ? (
        <X {...icon} size={12} />
      ) : (
        <CircleHelp {...icon} size={12} />
      )}
      {t(QUALIFIES_WORDS[q])}
    </span>
  );
}

function Row({
  item,
  selected,
  checked,
  picking,
  onOpen,
  onCheck,
  onStar,
}: {
  readonly item: GateqInboxItemDto;
  readonly selected: boolean;
  readonly checked: boolean;
  /** Something is selected: every row shows its checkbox. */
  readonly picking: boolean;
  readonly onOpen: () => void;
  readonly onCheck: () => void;
  readonly onStar: () => void;
}) {
  const t = useT();

  const due = dueWords(item);
  return (
    <div
      data-id={item.applicationId}
      {...qRef("GATEQ_APPLICATION", item.applicationId)}
      className={`gq2-row${item.unread ? " gq2-unread" : ""}${picking ? " gq2-picking" : ""}`}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="gq2-lead">
        <span className="gq2-mono" aria-hidden>
          {monogram(item.companyName)}
        </span>
        <button
          type="button"
          className="gq2-ck"
          role="checkbox"
          aria-checked={checked}
          aria-label={t(`Select ${item.companyName}`)}
          onClick={(event) => {
            event.stopPropagation();
            onCheck();
          }}
        >
          {checked ? (
            <SquareCheck {...icon} size={18} />
          ) : (
            <Square {...icon} size={18} />
          )}
        </button>
      </span>
      <span className="gq2-main">
        <b>
          {item.companyName}
          {item.unread ? (
            <span className="sr-only"> {t("(unread)")}</span>
          ) : null}
        </b>
        {item.oneLiner === null ? null : (
          <span className="gq2-s">{t(item.oneLiner)}</span>
        )}
        <span className="gq2-w">{t(paneWhy(item))}</span>
      </span>
      <QualifiesTag item={item} />
      <span className={`gq2-due${due?.late === true ? " gq2-late" : ""}`}>
        {due?.late === true ? <Clock {...icon} size={14} /> : null}
        {due === null ? null : t(due.text)}
        {item.assignee === null ? null : (
          <span
            className="gq-ini ms-auto"
            title={t(`Assigned to ${item.assignee.name}`)}
          >
            {item.assignee.initials}
          </span>
        )}
      </span>
      <button
        type="button"
        className="gq2-st"
        aria-pressed={item.starred}
        aria-label={t(
          `${item.starred ? "Unstar" : "Star"} ${item.companyName}`,
        )}
        onClick={(event) => {
          event.stopPropagation();
          onStar();
        }}
      >
        <Star {...icon} fill={item.starred ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

/**
 * The open application (design gateq-2): whether it qualifies and when it
 * was frozen, the one-page summary with where each part came from, answers
 * that disagree (both kept), the dossier's open questions, and the three
 * decisions, each prepared for the investor's approval. Below: the full
 * submission, the team's notes and what has happened.
 */
function Dossier({
  item,
  detail,
  canDecide,
  solo,
  fund,
  onBook,
  onReply,
  onAsk,
  onPass,
  onAssign,
  onPack,
  onLabel,
  onArchive,
  onStar,
  onNote,
}: {
  readonly item: GateqInboxItemDto;
  readonly detail: GateqInboxDetailDto | null;
  readonly canDecide: boolean;
  readonly solo: boolean;
  readonly fund: string;
  readonly onBook: () => void;
  readonly onReply: () => void;
  readonly onAsk: () => void;
  readonly onPass: () => void;
  readonly onAssign: () => void;
  readonly onPack: () => void;
  readonly onLabel: () => void;
  readonly onArchive: () => void;
  readonly onStar: () => void;
  readonly onNote: (body: string) => void;
}) {
  const t = useT();

  const [note, setNote] = useState("");
  const passed = detail?.messages.find((message) => message.kind === "PASS");
  const dossier = detail?.dossier ?? null;
  const summary = onePageSummary(item, dossier);
  const questions = openQuestions(dossier);
  return (
    <div className="gq2-dos">
      <div className="flex flex-wrap items-center gap-2.5">
        <QualifiesTag item={item} />
        <span className="cq-caption gq-t3">
          {t(
            `Submitted ${submittedWords(item.submittedAt)}. Frozen at submission.`,
          )}
        </span>
      </div>

      {canDecide ? null : (
        <div className="gq-banner">
          <Lock {...icon} />
          <span>
            {t("You're a")} <b>{t("Member")}</b>
            {t(
              ": you can read applications, add notes and download packs. Admins reply and pass.",
            )}
          </span>
        </div>
      )}

      {passed === undefined ? null : (
        <div className="gq-banner">
          <Send {...icon} />
          <span>
            {t("Passed with a reason. They got: “")}
            {passed.body}&rdquo;
          </span>
        </div>
      )}

      <section className="gq2-sec">
        <h3 className="gq2-h3">{t("One-page summary")}</h3>
        <div>
          {summary.map((row) => (
            <div key={row.label} className="gq2-fact">
              <span>{t(row.label)}</span>
              <span>
                {row.value === null ? (
                  <span className="gq2-unk">{t("Not covered")}</span>
                ) : (
                  t(row.value)
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      {(dossier?.contradictions ?? []).map((line) => (
        <div key={line} className="gq2-disagree" role="note">
          <span className="gq2-warn-ic">
            <CircleAlert {...icon} />
          </span>
          <span>
            <b>{t("Answers disagree.")}</b> {t(line)}{" "}
            {t("Both are kept until you ask.")}
          </span>
        </div>
      ))}

      {questions.length === 0 ? null : (
        <section className="gq2-sec">
          <h3 className="gq2-h3">{t("Open questions")}</h3>
          <p className="cq-body-sm text-(--cq-text-primary)">
            {questions.map((question) => t(question)).join(" ")}
          </p>
        </section>
      )}

      <div className="gq2-acts3">
        <Button variant="primary" disabled={!canDecide} onClick={onBook}>
          {t("Book a call")}
        </Button>
        <Button disabled={!canDecide} onClick={onAsk}>
          {t("Ask for more")}
        </Button>
        <Button disabled={!canDecide || passed !== undefined} onClick={onPass}>
          {t("Pass with a reason")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="quiet" size="compact" onClick={onPack}>
          <Download {...icon} />
          {t("Download pack")}
        </Button>
        <Button
          variant="quiet"
          size="compact"
          disabled={!canDecide}
          onClick={onReply}
        >
          <MessageSquare {...icon} />
          {t("Reply")}
        </Button>
        <span className="flex-1" />
        <Button
          variant="quiet"
          size="compact"
          aria-pressed={item.starred}
          onClick={onStar}
        >
          <Star {...icon} fill={item.starred ? "currentColor" : "none"} />
          {item.starred ? t("Starred") : t("Star")}
        </Button>
        {solo ? null : (
          <Button
            variant="quiet"
            size="compact"
            disabled={!canDecide}
            onClick={onAssign}
          >
            <UserPlus {...icon} />
            {t("Assign")}
          </Button>
        )}
        <Button variant="quiet" size="compact" onClick={onLabel}>
          <Tag {...icon} />
          {t("Label")}
        </Button>
        <Button variant="quiet" size="compact" onClick={onArchive}>
          <Archive {...icon} />
          {t("Archive")}
        </Button>
      </div>

      {detail === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton width="40%" height={20} />
          <Skeleton width="100%" height={120} />
        </div>
      ) : (
        <div className="gq2-more">
          {dossier === null ? (
            <>
              <section className="gq2-sec">
                <h3 className="gq2-h3">{t("Your gate's rules")}</h3>
                <div>
                  {detail.rules.length === 0 ? (
                    <p className="cq-body-sm gq-t2">
                      {t("No published rules yet, so nothing was checked.")}
                    </p>
                  ) : (
                    detail.rules.map((rule) => (
                      <div
                        key={rule.label}
                        className="gq-check"
                        style={{ fontSize: 14 }}
                      >
                        <FitGlyph
                          kind={
                            rule.standing === "MEETS"
                              ? "fit"
                              : rule.standing === "DOES_NOT_MEET"
                                ? "no"
                                : "unk"
                          }
                        />
                        <span>{t(rule.label)}</span>
                        <span className="gq-status">
                          {rule.standing === "MEETS"
                            ? t("Meets")
                            : rule.standing === "DOES_NOT_MEET"
                              ? t("Doesn't meet")
                              : t("Needs clarification")}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
              <section className="gq2-sec">
                <h3 className="gq2-h3">{t("Their answers")}</h3>
                <div>
                  {detail.answers.map((answer) => (
                    <div key={answer.label} className="gq2-fact">
                      <span>{t(answer.label)}</span>
                      <span>{t(answer.value)}</span>
                    </div>
                  ))}
                </div>
                <p className="cq-caption gq-t3">
                  {t("Their own claims, not verified.")}
                </p>
              </section>
              <section className="gq2-sec">
                <h3 className="gq2-h3">{t("Their note")}</h3>
                <p className="cq-body-sm" style={{ maxWidth: "62ch" }}>
                  {detail.note === null ? (
                    <span className="gq-t2">{t("No note.")}</span>
                  ) : (
                    t(`“${detail.note}”`)
                  )}
                </p>
              </section>
            </>
          ) : (
            <SubmittedBrief
              dossier={dossier}
              synthesis={detail.synthesis ?? null}
            />
          )}
          <GateqUnicornAssessment value={detail.unicornPotential} />
          {detail.transcript != null || dossier !== null ? (
            <SubmittedTranscript
              turns={detail.transcript}
              recordedTurnCount={dossier?.transcript.turnCount}
            />
          ) : null}

          <section className="gq2-sec" data-gateq-shared>
            <h3 className="gq2-h3">{t("What they shared")}</h3>
            {detail.shared.length === 0 ? (
              <p className="cq-body-sm gq-t2">
                {t("No documents were attached to this submission.")}
              </p>
            ) : (
              <ul className="gq-hair">
                {detail.shared.map((document) => (
                  <li
                    key={document.documentId}
                    className="flex min-h-13 items-center gap-3"
                  >
                    <FileText {...icon} size={18} />
                    <span className="flex-1">
                      <b className="block font-medium">{t(document.title)}</b>
                      <span className="cq-caption gq-t2">
                        {t(
                          "In the download pack when the founder allows downloads",
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="gq2-sec">
            <div className="gq-sect-h">
              <h3 className="gq2-h3">{t("Team notes")}</h3>
              <span className="cq-caption gq-t3">
                {t(`Only ${fund} sees these`)}
              </span>
            </div>
            {detail.notes.map((entry) => (
              <div key={entry.id} className="gq-note">
                <span className="gq-ini">{entry.author.initials}</span>
                <span>
                  <b className="font-medium">{entry.author.name}</b>{" "}
                  <span className="cq-caption gq-t3">
                    {t(receivedWords(entry.createdAt))}
                  </span>
                  <br />
                  {entry.body}
                </span>
              </div>
            ))}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (note.trim() === "") return;
                onNote(note.trim());
                setNote("");
              }}
            >
              <input
                className="gq-input"
                placeholder={t("Add a note for your team")}
                aria-label={t("Add a note for your team")}
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button type="submit" aria-label={t("Add note")}>
                <Send {...icon} />
              </Button>
            </form>
          </section>

          <section className="gq2-sec">
            <h3 className="gq2-h3">{t("What's happened")}</h3>
            <ul className="gq-tl">
              {detail.activity.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <span className="gq-t3">{t(receivedWords(entry.at))}</span>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function Sheets({
  sheet,
  onClose,
  items,
  details,
  inbox,
  fund,
  demo,
  founderOf,
  onPassed,
  onReplied,
  onAssigned,
  onLabelled,
  onPreparePasses,
}: {
  readonly sheet: Sheet | null;
  readonly onClose: () => void;
  readonly items: readonly GateqInboxItemDto[];
  readonly details: Readonly<Record<string, GateqInboxDetailDto>>;
  readonly inbox: GateqInboxDto;
  readonly fund: string;
  readonly demo: boolean;
  readonly founderOf: (id: string) => string | null;
  readonly onPassed: (
    ids: readonly string[],
    reason: GateqPassReason,
    messages: Readonly<Record<string, string>>,
  ) => void;
  readonly onReplied: (id: string, message: string, draft: ReplyDraft) => void;
  readonly onAssigned: (ids: readonly string[], userId: string | null) => void;
  readonly onLabelled: (ids: readonly string[], label: string) => void;
  readonly onPreparePasses: (ids: readonly string[]) => void;
}) {
  const t = useT();

  const nameOf = (id: string) =>
    items.find((item) => item.applicationId === id)?.companyName ??
    "this company";
  const title =
    sheet === null
      ? ""
      : sheet.kind === "pass"
        ? sheet.ids.length === 1
          ? `Prepare a pass: ${nameOf(sheet.ids[0] ?? "")}`
          : `Prepare ${sheet.ids.length} passes`
        : sheet.kind === "reply"
          ? sheet.draft === "CALL"
            ? `Book a call with ${nameOf(sheet.id)}`
            : sheet.draft === "ASK"
              ? `Ask ${nameOf(sheet.id)} for more`
              : `Reply to ${nameOf(sheet.id)}`
          : sheet.kind === "pack"
            ? "Download pack"
            : sheet.kind === "assign"
              ? "Assign"
              : sheet.kind === "label"
                ? "Label"
                : sheet.kind === "triage"
                  ? "Q's triage"
                  : sheet.kind === "compare"
                    ? "Compare submitted applications"
                    : "Keyboard shortcuts";
  return (
    <SheetRoot
      open={sheet !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      {sheet === null ? null : (
        <SheetContent
          title={t(title)}
          side={sheet.kind === "compare" ? "full" : "side"}
          className="cq-charcoal"
        >
          {sheet.kind === "compare" ? (
            <ApplicationComparison
              key={JSON.stringify([
                inbox.gateway.id,
                inbox.viewer.userId,
                sheet.ids,
                items.map((item) => item.applicationId),
              ])}
              gatewayId={inbox.gateway.id}
              ids={sheet.ids}
              allowedIds={items.map((item) => item.applicationId)}
              demoDetails={demo ? details : undefined}
            />
          ) : sheet.kind === "pass" ? (
            <PassSheet
              ids={sheet.ids}
              items={items}
              details={details}
              fund={fund}
              onSend={onPassed}
              onCancel={onClose}
            />
          ) : sheet.kind === "reply" ? (
            <ReplySheet
              initial={
                sheet.draft === "CALL"
                  ? draftCall({ founderName: founderOf(sheet.id), fund })
                  : sheet.draft === "ASK"
                    ? draftAsk({
                        founderName: founderOf(sheet.id),
                        fund,
                        questions: openQuestions(details[sheet.id]?.dossier),
                      })
                    : draftReply({ founderName: founderOf(sheet.id), fund })
              }
              note={
                sheet.draft === "CALL"
                  ? "Drafted by Q. Nothing is sent until you approve this exact message."
                  : sheet.draft === "ASK"
                    ? "Q drafted the questions from what they sent. Nothing is sent until you approve this exact message."
                    : "Sent only when you press Send, exactly as shown."
              }
              sendLabel={
                sheet.draft === "CALL"
                  ? "Approve and send"
                  : sheet.draft === "ASK"
                    ? "Approve and send"
                    : "Send"
              }
              onSend={(message) =>
                onReplied(sheet.id, message, sheet.draft ?? "REPLY")
              }
              onCancel={onClose}
            />
          ) : sheet.kind === "pack" ? (
            <PackSheet
              name={nameOf(sheet.id)}
              detail={details[sheet.id] ?? null}
              href={`/gateq/pack/${inbox.gateway.id}/${sheet.id}`}
              demo={demo}
              onDone={onClose}
            />
          ) : sheet.kind === "assign" ? (
            <ul className="gq-hair">
              {inbox.members.map((member) => (
                <li key={member.userId}>
                  <button
                    type="button"
                    className="flex min-h-13 w-full items-center gap-3 text-start"
                    onClick={() => onAssigned(sheet.ids, member.userId)}
                  >
                    <span className="gq-ini">{member.initials}</span>
                    <span className="flex-1">{member.name}</span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="flex min-h-13 w-full items-center gap-3 text-start gq-t2"
                  onClick={() => onAssigned(sheet.ids, null)}
                >
                  {t("Nobody")}
                </button>
              </li>
            </ul>
          ) : sheet.kind === "label" ? (
            <LabelSheet
              labels={inbox.labels}
              onLabel={(label) => onLabelled(sheet.ids, label)}
            />
          ) : sheet.kind === "triage" ? (
            <TriageSheet
              items={items}
              canDecide={inbox.viewer.canDecide}
              onPreparePasses={onPreparePasses}
            />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {[
                ["j / k", "Next / previous"],
                ["o or Enter", "Open"],
                ["u", "Back to the list"],
                ["x", "Select"],
                ["s", "Star"],
                ["e", "Archive"],
                ["#", "Pass (with a reason)"],
                ["r", "Reply"],
                ["d", "Download pack"],
                ["/", "Search"],
              ].map(([keys, what]) => (
                <div key={keys} className="contents">
                  <dt className="gq-kbd justify-self-start">{keys}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          )}
        </SheetContent>
      )}
    </SheetRoot>
  );
}

function PassSheet({
  ids,
  items,
  details,
  fund,
  onSend,
  onCancel,
}: {
  readonly ids: readonly string[];
  readonly items: readonly GateqInboxItemDto[];
  readonly details: Readonly<Record<string, GateqInboxDetailDto>>;
  readonly fund: string;
  readonly onSend: (
    ids: readonly string[],
    reason: GateqPassReason,
    messages: Readonly<Record<string, string>>,
  ) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();

  const first = items.find((item) => item.applicationId === ids[0]);
  const suggested: GateqPassReason =
    first?.fit === "NOT_A_FIT" ? "OTHER" : "TIMING";
  const [reason, setReason] = useState<GateqPassReason | null>(
    ids.length === 1 ? suggested : null,
  );
  const draftFor = useCallback(
    (id: string, why: GateqPassReason) =>
      draftPass({
        founderName:
          details[id]?.dossier?.contact?.name ??
          details[id]?.contact.name ??
          null,
        companyName:
          items.find((item) => item.applicationId === id)?.companyName ??
          "your company",
        fund,
        reason: why,
      }),
    [details, fund, items],
  );
  const [messages, setMessages] = useState<Record<string, string>>(() =>
    Object.fromEntries(ids.map((id) => [id, draftFor(id, suggested)])),
  );
  const reasonId = useId();
  return (
    <div className="flex flex-col gap-3.5">
      <p className="gq-label" id={reasonId}>
        {t("Main reason")}
      </p>
      <div className="gq-opts" role="radiogroup" aria-labelledby={reasonId}>
        {PASS_REASONS.map(([code, label]) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={reason === code}
            className="gq-opt"
            onClick={() => {
              setReason(code);
              setMessages(
                Object.fromEntries(ids.map((id) => [id, draftFor(id, code)])),
              );
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {ids.map((id) => (
        <div key={id} className="gq-field">
          <label className="gq-label" htmlFor={`pm-${id}`}>
            {ids.length === 1
              ? t("Message to the founder")
              : t(
                  `To ${items.find((item) => item.applicationId === id)?.companyName ?? "the founder"}`,
                )}{" "}
            <span className="gq-prefill">
              <QNavIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
              {t("Drafted by Q")}
            </span>
          </label>
          <textarea
            id={`pm-${id}`}
            className="gq-input"
            rows={ids.length === 1 ? 5 : 3}
            maxLength={2000}
            value={messages[id] ?? ""}
            onChange={(event) =>
              setMessages((all) => ({ ...all, [id]: event.target.value }))
            }
          />
        </div>
      ))}
      <p className="cq-caption gq-t3">
        {t(
          "Drafted by Q. Nothing is sent until you approve this exact message. Founders always get a reason.",
        )}
      </p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={
            reason === null ||
            ids.some((id) => (messages[id] ?? "").trim() === "")
          }
          onClick={() => {
            if (reason !== null) onSend(ids, reason, messages);
          }}
        >
          {ids.length === 1
            ? t("Approve and send pass")
            : t(`Approve and send ${ids.length} passes`)}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
    </div>
  );
}

function TriageSheet({
  items,
  canDecide,
  onPreparePasses,
}: {
  readonly items: readonly GateqInboxItemDto[];
  readonly canDecide: boolean;
  readonly onPreparePasses: (ids: readonly string[]) => void;
}) {
  const t = useT();

  const open = items.filter((item) => item.folder === "INBOX");
  const outside = open.filter((item) => item.fit === "NOT_A_FIT");
  return (
    <div className="flex flex-col gap-3.5">
      <p className="cq-body-sm gq-t2">
        {t(
          "From your gate's rules and your reply promise. Proposals only: nothing is sent or changed until you say so.",
        )}
      </p>
      <ul className="gq-hair">
        {open.map((item) => {
          const view = qView(item);
          return (
            <li key={item.applicationId} className="flex flex-col gap-0.5 py-3">
              <b className="font-medium">{item.companyName}</b>
              <span className="cq-body-sm">
                {item.rules.total === 0
                  ? t("Look at it yourself")
                  : item.fit === "NOT_A_FIT"
                    ? t("Prepare a pass")
                    : item.fit === "PARTIAL" || item.rules.unknown > 0
                      ? t("Ask for more")
                      : t("Look at first")}
                <span className="gq-t2"> · {t(view.why)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {canDecide && outside.length > 0 ? (
        <Button
          variant="primary"
          onClick={() =>
            onPreparePasses(outside.map((item) => item.applicationId))
          }
        >
          {t(`Prepare ${outside.length} pass`)}
          {outside.length === 1 ? "" : "es"} {t("to review")}
        </Button>
      ) : null}
    </div>
  );
}

function ReplySheet({
  initial,
  note,
  sendLabel,
  onSend,
  onCancel,
}: {
  readonly initial: string;
  readonly note: string;
  readonly sendLabel: string;
  readonly onSend: (message: string) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();

  const [message, setMessage] = useState(initial);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="gq-field">
        <label className="gq-label" htmlFor="gq-reply">
          {t("Message to the founder")}{" "}
          <span className="gq-prefill">
            <QNavIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
            {t("Drafted by Q")}
          </span>
        </label>
        <textarea
          id="gq-reply"
          className="gq-input"
          rows={6}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      <p className="cq-caption gq-t3">{t(note)}</p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={message.trim() === ""}
          onClick={() => onSend(message.trim())}
        >
          {t(sendLabel)}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
    </div>
  );
}

function PackSheet({
  name,
  detail,
  href,
  demo,
  onDone,
}: {
  readonly name: string;
  readonly detail: GateqInboxDetailDto | null;
  readonly href: string;
  readonly demo: boolean;
  readonly onDone: () => void;
}) {
  const t = useT();

  const rows: readonly (readonly [string, string, boolean])[] = [
    ["One-page summary", "Company, round, your rules and how they stood", true],
    ...(detail?.shared ?? []).map(
      (document) =>
        [
          document.title,
          "Included if the founder allows downloads; otherwise noted in the summary",
          true,
        ] as const,
    ),
    ["Application data for your CRM", "JSON", true],
  ];
  return (
    <div className="flex flex-col gap-3.5">
      <p className="cq-body-sm gq-t2">
        {t(
          `One zip with everything ${name} shared with you, with your name on the summary. Your team notes are never in it.`,
        )}
      </p>
      <ul className="gq-hair">
        {rows.map(([title, meta]) => (
          <li key={title} className="gq-pick">
            <input type="checkbox" checked readOnly aria-label={t(title)} />
            <span>
              <b className="block font-medium">{t(title)}</b>
              <span className="cq-caption gq-t2">{t(meta)}</span>
            </span>
          </li>
        ))}
      </ul>
      <a
        className={buttonClassName("primary")}
        href={demo ? undefined : href}
        download
        onClick={() => window.setTimeout(onDone, 300)}
      >
        <Download {...icon} />
        {t("Download zip")}
      </a>
    </div>
  );
}

function LabelSheet({
  labels,
  onLabel,
}: {
  readonly labels: readonly string[];
  readonly onLabel: (label: string) => void;
}) {
  const t = useT();

  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {labels.length === 0 ? null : (
        <div className="gq-opts">
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className="gq-opt"
              onClick={() => onLabel(label)}
            >
              <Tag {...icon} />
              {t(label)}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() !== "") onLabel(text.trim().slice(0, 40));
        }}
      >
        <input
          className="gq-input"
          aria-label={t("New label")}
          placeholder={t("New label, like IC next week")}
          value={text}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit">{t("Add")}</Button>
      </form>
    </div>
  );
}

export function CopyLink({
  text,
  onCopied,
  primary = false,
  label = "Copy gate link",
}: {
  readonly text: string;
  readonly onCopied?: () => void;
  readonly primary?: boolean;
  readonly label?: string;
}) {
  const t = useT();

  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      size={primary ? "regular" : "compact"}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            onCopied?.();
            window.setTimeout(() => setCopied(false), 2000);
          },
          () => undefined,
        );
      }}
    >
      <LinkIcon {...icon} />
      {copied ? t("Copied") : t(label)}
    </Button>
  );
}

function Toast({ message }: { readonly message: string | null }) {
  const t = useT();

  return (
    <div
      role="status"
      aria-live="polite"
      data-q-notice={message === null ? undefined : "TOAST"}
      className="pointer-events-none fixed bottom-[calc(var(--cq-bottom-nav-height)+16px)] left-1/2 z-(--cq-z-toast) -translate-x-1/2 lg:bottom-6"
    >
      {message === null ? null : (
        <span className="gq-card block px-4 py-2.5 text-sm shadow-(--cq-shadow-overlay)">
          {t(message)}
        </span>
      )}
    </div>
  );
}
