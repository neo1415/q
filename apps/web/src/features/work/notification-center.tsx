"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { NotificationDto } from "@capital-q/contracts";
import { IconButton } from "@capital-q/ui/button";
import { Bell, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot, SheetTrigger } from "@capital-q/ui/sheet";
import { EmptyState, ErrorState, Skeleton } from "@capital-q/ui/states";

import { PushSetting } from "./push-setting";
import { listNoticesAction, markReadAction } from "./work-actions";

/**
 * The notification centre (AUTO; spec auto.md §3.5): one bell with the
 * unread count in words for assistive tech and as a number on screen
 * (never colour alone). "Needs you" first, then updates, each a tap to
 * where it is acted on. Opening marks what is shown as read. Refreshes
 * every minute while the page is visible, and on focus.
 */

const POLL_MS = 60_000;

function when(iso: string): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

function NoticeRow({
  notice,
  onOpen,
}: {
  readonly notice: NotificationDto;
  readonly onOpen: () => void;
}) {
  const body = (
    <span className="flex flex-col gap-0.5">
      <span className="cq-body-sm font-medium text-(--cq-text-primary)">
        {notice.read ? null : <span className="sr-only">New: </span>}
        {notice.title}
      </span>
      {notice.body === null ? null : (
        <span className="cq-caption line-clamp-2 whitespace-pre-line text-(--cq-text-secondary)">
          {notice.body}
        </span>
      )}
      <time
        dateTime={notice.createdAt}
        className="cq-caption cq-numeric text-(--cq-text-tertiary)"
        suppressHydrationWarning
      >
        {when(notice.createdAt)}
      </time>
    </span>
  );
  return (
    <li
      className="flex gap-3 border-b border-(--cq-border-subtle) py-3 last:border-b-0"
      data-notice={notice.kind}
    >
      <span
        aria-hidden="true"
        className={`mt-2 size-1.5 shrink-0 rounded-full ${notice.read ? "bg-transparent" : "bg-(--cq-accent)"}`}
      />
      {notice.linkPath === null || !/^\/(?!\/)/.test(notice.linkPath) ? (
        body
      ) : (
        <Link
          href={notice.linkPath}
          onClick={onOpen}
          className="min-h-11 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {body}
        </Link>
      )}
    </li>
  );
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<readonly NotificationDto[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const result = await listNoticesAction();
    if (result.ok) {
      setItems(result.value.items);
      setUnread(result.value.unread);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // Seen once shown: what the person opened the centre to read is read.
  useEffect(() => {
    if (!open || items === null) return;
    const ids = items.filter((item) => !item.read).map((item) => item.id);
    if (ids.length === 0) return;
    void markReadAction(ids.slice(0, 50)).then((result) => {
      if (result.ok) setUnread((count) => Math.max(0, count - ids.length));
    });
  }, [open, items]);

  const needsYou = (items ?? []).filter(
    (item) => item.priority === "NEEDS_YOU",
  );
  const updates = (items ?? []).filter((item) => item.priority !== "NEEDS_YOU");
  const close = () => setOpen(false);

  return (
    <SheetRoot open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <IconButton
          aria-label={
            unread === 0
              ? "Notifications"
              : `Notifications, ${String(unread)} new`
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
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </IconButton>
      </SheetTrigger>
      <SheetContent title="Notifications" side="side">
        <div className="flex flex-col gap-5 pt-1">
          {items === null && !failed ? (
            <Skeleton lines={4} />
          ) : failed && items === null ? (
            <ErrorState
              title="Notifications couldn't load"
              description="Try again in a moment."
              action={
                <button
                  type="button"
                  className="cq-body-sm min-h-11 underline"
                  onClick={() => void load()}
                >
                  Try again
                </button>
              }
              compact
            />
          ) : (items ?? []).length === 0 ? (
            <EmptyState
              title="Nothing yet"
              description="When Q does something for you or needs your word, it shows here."
              compact
            />
          ) : (
            <>
              {needsYou.length === 0 ? null : (
                <section aria-labelledby="notices-needs-you">
                  <h3
                    id="notices-needs-you"
                    className="cq-label text-(--cq-text-secondary)"
                  >
                    Needs you
                  </h3>
                  <ul>
                    {needsYou.map((notice) => (
                      <NoticeRow
                        key={notice.id}
                        notice={notice}
                        onOpen={close}
                      />
                    ))}
                  </ul>
                </section>
              )}
              {updates.length === 0 ? null : (
                <section aria-labelledby="notices-updates">
                  <h3
                    id="notices-updates"
                    className="cq-label text-(--cq-text-secondary)"
                  >
                    Updates
                  </h3>
                  <ul>
                    {updates.map((notice) => (
                      <NoticeRow
                        key={notice.id}
                        notice={notice}
                        onOpen={close}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          <div className="border-t border-(--cq-border-subtle) pt-4">
            <PushSetting compact />
            <Link
              href="/work"
              onClick={close}
              className="cq-body-sm mt-3 inline-flex min-h-11 items-center text-(--cq-text-primary) underline underline-offset-4"
            >
              Open Q&rsquo;s work
            </Link>
          </div>
        </div>
      </SheetContent>
    </SheetRoot>
  );
}
