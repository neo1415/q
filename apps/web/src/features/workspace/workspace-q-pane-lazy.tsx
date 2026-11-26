"use client";

import dynamic from "next/dynamic";
import { lazy, Suspense, type ComponentProps } from "react";

import type { QConversationPanel } from "@/features/q/q-conversation";

import { AfterHydration } from "./after-hydration";
import { WorkspaceQPending } from "./workspace-q-pending";

/**
 * W4-B (enterprise audit finding 6): the Q pane's conversation and its
 * arrival stage are drawn by the browser after hydration anyway (the
 * server sends only the pane's placeholder, AfterHydration), so their code
 * is not part of every page's first download: it arrives after the page and
 * the pane holds its placeholder (WorkspaceQPending) until it has.
 *
 * W4-E (production, 21 Nov 2026: Home's LCP 2.8 s -> 7.6 s): in the Q
 * Workspace the pane's greeting is Home's largest paint, and it waited
 * for hydration and then for this code. The code is now asked for the
 * moment this module runs in the browser, beside hydration rather than
 * after it; it is still not part of the page's first download, so it
 * never delays the page's own script.
 */
const loadPanel = () =>
  import("@/features/q/q-conversation").then((m) => m.QConversationPanel);
const loadArrivalStage = () =>
  import("@/features/briefing/arrival-stage").then((m) => m.ArrivalStage);

/** Starts both downloads once, in the browser; a failure is retried on render. */
export function preloadWorkspaceQPane(): void {
  void loadPanel().catch(() => undefined);
  void loadArrivalStage().catch(() => undefined);
}

if (typeof window !== "undefined") preloadWorkspaceQPane();

const LazyPanel = lazy(() => loadPanel().then((Panel) => ({ default: Panel })));

type PanelProps = ComponentProps<typeof QConversationPanel>;

/**
 * The Q pane's conversation behind its placeholder (LCP, owner approval
 * 26 Nov 2026). The server and hydration draw WorkspaceQPending with the
 * greeting the panel will show for an empty conversation; the same
 * placeholder holds while the panel's code loads, and the panel replaces
 * it on its first commit. Exactly one greeting is on screen throughout.
 */
export function WorkspaceQPanel(props: PanelProps) {
  const pending = (
    <WorkspaceQPending
      greeting={props.greeting}
      starters={props.starters}
      suggestions={props.context.suggestions}
      connected={props.connected}
    />
  );
  return (
    <AfterHydration fallback={pending}>
      <Suspense fallback={pending}>
        <LazyPanel {...props} />
      </Suspense>
    </AfterHydration>
  );
}

export const LazyArrivalStage = dynamic(loadArrivalStage, { ssr: false });
