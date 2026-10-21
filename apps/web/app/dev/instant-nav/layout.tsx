import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";

import { InstantNavShell } from "./instant-nav-shell";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Instant navigation harness",
  robots: { index: false },
};

/**
 * Lane 7 (owner 2026-10-21): instant navigation and actions from any page.
 * The app's own Q store and control runtime over three pages, with the
 * typed line's own `ask`. The browser suite answers `/api/q-navigate` (the
 * Q API's code-only reader) and `/api/q-ask` (a Q run) with fixtures, so
 * nothing here reaches Q, the database or a provider.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default function InstantNavLayout({
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
  return (
    <>
      <PublicBrandStyle />
      <InstantNavShell>{children}</InstantNavShell>
    </>
  );
}
