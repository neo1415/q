import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";

import { DeepLinkShell } from "./deep-link-shell";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deep links harness",
  robots: { index: false },
};

/**
 * Q Workspace W3: deep links and arrival in a real browser, over fictional
 * data -- a Board item, a thread message, a page section, a data-room
 * document -- with a stand-in for Q's composer outside the page. Nothing
 * reaches Q, the database or a provider.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default function DeepLinksLayout({
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
      <DeepLinkShell>{children}</DeepLinkShell>
    </>
  );
}
