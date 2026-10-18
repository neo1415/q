"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";

/**
 * Q room W7: the documents-ready stack and its viewer show nothing until
 * a document Q made is ready, so their code (a dialog, the viewer) loads
 * after the page is up rather than with its first paint.
 */
const DocumentReadyCenter = lazy(() =>
  import("./document-ready-center").then((module) => ({
    default: module.DocumentReadyCenter,
  })),
);

const subscribeNothing = () => () => undefined;

export function DocumentReadyCenterAfterPaint({
  connected,
}: {
  readonly connected: boolean;
}) {
  // Nothing on the server render or at hydration; the browser after.
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <DocumentReadyCenter connected={connected} />
    </Suspense>
  );
}
