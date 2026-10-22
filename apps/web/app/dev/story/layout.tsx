import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";

import { StoryHarnessHost } from "./story-harness-host";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Q Story harness",
  robots: { index: false },
};

/**
 * Q Story over the dev review pages (design review and the S1 recording):
 * this layout keeps the story host mounted while the story moves between
 * /dev/story/<page> children, each of which renders an existing dev review
 * page with its fictional fixtures. Nothing here reads a service or calls
 * a model. Development only, or a production build started with
 * CQ_REVIEW_PAGES=1 for the screenshot run.
 */
export default function StoryHarnessLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_REVIEW_PAGES"] !== "1"
  ) {
    notFound();
  }
  return (
    <>
      {/* Capital Q's default black-and-gold preset, as the app shell
          applies it (Q is gold). */}
      <PublicBrandStyle />
      {children}
      <StoryHarnessHost />
    </>
  );
}
