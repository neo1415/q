import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Q Story storyboard",
  robots: { index: false },
};

/**
 * Q Story S2 (owner 2026-10-21): the story premiere's storyboard. The plan's
 * beat table replayed on a fixed clock, with captions, over the real pages
 * (the other dev harnesses, all fixtures), for the owner's review before
 * the S1 engine's final polish. Nothing here reaches Q, the database or a
 * provider; the photographs and page captures are answered by the
 * recording run.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default function QStoryLayout({
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
      {/* The app's own black and gold, as the signed-in shell applies it. */}
      <PublicBrandStyle />
      {children}
    </>
  );
}
