import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DEFAULT_LANDING_COPY } from "@/features/landing/landing-copy";
import { LandingPage } from "@/features/landing/landing-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Landing (design review)",
  robots: { index: false },
};

/**
 * The landing page with its fallback copy and no session work, so the
 * browser checks can see its footer links to the legal pages without the
 * request proxy (which needs the auth configuration). Development only.
 */
export default function LandingReviewPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  return <LandingPage copy={DEFAULT_LANDING_COPY} />;
}
