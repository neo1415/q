"use client";

import { useEffect, useRef } from "react";

import { useQSessionOptional } from "@/features/q/q-session";

import { setPane } from "./layout-store";
import { requestQPaneBoard, requestQPaneDraft } from "./q-pane-requests";

/**
 * `/home` inside the Q Workspace (W1.2): what the URL asks of Q goes to the
 * one Q pane in the layout instead of a second panel on the page. `?c=`
 * opens that conversation, `?new=1` starts one, `?ask=` types a draft (never
 * sent), `?board=1` opens the Board. Each request is applied once.
 */
export function WorkspaceHomeDirective({
  conversationId,
  fresh,
  ask,
  board,
}: {
  readonly conversationId: string | null;
  readonly fresh: boolean;
  readonly ask: string | undefined;
  readonly board: boolean;
}) {
  const session = useQSessionOptional();
  const open = session?.open;
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify([conversationId, fresh, ask, board]);
    if (open === undefined || applied.current === key) return;
    applied.current = key;
    const asksQ =
      conversationId !== null || fresh || ask !== undefined || board;
    if (!asksQ) return;
    setPane("qPane", "open");
    if (conversationId !== null || fresh) open(conversationId);
    if (ask !== undefined) requestQPaneDraft(ask);
    if (board) requestQPaneBoard();
  }, [open, conversationId, fresh, ask, board]);
  return null;
}
