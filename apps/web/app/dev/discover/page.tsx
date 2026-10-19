import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DiscoverHarness } from "./discover-harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover harness",
  robots: { index: false },
};

/**
 * Discover A (owner 2026-10-19): the immersive feed's stage and card over
 * fictional companies, for design review and screenshots. The pitches and
 * their captions are read from paths no server serves
 * (`/dev/discover/media/*`, `/api/pitch-captions/*`): the browser run
 * answers them with samples, so nothing here reaches the API or a CDN.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default function DiscoverHarnessPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  return <DiscoverHarness />;
}
