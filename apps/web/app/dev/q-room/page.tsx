import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QRoomHarness } from "./q-room-harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Q room harness",
  robots: { index: false },
};

/**
 * Q room W2 (R1, R4): the Q page's stage with cards in the room, and a
 * page that publishes its manifest, over a recorded conversation and card
 * contents the browser reads from `/dev/q-room/record` and
 * `/dev/q-room/card` -- paths no server serves: the browser suite answers
 * them with fixtures (apps/web/e2e/q-room.spec.ts), so nothing here reaches
 * Q, the database or a provider.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default function QRoomHarnessPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  return <QRoomHarness />;
}
