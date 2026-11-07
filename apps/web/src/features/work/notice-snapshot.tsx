"use client";

import type { ReactNode } from "react";

import { NoticeSnapshotContext, type NoticeState } from "./notice-store";

/** The server's notice read for the page beneath (see useNotices). */
export function NoticeSnapshot({
  value,
  children,
}: {
  readonly value: NoticeState | null;
  readonly children: ReactNode;
}) {
  return (
    <NoticeSnapshotContext.Provider value={value}>
      {children}
    </NoticeSnapshotContext.Provider>
  );
}
