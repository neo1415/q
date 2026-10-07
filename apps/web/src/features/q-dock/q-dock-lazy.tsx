"use client";

import { usePathname } from "next/navigation";
import { lazy, Suspense } from "react";

const Q_PAGE = "/home";

/**
 * Q room W7: the floating dock never shows on the Q page itself, so there
 * its code (Motion, its menus) is not loaded at all; elsewhere it loads
 * as before, server-rendered.
 */
const QDock = lazy(() =>
  import("./q-dock").then((module) => ({ default: module.QDock })),
);

export function QDockOffQPage() {
  const pathname = usePathname();
  if (pathname === Q_PAGE) return null;
  return (
    <Suspense fallback={null}>
      <QDock />
    </Suspense>
  );
}
