"use client";

import "./work.css";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@capital-q/ui/button";
import {
  Bell,
  Check,
  Clock,
  ICON_SIZE,
  ICON_STROKE,
  X,
} from "@capital-q/ui/icons";
import {
  SheetClose,
  SheetContent,
  SheetRoot,
  SheetTrigger,
} from "@capital-q/ui/sheet";
import { EmptyState, ErrorState, Skeleton } from "@capital-q/ui/states";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import { useQControl } from "@/features/q/control/q-control";
import { effectShown } from "@/features/q/control/perform";
import { QRing } from "@/features/relationships/crm-kit";

import { railGroups, type NoticeGroup, type RailGroup } from "./notice-groups";
import { PushSetting } from "./push-setting";
import { markReadAction, noticeNamesAction } from "./work-actions";
import { WorkTag } from "./work-kit";
import {
  loadOlderNotices,
  noticesRead,
  refreshNotices,
  useNotices,
} from "./notice-store";
import { useT } from "@/features/i18n/language";

/**
 * The notification centre (AUTO; spec auto.md §3.5; owner 2026-10-21,
 * option 3, the side rail by investor, warm charcoal): one bell with the
 * unread count in words for assistive tech and as a number on screen
 * (never colour alone). The rail groups notices by who they are about,
 * each organisation once, what needs the person first on a dark tile.
 * Opening marks the updates shown as read; a "Needs you" notice is read
 * only when it is opened or dealt with from its tile, and then says
 * "Dealt with" in place, so it leaves "Needs you" once dealt with, never
 * merely by being seen. Refreshes every minute while the page is visible,
 * and on focus.
 */

function when(iso: string): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("en-GB", {
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** Names read once per page view: the rail names only the person's own. */
let namesRead: Promise<Readonly<Record<string, string>>> | null = null;

function readNames(): Promise<Readonly<Record<string, string>>> {
  namesRead ??= noticeNamesAction()
    .then((result) => (result.ok ? result.value : {}))
    .catch(() => ({}));
  return namesRead;
}

const NAMED_KIND = {
  PERSON: "person",
  COMPANY: "company",
  INVESTOR_ORGANISATION: "investor",
} as const;

function linked(path: string | null): path is string {
  return path !== null && /^\/(?!\/)/.test(path);
}

function Count({ group }: { readonly group: NoticeGroup }) {
  const t = useT();
  if (group.count <= 1) return null;
  return (
    <>
      <span aria-hidden="true"> ×{group.count}</span>
      <span className="sr-only">
        {t(`, latest of ${String(group.count)} like this`)}
      </span>
    </>
  );
}

function NeedTile({
  group,
  dealt,
  onDeal,
}: {
  readonly group: NoticeGroup;
  readonly dealt: boolean;
  readonly onDeal: () => void;
}) {
  const t = useT();
  const { notice } = group;
  const body = (
    <>
      {dealt ? (
        <WorkTag icon={<Check aria-hidden="true" />}>{t("Dealt with")}</WorkTag>
      ) : (
        <WorkTag icon={<Clock aria-hidden="true" />}>{t("Needs you")}</WorkTag>
      )}
      <span>
        {t(notice.title)}
        <Count group={group} />
      </span>
    </>
  );
  const className = "cq-wk-rn";
  return linked(notice.linkPath) ? (
    <Link
      href={notice.linkPath}
      onClick={onDeal}
      className={className}
      data-needs
      data-dealt={dealt ? true : undefined}
      data-notice={notice.kind}
      data-notice-count={group.count}
    >
      {body}
    </Link>
  ) : (
    <button
      type="button"
      onClick={onDeal}
      disabled={dealt}
      className={className}
      data-needs
      data-dealt={dealt ? true : undefined}
      data-notice={notice.kind}
      data-notice-count={group.count}
    >
      {body}
    </button>
  );
}

function UpdateLine({
  group,
  onOpen,
}: {
  readonly group: NoticeGroup;
  readonly onOpen: () => void;
}) {
  const t = useT();
  const { notice } = group;
  const inner = (
    <>
      <span className="cq-label font-normal text-(--cq-text-tertiary)">
        <time dateTime={notice.createdAt} suppressHydrationWarning>
          {t(when(notice.createdAt))}
        </time>
        {group.unread ? <span className="sr-only">{t(", new")}</span> : null}
      </span>
      <span
        className={group.unread ? "font-medium text-(--cq-text-primary)" : ""}
      >
        {t(notice.title)}
        <Count group={group} />
      </span>
    </>
  );
  return linked(notice.linkPath) ? (
    <Link
      href={notice.linkPath}
      onClick={onOpen}
      className="cq-wk-rn min-h-11 rounded-(--cq-radius-md) hover:text-(--cq-text-primary)"
      data-notice={notice.kind}
      data-notice-count={group.count}
    >
      {inner}
    </Link>
  ) : (
    <div
      className="cq-wk-rn"
      data-notice={notice.kind}
      data-notice-count={group.count}
    >
      {inner}
    </div>
  );
}

function RailRow({
  group,
  dealt,
  onDeal,
  onOpen,
}: {
  readonly group: RailGroup;
  readonly dealt: ReadonlySet<string>;
  readonly onDeal: (one: NoticeGroup) => void;
  readonly onOpen: () => void;
}) {
  const t = useT();
  const name = group.name;
  return (
    <section
      className="cq-wk-rg"
      aria-label={name === null ? t("From Q") : name}
      data-rail-group={group.key}
    >
      {group.named === null ? (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center text-(--cq-accent)">
          <QRing />
        </span>
      ) : (
        <EntityAvatar
          kind={NAMED_KIND[group.named.kind]}
          name={name ?? ""}
          src={group.named.photoUrl}
          size={28}
          decorative
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <b className="font-semibold text-(--cq-text-primary)">
          {group.named === null
            ? t("From Q")
            : (name ?? t("Someone in your relationships"))}
        </b>
        {group.needsYou.map((one) => (
          <NeedTile
            key={one.key}
            group={one}
            dealt={dealt.has(one.key)}
            onDeal={() => onDeal(one)}
          />
        ))}
        {group.updates.map((one) => (
          <UpdateLine key={one.key} group={one} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

export function NotificationCenter({
  review,
}: {
  /**
   * The design review page only: the rail starts open with these names,
   * and nothing is marked read (the notices are fictional).
   */
  readonly review?:
    { readonly names: Readonly<Record<string, string>> } | undefined;
} = {}) {
  const t = useT();

  const [open, setOpen] = useState(review !== undefined);
  const [names, setNames] = useState<Readonly<Record<string, string>>>(
    review?.names ?? {},
  );
  const [dealt, setDealt] = useState<ReadonlySet<string>>(new Set());
  // Q Pitch (premiere v5) and Q's own UI acts: open or close this panel
  // deterministically, DONE once it shows. Reading is not consequential.
  const rootRef = useRef<HTMLSpanElement>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useQControl({
    id: "dialog.notifications",
    kind: "DIALOG",
    ref: rootRef,
    onAct: async (intent) => {
      if (intent.act !== "OPEN" && intent.act !== "CLOSE") {
        return "NOT_APPLICABLE";
      }
      const want = intent.act === "OPEN";
      setOpen(want);
      return (await effectShown(() => openRef.current === want, 3_000))
        ? "DONE"
        : "FAILED";
    },
  });
  // Shared by both bells (phone header, desktop sidebar): one read.
  const { items, unread, failed, nextBefore } = useNotices();
  const load = () => refreshNotices(true);

  // Updates are seen once shown; what needs them waits until dealt with.
  useEffect(() => {
    if (!open || items === null || review !== undefined) return;
    const ids = items
      .filter((item) => !item.read && item.priority !== "NEEDS_YOU")
      .map((item) => item.id);
    if (ids.length === 0) return;
    void markReadAction(ids.slice(0, 50)).then((result) => {
      if (result.ok) noticesRead(ids.length);
    });
  }, [open, items, review]);
  // Who each notice is about, once the rail is first opened.
  useEffect(() => {
    if (!open || review !== undefined) return;
    let live = true;
    void readNames().then((value) => {
      if (live) setNames(value);
    });
    return () => {
      live = false;
    };
  }, [open, review]);

  const groups = railGroups(items ?? [], names);
  const waiting = groups.reduce(
    (sum, group) =>
      sum + group.needsYou.filter((one) => !dealt.has(one.key)).length,
    0,
  );
  const close = () => setOpen(false);
  // Opening a "Needs you" tile is dealing with it: it is read, says so in
  // place, and leaves "Needs you" on the next read.
  const deal = (group: NoticeGroup) => {
    setDealt((was) => new Set([...was, group.key]));
    if (linked(group.notice.linkPath)) close();
    if (review !== undefined) return;
    void markReadAction(group.ids.slice(0, 50)).then((result) => {
      if (!result.ok) return;
      noticesRead(group.ids.length);
      void refreshNotices(true);
    });
  };

  return (
    <span ref={rootRef} className="contents">
      <SheetRoot open={open} onOpenChange={setOpen}>
        <SheetTrigger>
          <IconButton
            aria-label={
              unread === 0
                ? t("Notifications")
                : t(`Notifications, ${String(unread)} new`)
            }
            variant="quiet"
            className="relative text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            data-notification-center
          >
            <Bell
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
            {unread === 0 ? null : (
              <span
                aria-hidden="true"
                className="cq-caption cq-numeric absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-(--cq-accent) px-1 text-center leading-4 text-(--cq-canvas)"
              >
                {/* Live 2026-10-29: "9+" beside a Work badge of 19 read
                    as two different counts; the number itself up to 99. */}
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </IconButton>
        </SheetTrigger>
        <SheetContent
          title={t("Notifications")}
          side="side"
          bare
          className="cq-wk cq-charcoal rounded-t-2xl lg:w-[400px] lg:rounded-none [&>div:first-child]:lg:hidden"
        >
          <div className="cq-wk-rail" data-notification-rail>
            <div className="mb-1 flex items-center justify-between gap-3 border-b border-(--cq-border-subtle) px-1 pb-2">
              <b className="text-base font-semibold">{t("For you")}</b>
              <span className="ms-auto cq-label font-normal text-(--cq-text-tertiary)">
                {waiting === 1
                  ? t("1 needs you")
                  : t(`${String(waiting)} need you`)}
              </span>
              <SheetClose>
                <IconButton
                  aria-label={t("Close")}
                  variant="quiet"
                  size="compact"
                >
                  <X aria-hidden="true" size={ICON_SIZE.regular} />
                </IconButton>
              </SheetClose>
            </div>
            {items === null && !failed ? (
              <Skeleton lines={4} />
            ) : failed && items === null ? (
              <ErrorState
                title={t("Notifications couldn't load")}
                description={t("What needs you is also on Q's work.")}
                action={
                  <button
                    type="button"
                    className="cq-body-sm min-h-11 underline"
                    onClick={() => void load()}
                  >
                    {t("Try again")}
                  </button>
                }
                compact
              />
            ) : groups.length === 0 ? (
              <EmptyState
                title={t("You're up to date")}
                description={t("What needs you shows first.")}
                compact
              />
            ) : (
              groups.map((group) => (
                <RailRow
                  key={group.key}
                  group={group}
                  dealt={dealt}
                  onDeal={deal}
                  onOpen={close}
                />
              ))
            )}
            {nextBefore === undefined || nextBefore === null ? null : (
              <button
                type="button"
                className="cq-body-sm inline-flex min-h-11 items-center self-start px-1 text-(--cq-text-secondary) underline underline-offset-4"
                onClick={() => void loadOlderNotices()}
                data-notices-older
              >
                {t("Show older")}
              </button>
            )}
            <div className="mt-2 border-t border-(--cq-border-subtle) px-1 pt-4">
              <PushSetting compact />
              <Link
                href="/work"
                onClick={close}
                className="cq-body-sm mt-3 inline-flex min-h-11 items-center text-(--cq-text-primary) underline underline-offset-4"
              >
                {t("Open Q’s work")}
              </Link>
            </div>
          </div>
        </SheetContent>
      </SheetRoot>
    </span>
  );
}
