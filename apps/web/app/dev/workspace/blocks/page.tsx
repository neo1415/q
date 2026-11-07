import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BlocksHarness } from "./blocks-harness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Q pane blocks harness",
  robots: { index: false },
};

/**
 * R7 (ADR 0077): every result-block kind Q can show, inside real Q-pane
 * containers at several widths, for screenshots. Fixtures only; nothing
 * reaches Q, the database or a provider. Development only; a production
 * build serves it only when CQ_DEV_PREVIEW=1 is set on that server.
 */
export default function BlocksHarnessPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  return <BlocksHarness />;
}
