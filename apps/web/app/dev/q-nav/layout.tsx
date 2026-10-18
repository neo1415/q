import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { QNavShell } from "./q-nav-shell";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Q across pages harness",
  robots: { index: false },
};

/**
 * Q persistent across navigation (Zino, 2026-10-08): the app's own Q store
 * in a layout that stays while its pages change, with a scripted voice
 * line. The Q page here is the real Q page panel, opened bare (as the
 * header's mark and "take me to Q" open it). Nothing reaches Q, the
 * database or a provider.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default function QNavLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  return <QNavShell>{children}</QNavShell>;
}
