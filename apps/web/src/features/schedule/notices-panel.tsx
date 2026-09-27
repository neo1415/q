import "server-only";

import { listNotifications, listReminders } from "@capital-q/api-client";
import type { NotificationList, ReminderDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

import { NoticesPanelControls } from "./notices-panel-controls";

/**
 * Needs you: reminders and notices (BIZ-008). Due reminders, invites
 * received, calls cancelled and prep briefs ready, for the person only.
 * Renders nothing when there is nothing to show or it cannot be read.
 */
export async function NoticesPanel() {
  const session = await apiSession();
  if (session === null) return null;
  let notices: NotificationList;
  let reminders: readonly ReminderDto[];
  try {
    [notices, { items: reminders }] = await Promise.all([
      listNotifications(session),
      listReminders(session),
    ]);
  } catch {
    return null;
  }
  const upcoming = reminders.filter((reminder) => reminder.meetingId === null);
  if (notices.items.length === 0 && upcoming.length === 0) return null;
  return (
    <NoticesPanelControls
      initialNotices={notices.items.slice(0, 10)}
      initialReminders={upcoming.slice(0, 10)}
    />
  );
}
