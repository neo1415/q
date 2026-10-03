"use client";

import { useEffect, useState, useTransition } from "react";

import type { NotificationDto, ReminderDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  dismissReminderAction,
  markNoticesReadAction,
} from "./schedule-actions";

/**
 * The client half of Needs you (BIZ-008): notices are marked read once
 * shown; a reminder is cleared with Done. Unread is said in words, never by
 * colour alone.
 */

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function NoticesPanelControls({
  initialNotices,
  initialReminders,
}: {
  readonly initialNotices: readonly NotificationDto[];
  readonly initialReminders: readonly ReminderDto[];
}) {
  const [reminders, setReminders] = useState(initialReminders);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const unread = initialNotices.filter((n) => !n.read).map((n) => n.id);
    if (unread.length > 0) void markNoticesReadAction(unread);
  }, [initialNotices]);

  const done = (reminderId: string) =>
    startTransition(async () => {
      const result = await dismissReminderAction(reminderId);
      if (result.ok) {
        setReminders((current) => current.filter((r) => r.id !== reminderId));
      }
    });

  return (
    <section
      aria-labelledby="needs-you-notices"
      className="flex max-w-(--cq-layout-reading) flex-col gap-3 pb-6"
      data-notices
    >
      <h2
        id="needs-you-notices"
        className="cq-title-sm text-(--cq-text-primary)"
      >
        Needs you
      </h2>
      {reminders.length === 0 ? null : (
        <ul className="flex flex-col gap-2" data-reminders>
          {reminders.map((reminder) => (
            <li
              key={reminder.id}
              className="flex flex-wrap items-baseline justify-between gap-2"
            >
              <span className="cq-body text-(--cq-text-primary)">
                {reminder.status === "DELIVERED" ? "Due: " : "Reminder: "}
                {reminder.title}{" "}
                <time
                  dateTime={reminder.dueAt}
                  className="cq-caption cq-numeric text-(--cq-text-tertiary)"
                  suppressHydrationWarning
                >
                  {when(reminder.dueAt)}
                </time>
              </span>
              <Button
                variant="quiet"
                size="compact"
                disabled={pending}
                onClick={() => done(reminder.id)}
              >
                Done
              </Button>
            </li>
          ))}
        </ul>
      )}
      {initialNotices.length === 0 ? null : (
        <ul className="flex flex-col gap-2" data-notifications>
          {initialNotices.map((notice) => (
            <li key={notice.id} className="flex flex-col gap-0.5">
              <span className="cq-body text-(--cq-text-primary)">
                {notice.read ? "" : "New: "}
                {notice.title}
              </span>
              <time
                dateTime={notice.createdAt}
                className="cq-caption cq-numeric text-(--cq-text-tertiary)"
                suppressHydrationWarning
              >
                {when(notice.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
