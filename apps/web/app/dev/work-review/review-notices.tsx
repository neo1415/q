"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { NotificationDto } from "@capital-q/contracts";

import {
  seedNoticesForReview,
  type NoticeState,
} from "@/features/work/notice-store";

/**
 * The review page's notices: the shell's one notice store shows these
 * fictional ones (the bell, the rail and Work's "Needs your yes") and
 * reads nothing while the page is open. Seeded in the first client
 * render, before anything subscribes, and undone when the page leaves.
 */
function stateOf(items: readonly NotificationDto[]): NoticeState {
  return {
    items,
    unread: items.filter((item) => !item.read).length,
    failed: false,
    nextBefore: null,
  };
}

export function ReviewNotices({
  items,
  children,
}: {
  readonly items: readonly NotificationDto[];
  readonly children: ReactNode;
}) {
  // The first paint already shows them (nothing has subscribed yet).
  useState(() =>
    typeof window === "undefined" ? null : seedNoticesForReview(stateOf(items)),
  );
  // Seeded again on mount, so a remount (Strict Mode) keeps them.
  useEffect(() => seedNoticesForReview(stateOf(items)), [items]);
  return children;
}
