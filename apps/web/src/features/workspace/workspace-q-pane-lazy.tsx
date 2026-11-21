"use client";

import dynamic from "next/dynamic";

import { WorkspaceQPending } from "./workspace-q-pending";

/**
 * W4-B (enterprise audit finding 6): the Q pane's conversation and its
 * arrival stage are drawn by the browser after hydration anyway (the
 * server sends only the pane's shape, AfterHydration), so their code is
 * not part of every page's first download: it arrives after the page and
 * the pane holds its shape (WorkspaceQPending) until it has.
 */
export const LazyQConversationPanel = dynamic(
  () => import("@/features/q/q-conversation").then((m) => m.QConversationPanel),
  { ssr: false, loading: () => <WorkspaceQPending /> },
);

export const LazyArrivalStage = dynamic(
  () => import("@/features/briefing/arrival-stage").then((m) => m.ArrivalStage),
  { ssr: false },
);
