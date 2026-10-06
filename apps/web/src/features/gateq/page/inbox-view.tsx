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
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  Clock,
  Download,
  FileText,
  Filter,
  ICON_SIZE,
  ICON_STROKE,
  Inbox,
  Link as LinkIcon,
  Lock,
  MessageSquare,
  MoreHorizontal,
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

import { QNavIcon } from "@/components/app-shell/q-nav-icon";

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
  chipsFor,
  draftPass,
  draftReply,
  FIT_GLYPH,
  FIT_WORDS,
  matchesSearch,
  PASS_REASONS,
  qView,
  receivedWords,
  replyWords,
  rulesWords,
  shortcutFor,
} from "./inbox-model";

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
  readonly sheet?: "pass" | "pack" | null;
  readonly phoneDetail?: boolean;
  readonly selected?: string;
};

export type InboxViewProps = {
  readonly inbox: GateqInboxDto | null;
  readonly state: "full" | "loading" | "empty" | "error";
  readonly initialDetail: GateqInboxDetailDto | null;
  readonly gateLink: string;
  readonly fund: string;
  /** Where a view chip goes; the view's name is appended. */
  readonly viewBase?: string;
  readonly demo?: InboxDemo;
};

type Sheet =
  | { readonly kind: "pass"; readonly ids: readonly string[] }
  | { readonly kind: "reply"; readonly id: string }
  | { readonly kind: "pack"; readonly id: string }
  | { readonly kind: "assign"; readonly ids: readonly string[] }
  | { readonly kind: "label"; readonly ids: readonly string[] }
  | { readonly kind: "keys" }
  | { readonly kind: "triage" };

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
  gateLink,
  fund,
  viewBase = "/gateq?tab=inbox&view=",
  demo,
}: InboxViewProps) {
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
      inbox?.items[0]?.applicationId ??
      null,
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
    return null;
  });
  const [search, setSearch] = useState("");
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
  const visible = useMemo(
    () => items.filter((item) => matchesSearch(item, search)),
    [items, search],
  );
  const current =
    visible.find((item) => item.applicationId === selected) ??
    visible[0] ??
    null;
  const detail =
    current === null ? null : (details[current.applicationId] ?? null);

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

  const chips = (
    <div className="gq-chips" role="navigation" aria-label="Views">
      {chipsFor(solo).map(([view, label]) => {
        const count = inbox?.counts[view] ?? 0;
        return (
          <Link
            key={view}
            href={viewHref(view)}
            className="gq-chip"
            aria-current={inbox?.view === view ? "page" : undefined}
          >
            {label}
            {count > 0 && view !== "PASSED" && view !== "ARCHIVED" ? (
              <span className="gq-count">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );

  if (state === "loading") {
    return (
      <>
        {chips}
        <div className="gq-ibx" aria-busy="true">
          <div className="gq-list">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="flex gap-2.5 border-b border-(--cq-border-subtle) px-3 py-3.5"
              >
                <Skeleton width="24px" height={24} radius={6} />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton width="50%" height={15} />
                  <Skeleton width="80%" height={12} />
                  <Skeleton width="60%" height={18} radius={9} />
                </div>
              </div>
            ))}
          </div>
          <div className="gq-detail">
            <div className="gq-dt">
              <Skeleton width="60%" height={28} />
              <Skeleton width="100%" height={40} radius={10} />
              <Skeleton width="100%" height={200} radius={14} />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (state === "error") {
    return (
      <>
        {chips}
        <ErrorBlock
          what="Your GateQ inbox"
          retryHref={viewHref(inbox?.view ?? "INBOX")}
        />
      </>
    );
  }

  if (state === "empty" || inbox === null || items.length === 0) {
    return (
      <>
        {chips}
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
                ? "No applications yet"
                : "Nothing here"
            }
            body={
              inbox?.view === "INBOX" || inbox === null
                ? "Share your gate and founders can check their fit with you in two minutes. Only companies that meet your rules can send."
                : "Nothing in this view right now."
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
              Preview the form
            </Link>
          </StateBlock>
          <div className="gq-card flex flex-col gap-2 p-4">
            <p className="cq-label gq-t2">Your gate link</p>
            <p
              className="cq-body break-all"
              style={{
                fontFamily: "var(--cq-font-mono, monospace)",
                fontSize: 14,
              }}
            >
              {gateLink.replace(/^https?:\/\//, "")}
            </p>
            <p className="cq-caption gq-t3">
              Also as a QR code and a snippet for your website.
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
        aria-label={`${checked.size} selected`}
      >
        <b className="px-2 font-medium">{checked.size} selected</b>
        <button
          type="button"
          onClick={() => setSheet({ kind: "label", ids: [...checked] })}
        >
          <Tag {...icon} />
          Label
        </button>
        {solo || !canDecide ? null : (
          <button
            type="button"
            onClick={() => setSheet({ kind: "assign", ids: [...checked] })}
          >
            <UserPlus {...icon} />
            Assign
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
          Download packs
        </button>
        <button type="button" onClick={() => archive([...checked])}>
          <Archive {...icon} />
          Archive
        </button>
        {canDecide ? (
          <button
            type="button"
            onClick={() => setSheet({ kind: "pass", ids: [...checked] })}
          >
            Pass…
          </button>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Clear selection"
          onClick={() => setChecked(new Set())}
        >
          <X {...icon} />
        </button>
      </div>
    );

  const allChecked =
    visible.length > 0 &&
    visible.every((item) => checked.has(item.applicationId));

  const list = (
    <div
      className="gq-list"
      ref={listRef}
      role="listbox"
      aria-label="Applications"
      aria-multiselectable="true"
    >
      <div className="gq-listhead">
        <button
          type="button"
          className="grid size-11 place-items-center rounded-lg text-(--cq-text-tertiary) lg:size-9"
          role="checkbox"
          aria-checked={allChecked}
          aria-label="Select all"
          onClick={() =>
            setChecked(
              allChecked
                ? new Set()
                : new Set(visible.map((item) => item.applicationId)),
            )
          }
        >
          {allChecked ? (
            <SquareCheck {...icon} size={18} />
          ) : (
            <Square {...icon} size={18} />
          )}
        </button>
        {searching ? (
          <label className="gq-search flex-1">
            <span className="sr-only">Search applications</span>
            <Search {...icon} />
            <input
              ref={searchRef}
              className="gq-input"
              style={{ minHeight: 36 }}
              value={search}
              placeholder="Search"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                  setSearching(false);
                }
              }}
            />
          </label>
        ) : (
          <>
            <Button
              variant="quiet"
              size="compact"
              onClick={() => setSearching(true)}
            >
              <Filter {...icon} />
              Filter
            </Button>
            <Button
              variant="quiet"
              size="compact"
              className="gq-hide-s"
              aria-label="Sorted by reply-by date"
            >
              Reply-by date
              <ChevronDown {...icon} />
            </Button>
          </>
        )}
        <span className="flex-1" />
        <Button
          variant="quiet"
          size="compact"
          title="Q proposes what to look at first, what to ask for and which to prepare a pass for. You approve."
          onClick={() => setSheet({ kind: "triage" })}
        >
          <QNavIcon size={16} strokeWidth={ICON_STROKE} aria-hidden />
          Triage
        </Button>
      </div>
      {visible.map((item) => (
        <Row
          key={item.applicationId}
          item={item}
          selected={item.applicationId === current?.applicationId}
          checked={checked.has(item.applicationId)}
          onOpen={() => open(item.applicationId)}
          onCheck={() =>
            setChecked((all) => {
              const next = new Set(all);
              if (next.has(item.applicationId)) next.delete(item.applicationId);
              else next.add(item.applicationId);
              return next;
            })
          }
          onStar={() => star([item.applicationId], !item.starred)}
        />
      ))}
      <p className="cq-caption gq-t3 px-3 py-3.5">
        {inbox.counts.NOT_A_FIT > 0
          ? `${inbox.counts.NOT_A_FIT} application${inbox.counts.NOT_A_FIT === 1 ? "" : "s"} outside your rules ${inbox.counts.NOT_A_FIT === 1 ? "is" : "are"} under Not a fit. `
          : ""}
        Q never passes on your behalf.
      </p>
    </div>
  );

  const detailPane =
    current === null ? null : (
      <Detail
        item={current}
        detail={detail}
        canDecide={canDecide}
        solo={solo}
        fund={fund}
        onReply={() => setSheet({ kind: "reply", id: current.applicationId })}
        onPass={() => setSheet({ kind: "pass", ids: [current.applicationId] })}
        onAssign={() =>
          setSheet({ kind: "assign", ids: [current.applicationId] })
        }
        onPack={() => setSheet({ kind: "pack", id: current.applicationId })}
        onLabel={() =>
          setSheet({ kind: "label", ids: [current.applicationId] })
        }
        onArchive={() => archive([current.applicationId])}
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
      {chips}
      {bulk}
      <div className="gq-ibx">
        {list}
        <div className="gq-detail" aria-live="polite">
          {detailPane}
        </div>
      </div>
      <p className="cq-caption gq-t3">
        {shortcutsOn ? (
          <>
            Keys: <span className="gq-kbd">j</span>{" "}
            <span className="gq-kbd">k</span> move,{" "}
            <span className="gq-kbd">x</span> select,{" "}
            <span className="gq-kbd">s</span> star,{" "}
            <span className="gq-kbd">e</span> archive,{" "}
            <span className="gq-kbd">#</span> pass,{" "}
            <span className="gq-kbd">/</span> search.{" "}
          </>
        ) : (
          "Keyboard shortcuts are off. "
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
          Turn {shortcutsOn ? "off" : "on"}
        </button>
      </p>

      {phoneOpen && !desktop && current !== null ? (
        <div
          className="gq-phonedetail"
          role="dialog"
          aria-modal="true"
          aria-label={current.companyName}
        >
          <header className="gq-mhead">
            <button
              type="button"
              className="grid size-11 place-items-center"
              aria-label="Back to inbox"
              onClick={() => setPhoneOpen(false)}
            >
              <ChevronLeft
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
            </button>
            <span className="gq-title">{current.companyName}</span>
            <button
              type="button"
              className="grid size-11 place-items-center"
              aria-label={current.starred ? "Unstar" : "Star"}
              aria-pressed={current.starred}
              onClick={() => star([current.applicationId], !current.starred)}
            >
              <Star
                {...icon}
                size={18}
                fill={current.starred ? "currentColor" : "none"}
                className={current.starred ? "text-(--cq-warning)" : undefined}
              />
            </button>
            <button
              type="button"
              className="grid size-11 place-items-center"
              aria-label="Archive"
              onClick={() => archive([current.applicationId])}
            >
              <Archive {...icon} size={18} />
            </button>
            <button
              type="button"
              className="grid size-11 place-items-center"
              aria-label="Download pack"
              onClick={() =>
                setSheet({ kind: "pack", id: current.applicationId })
              }
            >
              <MoreHorizontal {...icon} size={18} />
            </button>
          </header>
          {detailPane}
          <div className="gq-pbar">
            <Button
              disabled={!canDecide}
              onClick={() =>
                setSheet({ kind: "pass", ids: [current.applicationId] })
              }
            >
              Pass
            </Button>
            <Button
              onClick={() =>
                setSheet({ kind: "pack", id: current.applicationId })
              }
            >
              Pack
            </Button>
            <Button
              variant="primary"
              disabled={!canDecide}
              onClick={() =>
                setSheet({ kind: "reply", id: current.applicationId })
              }
            >
              Reply
            </Button>
          </div>
        </div>
      ) : null}

      <Sheets
        sheet={sheet}
        onClose={() => setSheet(null)}
        items={items}
        details={details}
        inbox={inbox}
        fund={fund}
        demo={demo !== undefined}
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
              ? "Sent. Moved to Passed."
              : `${ids.length} passes sent.`,
          );
        }}
        onReplied={(id, message) => {
          setSheet(null);
          run(
            () =>
              replyAction(gatewayId, id, {
                message,
                clientRequestId: key("reply"),
              }),
            "Reply sent.",
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

function Row({
  item,
  selected,
  checked,
  onOpen,
  onCheck,
  onStar,
}: {
  readonly item: GateqInboxItemDto;
  readonly selected: boolean;
  readonly checked: boolean;
  readonly onOpen: () => void;
  readonly onCheck: () => void;
  readonly onStar: () => void;
}) {
  const reply = replyWords(item);
  return (
    <div
      data-id={item.applicationId}
      className={`gq-row${item.unread ? " gq-unread" : ""}`}
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
      <button
        type="button"
        className="gq-ck"
        role="checkbox"
        aria-checked={checked}
        aria-label={`Select ${item.companyName}`}
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
      <button
        type="button"
        className="gq-st"
        aria-pressed={item.starred}
        aria-label={`${item.starred ? "Unstar" : "Star"} ${item.companyName}`}
        onClick={(event) => {
          event.stopPropagation();
          onStar();
        }}
      >
        <Star {...icon} fill={item.starred ? "currentColor" : "none"} />
      </button>
      <div className="gq-main">
        <span className="gq-nm">
          {item.companyName}
          {item.unread ? <span className="sr-only"> (unread)</span> : null}
        </span>
        {item.oneLiner === null ? null : (
          <span className="gq-ln">{item.oneLiner}</span>
        )}
        <span className="gq-tags">
          <span className="gq-mini">
            <FitGlyph kind={FIT_GLYPH[item.fit]} size={12} />
            {FIT_WORDS[item.fit]}
          </span>
          <span className="gq-mini">{rulesWords(item.rules)}</span>
          {item.labels.map((label) => (
            <span key={label} className="gq-lbl">
              {label}
            </span>
          ))}
        </span>
      </div>
      <div className="gq-right">
        <span className="cq-caption gq-t3">
          {receivedWords(item.submittedAt)}
        </span>
        {item.assignee === null ? null : (
          <span className="gq-ini" title={`Assigned to ${item.assignee.name}`}>
            {item.assignee.initials}
          </span>
        )}
        {reply === null ? null : (
          <span className={`gq-sla${reply.warn ? " gq-warn" : ""}`}>
            {reply.warn ? <Clock {...icon} size={13} /> : null}
            {reply.text}
          </span>
        )}
      </div>
    </div>
  );
}

function Detail({
  item,
  detail,
  canDecide,
  solo,
  fund,
  onReply,
  onPass,
  onAssign,
  onPack,
  onLabel,
  onArchive,
  onNote,
}: {
  readonly item: GateqInboxItemDto;
  readonly detail: GateqInboxDetailDto | null;
  readonly canDecide: boolean;
  readonly solo: boolean;
  readonly fund: string;
  readonly onReply: () => void;
  readonly onPass: () => void;
  readonly onAssign: () => void;
  readonly onPack: () => void;
  readonly onLabel: () => void;
  readonly onArchive: () => void;
  readonly onNote: (body: string) => void;
}) {
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const view = qView(item);
  const passed = detail?.messages.find((message) => message.kind === "PASS");
  return (
    <div className="gq-dt">
      <div className="flex items-start gap-3.5">
        <span
          className="gq-logo"
          style={{ width: 56, height: 56, fontSize: 22 }}
        >
          {item.companyName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="cq-title-lg">{item.companyName}</h2>
          {item.oneLiner === null ? null : (
            <p className="cq-body">{item.oneLiner}</p>
          )}
          <p className="cq-caption gq-t2">
            {[item.stage, item.sector, item.country]
              .filter((part) => part !== null)
              .join(" · ")}
            {item.raise === null
              ? ""
              : ` · Raising ${item.raise.currency === "USD" ? "$" : `${item.raise.currency} `}${Number(item.raise.amount).toLocaleString("en-US")}`}
            {` · Applied ${receivedWords(item.submittedAt)}`}
          </p>
        </div>
      </div>

      <div className="gq-acts">
        <Button
          variant="primary"
          size="compact"
          disabled={!canDecide}
          onClick={onReply}
        >
          <MessageSquare {...icon} />
          Reply
        </Button>
        {detail?.contact.email ? (
          <a
            className={buttonClassName("secondary", "compact")}
            href={`mailto:${detail.contact.email}?subject=${encodeURIComponent(`${fund} and ${item.companyName}: a call`)}`}
            aria-disabled={!canDecide}
          >
            Book a call
          </a>
        ) : null}
        <Button
          size="compact"
          disabled={!canDecide || passed !== undefined}
          onClick={onPass}
        >
          Pass
        </Button>
        <span className="flex-1" />
        {solo ? null : (
          <Button
            variant="quiet"
            size="compact"
            disabled={!canDecide}
            onClick={onAssign}
          >
            <UserPlus {...icon} />
            Assign
          </Button>
        )}
        <Button variant="quiet" size="compact" onClick={onPack}>
          <Download {...icon} />
          Download pack
        </Button>
        <span className="relative">
          <Button
            variant="quiet"
            size="compact"
            aria-label="More: label, archive"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            <MoreHorizontal {...icon} />
          </Button>
          {more ? (
            <span
              className="gq-card absolute right-0 z-10 mt-1 flex min-w-40 flex-col p-1"
              role="menu"
            >
              <Button
                variant="quiet"
                size="compact"
                role="menuitem"
                onClick={() => (setMore(false), onLabel())}
              >
                <Tag {...icon} />
                Label
              </Button>
              <Button
                variant="quiet"
                size="compact"
                role="menuitem"
                onClick={() => (setMore(false), onArchive())}
              >
                <Archive {...icon} />
                Archive
              </Button>
            </span>
          ) : null}
        </span>
      </div>

      {canDecide ? null : (
        <div className="gq-banner">
          <Lock {...icon} />
          <span>
            You&apos;re a <b>Member</b>: you can read applications, add notes
            and download packs. Admins reply and pass.
          </span>
        </div>
      )}

      {passed === undefined ? null : (
        <div className="gq-banner">
          <Send {...icon} />
          <span>
            Passed with a reason. They got: &ldquo;{passed.body}&rdquo;
          </span>
        </div>
      )}

      <div className="gq-qview">
        <span className="text-(--cq-q-light)">
          <QNavIcon size={22} strokeWidth={2} aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="gq-who">Q&apos;s view, not a verified fact</p>
          <p className="cq-body">
            <b>{view.lead}.</b> <span className="gq-t2">{view.why}</span>
          </p>
        </div>
      </div>

      {detail === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton width="40%" height={20} />
          <Skeleton width="100%" height={120} radius={12} />
        </div>
      ) : (
        <>
          <div
            className="grid gap-5"
            style={{
              gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
            }}
          >
            <section className="gq-sect">
              <h3 className="cq-title-sm">Your gate&apos;s rules</h3>
              <div>
                {detail.rules.length === 0 ? (
                  <p className="cq-body-sm gq-t2">No published rules.</p>
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
                      <span>{rule.label}</span>
                      <span className="gq-status">
                        {rule.standing === "MEETS"
                          ? "Meets"
                          : rule.standing === "DOES_NOT_MEET"
                            ? "Doesn't meet"
                            : "Not answered"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
            <section className="gq-sect">
              <h3 className="cq-title-sm">Their answers</h3>
              <ul className="flex flex-col">
                {detail.answers.map((answer) => (
                  <li
                    key={answer.label}
                    className="flex min-h-7 items-center gap-2 text-sm"
                  >
                    <span className="flex-1 gq-t2">{answer.label}</span>
                    <span>{answer.value}</span>
                  </li>
                ))}
              </ul>
              <p className="cq-caption gq-t3">
                Their own claims, not verified.
              </p>
            </section>
          </div>

          <section className="gq-sect">
            <h3 className="cq-title-sm">Their note</h3>
            <p className="cq-body" style={{ maxWidth: "62ch" }}>
              {detail.note === null ? (
                <span className="gq-t2">No note.</span>
              ) : (
                `“${detail.note}”`
              )}
            </p>
            {detail.contact.name || detail.contact.email ? (
              <p className="cq-caption gq-t2">
                {[detail.contact.name, detail.contact.email]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </p>
            ) : null}
          </section>

          <section className="gq-sect">
            <h3 className="cq-title-sm">What they shared</h3>
            {detail.shared.length === 0 ? (
              <p className="cq-body-sm gq-t2">
                Only the form. They didn&apos;t attach documents.
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
                      <b className="block font-medium">{document.title}</b>
                      <span className="cq-caption gq-t2">
                        In the download pack when the founder allows downloads
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="gq-sect">
            <div className="gq-sect-h">
              <h3 className="cq-title-sm">Team notes</h3>
              <span className="cq-caption gq-t3">Only {fund} sees these</span>
            </div>
            {detail.notes.map((entry) => (
              <div key={entry.id} className="gq-note">
                <span className="gq-ini">{entry.author.initials}</span>
                <span>
                  <b className="font-medium">{entry.author.name}</b>{" "}
                  <span className="cq-caption gq-t3">
                    {receivedWords(entry.createdAt)}
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
                placeholder="Add a note for your team"
                aria-label="Add a note for your team"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button type="submit" aria-label="Add note">
                <Send {...icon} />
              </Button>
            </form>
          </section>

          <section className="gq-sect">
            <h3 className="cq-title-sm">What&apos;s happened</h3>
            <ul className="gq-tl">
              {detail.activity.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <span className="gq-t3">{receivedWords(entry.at)}</span>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
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
  readonly onPassed: (
    ids: readonly string[],
    reason: GateqPassReason,
    messages: Readonly<Record<string, string>>,
  ) => void;
  readonly onReplied: (id: string, message: string) => void;
  readonly onAssigned: (ids: readonly string[], userId: string | null) => void;
  readonly onLabelled: (ids: readonly string[], label: string) => void;
  readonly onPreparePasses: (ids: readonly string[]) => void;
}) {
  const nameOf = (id: string) =>
    items.find((item) => item.applicationId === id)?.companyName ??
    "this company";
  const title =
    sheet === null
      ? ""
      : sheet.kind === "pass"
        ? sheet.ids.length === 1
          ? `Pass on ${nameOf(sheet.ids[0] ?? "")}`
          : `Pass on ${sheet.ids.length} applications`
        : sheet.kind === "reply"
          ? `Reply to ${nameOf(sheet.id)}`
          : sheet.kind === "pack"
            ? "Download pack"
            : sheet.kind === "assign"
              ? "Assign"
              : sheet.kind === "label"
                ? "Label"
                : sheet.kind === "triage"
                  ? "Q's triage"
                  : "Keyboard shortcuts";
  return (
    <SheetRoot
      open={sheet !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      {sheet === null ? null : (
        <SheetContent title={title} side="side">
          {sheet.kind === "pass" ? (
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
              initial={draftReply({
                founderName: details[sheet.id]?.contact.name ?? null,
                fund,
              })}
              onSend={(message) => onReplied(sheet.id, message)}
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
                    className="flex min-h-13 w-full items-center gap-3 text-left"
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
                  className="flex min-h-13 w-full items-center gap-3 text-left gq-t2"
                  onClick={() => onAssigned(sheet.ids, null)}
                >
                  Nobody
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
  const first = items.find((item) => item.applicationId === ids[0]);
  const suggested: GateqPassReason =
    first?.fit === "NOT_A_FIT" ? "OTHER" : "TIMING";
  const [reason, setReason] = useState<GateqPassReason | null>(
    ids.length === 1 ? suggested : null,
  );
  const draftFor = useCallback(
    (id: string, why: GateqPassReason) =>
      draftPass({
        founderName: details[id]?.contact.name ?? null,
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
        Main reason
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
            {label}
          </button>
        ))}
      </div>
      {ids.map((id) => (
        <div key={id} className="gq-field">
          <label className="gq-label" htmlFor={`pm-${id}`}>
            {ids.length === 1
              ? "Message to the founder"
              : `To ${items.find((item) => item.applicationId === id)?.companyName ?? "the founder"}`}{" "}
            <span className="gq-prefill">
              <QNavIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
              Drafted by Q
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
        Sent only when you press the button, exactly as shown. Founders always
        get a reason.
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
          {ids.length === 1 ? "Send and pass" : `Send ${ids.length} and pass`}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
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
  const open = items.filter((item) => item.folder === "INBOX");
  const outside = open.filter((item) => item.fit === "NOT_A_FIT");
  return (
    <div className="flex flex-col gap-3.5">
      <p className="cq-body-sm gq-t2">
        From your gate&apos;s rules and your reply promise. Proposals only:
        nothing is sent or changed until you say so.
      </p>
      <ul className="gq-hair">
        {open.map((item) => {
          const view = qView(item);
          return (
            <li key={item.applicationId} className="flex flex-col gap-0.5 py-3">
              <b className="font-medium">{item.companyName}</b>
              <span className="cq-body-sm">
                {item.fit === "NOT_A_FIT"
                  ? "Prepare a pass"
                  : item.fit === "PARTIAL" || item.rules.unknown > 0
                    ? "Ask for more"
                    : "Look at first"}
                <span className="gq-t2"> · {view.why}</span>
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
          Prepare {outside.length} pass{outside.length === 1 ? "" : "es"} to
          review
        </Button>
      ) : null}
    </div>
  );
}

function ReplySheet({
  initial,
  onSend,
  onCancel,
}: {
  readonly initial: string;
  readonly onSend: (message: string) => void;
  readonly onCancel: () => void;
}) {
  const [message, setMessage] = useState(initial);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="gq-field">
        <label className="gq-label" htmlFor="gq-reply">
          Message to the founder{" "}
          <span className="gq-prefill">
            <QNavIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
            Drafted by Q
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
      <p className="cq-caption gq-t3">
        Sent only when you press Send, exactly as shown.
      </p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={message.trim() === ""}
          onClick={() => onSend(message.trim())}
        >
          Send
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
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
        One zip with everything {name} shared with you, with your name on the
        summary. Your team notes are never in it.
      </p>
      <ul className="gq-hair">
        {rows.map(([title, meta]) => (
          <li key={title} className="gq-pick">
            <input type="checkbox" checked readOnly aria-label={title} />
            <span>
              <b className="block font-medium">{title}</b>
              <span className="cq-caption gq-t2">{meta}</span>
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
        Download zip
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
              {label}
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
          aria-label="New label"
          placeholder="New label, like IC next week"
          value={text}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit">Add</Button>
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
      {copied ? "Copied" : label}
    </Button>
  );
}

function Toast({ message }: { readonly message: string | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-[calc(var(--cq-bottom-nav-height)+16px)] left-1/2 z-(--cq-z-toast) -translate-x-1/2 lg:bottom-6"
    >
      {message === null ? null : (
        <span className="gq-card block px-4 py-2.5 text-sm shadow-(--cq-shadow-overlay)">
          {message}
        </span>
      )}
    </div>
  );
}
