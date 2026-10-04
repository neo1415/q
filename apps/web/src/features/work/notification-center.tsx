"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { buttonClassName, IconButton } from "@capital-q/ui/button";
import { Bell, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot, SheetTrigger } from "@capital-q/ui/sheet";
import { EmptyState, ErrorState, Skeleton } from "@capital-q/ui/states";

import { EntityAvatar } from "@/features/entity/entity-avatar";

import { groupNotices, type NoticeGroup } from "./notice-groups";
import { PushSetting } from "./push-setting";
import { markReadAction } from "./work-actions";
import { noticesRead, refreshNotices, useNotices } from "./notice-store";

/**
 * The notification centre (AUTO; spec auto.md §3.5): one bell with the
 * unread count in words for assistive tech and as a number on screen
 * (never colour alone). "Needs you" first, then updates, each a tap to
 * where it is acted on. Opening marks the updates shown as read; a "Needs
 * you" notice is read only when it is resolved or opened from its row, so
 * it leaves "Needs you" once dealt with, never merely by being seen.
 * Refreshes every minute while the page is visible, and on focus.
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

function NoticeRow({
  group,
  onOpen,
  needsYou = false,
}: {
  readonly group: NoticeGroup;
  readonly onOpen: () => void;
  readonly needsYou?: boolean;
}) {
  const { notice, count, unread } = group;
  const linked = notice.linkPath !== null && /^\/(?!\/)/.test(notice.linkPath);
  // One line per notice on a phone (design-48 v2): the title and its time.
  // The body is on the page the row opens, never repeated here.
  const named = notice.named ?? null;
  const body = (
    <span className="flex min-w-0 flex-1 items-baseline gap-3">
      {named === null || named.photoUrl === null ? null : (
        // Who the notice names, as the server signed it for this reader
        // (the name's scope). No picture: the row stays text only.
        <EntityAvatar
          kind={
            named.kind === "COMPANY"
              ? "company"
              : named.kind === "PERSON"
                ? "person"
                : "investor"
          }
          name=""
          src={named.photoUrl}
          size="xs"
          decorative
          className="self-center"
        />
      )}
      <span
        className={`cq-body-sm min-w-0 flex-1 line-clamp-2 text-(--cq-text-primary) ${unread ? "font-medium" : ""}`}
      >
        {unread ? <span className="sr-only">New: </span> : null}
        {notice.title}
      </span>
      <span className="cq-caption cq-numeric shrink-0 text-(--cq-text-tertiary)">
        <time dateTime={notice.createdAt} suppressHydrationWarning>
          {when(notice.createdAt)}
        </time>
        {count > 1 ? (
          <>
            <span aria-hidden="true"> ×{count}</span>
            <span className="sr-only">, latest of {count} like this</span>
          </>
        ) : null}
      </span>
    </span>
  );
  return (
    <li
      className="border-b border-(--cq-border-subtle) last:border-b-0"
      data-notice={notice.kind}
      data-notice-count={count}
    >
      {linked ? (
        <Link
          href={notice.linkPath ?? "/"}
          onClick={onOpen}
          className="flex min-h-12 items-center gap-3 rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${unread ? "bg-(--cq-accent)" : "bg-transparent"}`}
          />
          {body}
          {needsYou ? (
            <span
              aria-hidden="true"
              className={buttonClassName("secondary", "compact")}
            >
              Open
            </span>
          ) : null}
        </Link>
      ) : (
        <div className="flex min-h-12 items-center gap-3 py-2">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${unread ? "bg-(--cq-accent)" : "bg-transparent"}`}
          />
          {body}
        </div>
      )}
    </li>
  );
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  // Shared by both bells (phone header, desktop sidebar): one read.
  const { items, unread, failed } = useNotices();
  const load = () => refreshNotices(true);

  // Updates are seen once shown; what needs them waits until dealt with.
  useEffect(() => {
    if (!open || items === null) return;
    const ids = items
      .filter((item) => !item.read && item.priority !== "NEEDS_YOU")
      .map((item) => item.id);
    if (ids.length === 0) return;
    void markReadAction(ids.slice(0, 50)).then((result) => {
      if (result.ok) noticesRead(ids.length);
    });
  }, [open, items]);

  const { needsYou, days } = groupNotices(items ?? []);
  const close = () => setOpen(false);
  // Opening a "Needs you" row is dealing with it: it is read, and leaves.
  const openNeed = (ids: readonly string[]) => () => {
    close();
    void markReadAction(ids.slice(0, 50)).then((result) => {
      if (!result.ok) return;
      noticesRead(ids.length);
      void refreshNotices(true);
    });
  };

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
              description="What needs you is also on Q's work."
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
              title="You're up to date"
              description="What needs you shows first."
              compact
            />
          ) : (
            <>
              {needsYou.length === 0 ? null : (
                <section aria-labelledby="notices-needs-you">
                  <h3
                    id="notices-needs-you"
                    className="cq-title-sm text-(--cq-text-primary)"
                  >
                    Needs you
                  </h3>
                  <ul>
                    {needsYou.map((group) => (
                      <NoticeRow
                        key={group.key}
                        group={group}
                        onOpen={openNeed(group.ids)}
                        needsYou
                      />
                    ))}
                  </ul>
                </section>
              )}
              {days.map((day) => (
                <section
                  key={day.label}
                  aria-label={`Updates, ${day.label}`}
                  data-notice-day={day.label}
                >
                  <h3 className="cq-label text-(--cq-text-secondary)">
                    {day.label}
                  </h3>
                  <ul>
                    {day.groups.map((group) => (
                      <NoticeRow key={group.key} group={group} onOpen={close} />
                    ))}
                  </ul>
                </section>
              ))}
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
