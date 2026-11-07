"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const noSubscription = () => () => undefined;

/**
 * Renders `fallback` on the server and through hydration, then `children`
 * straight after (W1 batch 6, live: hydration error #418).
 *
 * The Q pane streams inside the layout's Suspense, so it hydrates after
 * QSessionProvider has already restored this tab's conversation: the
 * server had rendered an empty conversation, the client a full one. The
 * panel's state is the browser's (the session store), so it is drawn by
 * the browser; the server draws only the pane's shape.
 */
export function AfterHydration({
  fallback,
  children,
}: {
  readonly fallback: ReactNode;
  readonly children: ReactNode;
}) {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return hydrated ? children : fallback;
}
