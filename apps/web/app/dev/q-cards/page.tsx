import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QCardsHarness } from "./q-cards-harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Answer cards harness",
  robots: { index: false },
};

/**
 * The answer cards' life on screen (P10), driven by a recorded
 * conversation the browser reads from `/dev/q-cards/record` -- a path no
 * server serves: the browser end-to-end suite answers it with fixtures
 * (apps/web/e2e/answer-cards.spec.ts), so nothing here reaches Q, the
 * database or a provider. The Q page's own stage, Board and answer chip
 * render as they do in the product; a typed answer is read once, a voice
 * turn is read back until its run is stored, exactly as `q-session` does.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server (local screenshots and e2e).
 * `?page=q|other`.
 */
export default async function QCardsHarnessPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const page = Array.isArray(params["page"])
    ? params["page"][0]
    : params["page"];
  return <QCardsHarness page={page === "other" ? "other" : "q"} />;
}
